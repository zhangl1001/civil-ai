import type { UnitOfWork } from '@/capabilities/database/public';
import type {
  CapabilityNodeId, Clock, IdGenerator, InstantMs, JsonObject, LearningSessionId, LearningThreadId, QuestionSetId, ReviewQueueItemId
} from '@/kernel/public';
import {
  QuestionSetPracticeStatus,
  type ContentRepository,
  type QuestionRecord
} from '@/modules/content/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { LearningThreadRecord, LearningThreadRepository } from '@/modules/teaching/public';
import type {
  ErrorDiagnosisRepository,
  LearningEvidenceRepository,
  LearningSessionRepository
} from '../contracts/LearningRepositories';
import {
  AttemptResult,
  ConfirmationStatus,
  ErrorCauseCode,
  EvidenceSource,
  EvidenceType,
  GradingMethod,
  isDecisionObservationType,
  LearningSessionStatus,
  LearningSessionType,
  QuestionExposureType
} from '../domain/EvidenceCodes';
import type { DecisionObservationType } from '../domain/EvidenceCodes';
import { AssessmentRole } from '../domain/AssessmentRole';
import { EvidenceValidity } from '../domain/EvidenceValidity';
import type { ObjectiveSubmissionBundle } from '../contracts/LearningFacts';
import { objectiveEvidenceOriginFrom } from '../domain/ObjectiveEvidenceOrigin';
import { objectiveEvidencePolicyV2 } from '../domain/ObjectiveEvidencePolicy';

export interface ObjectiveAnswerInput {
  readonly questionId: string;
  readonly optionId?: string;
  readonly elapsedMs?: number;
  readonly confidence?: number;
  readonly hintLevel?: number;
  readonly answerChangeCount?: number;
  readonly observations?: readonly {
    readonly observationType: DecisionObservationType;
    readonly valueCode: string;
    readonly value: JsonObject;
    readonly confidence: number;
  }[];
}

export interface SubmitObjectiveSessionCommand {
  readonly idempotencyKey: string;
  readonly learningThreadId: LearningThreadId;
  readonly questionSetId: QuestionSetId;
  readonly reviewQueueItemId?: ReviewQueueItemId;
  readonly dailyPlanItemId?: string;
  readonly questionIds?: readonly string[];
  readonly assessmentRole?: AssessmentRole;
  readonly startedAt: InstantMs;
  readonly elapsedMs: number;
  readonly answers: readonly ObjectiveAnswerInput[];
}

export interface ObjectiveSessionSubmissionResult {
  readonly sessionId: LearningSessionId;
  readonly examCycleId: string;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly unanswered: number;
  readonly diagnosisCount: number;
}

export class SubmitObjectiveSession {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly contentRepository: ContentRepository,
    private readonly threadRepository: LearningThreadRepository,
    private readonly sessionRepository: LearningSessionRepository,
    private readonly diagnosisRepository: ErrorDiagnosisRepository,
    private readonly evidenceRepository: LearningEvidenceRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: SubmitObjectiveSessionCommand): Promise<ObjectiveSessionSubmissionResult> {
    this.assertCommand(command);
    const existing = await this.sessionRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      const diagnoses = await this.diagnosisRepository.listBySession(existing.session.id);
      return summary(existing.session, existing.attempts.length, diagnoses.length, existing.attempts[0]?.capabilityNodeId);
    }
    const [thread, questionSet] = await Promise.all([
      this.threadRepository.findById(command.learningThreadId),
      this.contentRepository.findQuestionSet(command.questionSetId)
    ]);
    if (!thread) throw new Error(`Learning thread does not exist: ${command.learningThreadId}`);
    if (thread.thread.status !== 'active') throw new Error(`Learning thread is not active: ${thread.thread.status}`);
    if (!questionSet || questionSet.questionSet.status !== 'ready') throw new Error(`Question set is unavailable: ${command.questionSetId}`);
    if (questionSet.questionSet.examCycleId !== thread.thread.examCycleId) throw new Error('Question set and learning thread belong to different exam cycles');
    if (questionSet.questionSet.capabilityNodeId !== thread.thread.primaryCapabilityNodeId) {
      throw new Error('Reference slice only accepts question sets bound to the learning thread primary capability');
    }
    const selectedQuestions = selectQuestions(questionSet.questions, command.questionIds);
    const bundle = this.buildBundle(
      command,
      thread.thread,
      selectedQuestions,
      command.assessmentRole ?? questionSet.questionSet.assessmentRole,
      targetQuestionMs(questionSet.generationSpec?.constraints, selectedQuestions.length)
    );
    try {
      await this.unitOfWork.run(async (context) => {
        await this.sessionRepository.commitObjectiveSession(bundle, context);
        await this.diagnosisRepository.append(bundle.diagnoses, context);
        await this.evidenceRepository.append(bundle.evidence, bundle.validity, context);
        await this.contentRepository.updateQuestionSetPracticeStatus(
          command.questionSetId,
          QuestionSetPracticeStatus.Completed,
          context
        );
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: 'learning_session',
          aggregateId: bundle.session.id,
          eventType: 'learning_session.objective_submitted',
          payload: {
            sessionId: bundle.session.id,
            learningThreadId: bundle.session.learningThreadId,
            questionSetId: bundle.session.questionSetId,
            capabilityNodeId: bundle.attempts[0]?.capabilityNodeId ?? null,
            reviewQueueItemId: command.reviewQueueItemId ?? null,
            dailyPlanItemId: command.dailyPlanItemId ?? null,
            elapsedMs: command.elapsedMs,
            correctCount: bundle.session.correctCount,
            questionCount: bundle.session.questionCount
          },
          occurredAt: bundle.session.completedAt,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:submitted`
        }, context);
      });
      return summary(bundle.session, bundle.attempts.length, bundle.diagnoses.length, bundle.attempts[0]?.capabilityNodeId);
    } catch (error) {
      const concurrent = await this.sessionRepository.findByIdempotencyKey(command.idempotencyKey);
      if (concurrent) {
        const diagnoses = await this.diagnosisRepository.listBySession(concurrent.session.id);
        return summary(concurrent.session, concurrent.attempts.length, diagnoses.length, concurrent.attempts[0]?.capabilityNodeId);
      }
      throw error;
    }
  }

  private buildBundle(
    command: SubmitObjectiveSessionCommand,
    thread: LearningThreadRecord,
    questions: readonly QuestionRecord[],
    assessmentRole: AssessmentRole,
    speedTargetMs: number
  ): ObjectiveSubmissionBundle {
    const answerByQuestionId = new Map(command.answers.map((item) => [item.questionId, item]));
    if (answerByQuestionId.size !== command.answers.length) throw new Error('Each question can be submitted once per session');
    const expected = new Set(questions.map((item) => item.id));
    if (answerByQuestionId.size !== expected.size || [...answerByQuestionId.keys()].some((id) => !expected.has(id as QuestionRecord['id']))) {
      throw new Error('Submission answers must match the question set exactly');
    }
    const now = this.clock.now();
    const sessionId = this.ids.next('LearningSessionId');
    const attempts = questions.map((question) => {
      const answer = answerByQuestionId.get(question.id)!;
      const hintLevel = answer.hintLevel ?? 0;
      const selectedOptionId = answer.optionId?.trim() || undefined;
      const correctOptionId = correctOptionIdOf(question);
      const result = selectedOptionId === undefined
        ? AttemptResult.Unanswered
        : selectedOptionId === correctOptionId ? AttemptResult.Correct : AttemptResult.Incorrect;
      const attemptId = this.ids.next('AttemptId');
      return {
        question,
        attempt: {
          id: attemptId,
          sessionId,
          questionId: question.id,
          examCycleId: thread.examCycleId,
          capabilityNodeId: question.capabilityNodeId,
          learningThreadId: thread.id,
          assessmentRole,
          questionContentVersion: question.contentVersion,
          answer: { optionId: selectedOptionId ?? null },
          result,
          score: result === AttemptResult.Correct ? 1 : 0,
          elapsedMs: answer.elapsedMs,
          confidence: answer.confidence,
          hintLevel,
          answerChangeCount: answer.answerChangeCount ?? 0,
          submittedAt: now,
          idempotencyKey: `${command.idempotencyKey}:attempt:${question.id}`
        },
        answer,
        correctOptionId,
        result
      };
    });
    const correctCount = attempts.filter((item) => item.result === AttemptResult.Correct).length;
    const answeredCount = attempts.filter((item) => item.result !== AttemptResult.Unanswered).length;
    const session = {
      id: sessionId,
      examCycleId: thread.examCycleId,
      learningThreadId: thread.id,
      questionSetId: command.questionSetId,
      reviewQueueItemId: command.reviewQueueItemId,
      sessionType: sessionTypeFor(assessmentRole),
      assessmentRole,
      status: LearningSessionStatus.Completed,
      startedAt: command.startedAt,
      completedAt: now,
      elapsedMs: command.elapsedMs,
      questionCount: questions.length,
      answeredCount,
      correctCount,
      idempotencyKey: command.idempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const observations = attempts.flatMap((item) => (item.answer.observations ?? []).map((observation) => ({
      id: this.ids.next('DecisionObservationId'),
      attemptId: item.attempt.id,
      observationType: observation.observationType,
      valueCode: observation.valueCode,
      value: observation.value,
      source: 'user' as const,
      confidence: observation.confidence,
      occurredAt: now
    })));
    const gradings = attempts.map((item) => ({
      id: this.ids.next('GradingResultId'),
      attemptId: item.attempt.id,
      gradingMethod: GradingMethod.Deterministic,
      graderVersion: 'objective-single-choice:v1',
      result: item.result,
      score: item.attempt.score,
      normalizedFeedback: {
        selectedOptionId: item.answer.optionId ?? null,
        correctOptionId: item.correctOptionId,
        result: item.result
      },
      confidence: 1,
      confirmationStatus: ConfirmationStatus.NotRequired,
      createdAt: now,
      idempotencyKey: `${command.idempotencyKey}:grading:${item.attempt.questionId}`
    }));
    const diagnoses = attempts.flatMap((item, index) => item.result === AttemptResult.Correct ? [] : [{
      id: this.ids.next('ErrorDiagnosisId'),
      sessionId,
      gradingResultId: gradings[index].id,
      attemptId: item.attempt.id,
      examCycleId: item.attempt.examCycleId,
      capabilityNodeId: item.attempt.capabilityNodeId,
      causeCode: ErrorCauseCode.Unknown,
      errorStage: undefined,
      detail: initialDiagnosisDetail(item.result),
      confidence: 0.15,
      confirmationStatus: ConfirmationStatus.Pending,
      prerequisiteCapabilityNodeId: undefined,
      recommendedActionCode: 'request_error_diagnosis',
      dimensions: [],
      correctionPlan: {
        objective: '先确认具体错误环节，再安排针对性纠正。',
        steps: ['查看标准解析并回忆自己的选择依据。', '等待 AI 结合误选项完成深度诊断。'],
        practiceFocus: '暂不追加同类训练，避免在错因不明时重复刷题。',
        successCriteria: '能够说明自己的错误发生在哪一步，并复述正确方法。'
      },
      source: 'deterministic' as const,
      createdAt: now,
      idempotencyKey: `${command.idempotencyKey}:diagnosis:${item.attempt.questionId}`
    }]);
    const correctnessEvidence = attempts.map((item) => ({
      id: this.ids.next('EvidenceId'),
      examCycleId: item.attempt.examCycleId,
      capabilityNodeId: item.attempt.capabilityNodeId,
      attemptId: item.attempt.id,
      assessmentRole,
      evidenceType: EvidenceType.Correctness,
      value: item.attempt.score,
      weight: objectiveEvidencePolicyV2.correctnessWeight(
        assessmentRole,
        item.attempt.hintLevel,
        objectiveEvidenceOriginFrom(item.question.originType ?? 'ai_generated')
      ),
      quality: objectiveEvidencePolicyV2.quality(item.attempt.hintLevel),
      source: EvidenceSource.DeterministicGrader,
      validationPolicyVersion: objectiveEvidencePolicyV2.version,
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:evidence:correctness:${item.attempt.questionId}`,
      metadata: questionEvidenceMetadata(
        item.question,
        {
          hintLevel: item.attempt.hintLevel,
          questionContentVersion: item.attempt.questionContentVersion
        }
      )
    }));
    const speedEvidence = attempts.flatMap((item) => item.attempt.elapsedMs === undefined ? [] : [{
      id: this.ids.next('EvidenceId'),
      examCycleId: item.attempt.examCycleId,
      capabilityNodeId: item.attempt.capabilityNodeId,
      attemptId: item.attempt.id,
      assessmentRole,
      evidenceType: EvidenceType.Speed,
      value: speedScore(item.attempt.elapsedMs, speedTargetMs),
      weight: objectiveEvidencePolicyV2.correctnessWeight(
        assessmentRole,
        item.attempt.hintLevel,
        objectiveEvidenceOriginFrom(item.question.originType ?? 'ai_generated')
      ) * 0.65,
      quality: objectiveEvidencePolicyV2.quality(item.attempt.hintLevel),
      source: EvidenceSource.System,
      validationPolicyVersion: objectiveEvidencePolicyV2.version,
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:evidence:speed:${item.attempt.questionId}`,
      metadata: questionEvidenceMetadata(
        item.question,
        {
          elapsedMs: item.attempt.elapsedMs,
          targetMs: speedTargetMs,
          questionContentVersion: item.attempt.questionContentVersion
        }
      )
    }]);
    const evidence = [...correctnessEvidence, ...speedEvidence];
    const validity = evidence.map((item) => ({
      evidenceId: item.id,
      validityStatus: EvidenceValidity.Valid,
      updatedAt: now,
      version: 1
    }));
    const exposures = attempts.map((item) => ({
      id: this.ids.next('QuestionExposureId'),
      examCycleId: item.attempt.examCycleId,
      learningThreadId: thread.id,
      sessionId,
      questionId: item.attempt.questionId,
      exposureType: assessmentRole === AssessmentRole.Anchor || assessmentRole === AssessmentRole.Retention || assessmentRole === AssessmentRole.Transfer
        ? QuestionExposureType.Assessment
        : QuestionExposureType.Practice,
      answerExposed: false,
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:exposure:${item.attempt.questionId}`
    }));
    return { session, exposures, attempts: attempts.map((item) => item.attempt), observations, gradings, diagnoses, evidence, validity };
  }

  private assertCommand(command: SubmitObjectiveSessionCommand): void {
    if (!command.idempotencyKey.trim()) throw new Error('Objective session idempotency key is required');
    if (!Number.isFinite(command.startedAt) || command.startedAt < 0) throw new Error('Objective session start time is invalid');
    if (!Number.isInteger(command.elapsedMs) || command.elapsedMs < 0) throw new Error('Objective session elapsed time is invalid');
    if (!command.answers.length) throw new Error('Objective session requires answers');
    command.answers.forEach((answer) => {
      if (!answer.questionId.trim()) throw new Error('Objective answer question id is required');
      if (answer.elapsedMs !== undefined && (!Number.isInteger(answer.elapsedMs) || answer.elapsedMs < 0)) {
        throw new Error('Objective answer elapsed time is invalid');
      }
      if (answer.confidence !== undefined && (answer.confidence < 0 || answer.confidence > 1)) {
        throw new Error('Objective answer confidence is invalid');
      }
      answer.observations?.forEach((observation) => {
        if (!isDecisionObservationType(observation.observationType)) {
          throw new Error(`Objective answer observation type is invalid: ${String(observation.observationType)}`);
        }
        if (!observation.valueCode.trim()) throw new Error('Objective answer observation valueCode is required');
        if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
          throw new Error('Objective answer observation confidence is invalid');
        }
      });
    });
  }
}

function selectQuestions(
  questions: readonly QuestionRecord[],
  requestedIds?: readonly string[]
): readonly QuestionRecord[] {
  if (!requestedIds) return questions;
  if (!requestedIds.length) throw new Error('Question subset cannot be empty');
  const unique = new Set(requestedIds);
  if (unique.size !== requestedIds.length) throw new Error('Question subset cannot contain duplicates');
  const byId = new Map(questions.map((question) => [String(question.id), question]));
  const selected = requestedIds.map((id) => byId.get(id));
  if (selected.some((question) => !question)) {
    throw new Error('Question subset contains a question outside the source set');
  }
  return selected as QuestionRecord[];
}

function targetQuestionMs(constraints: JsonObject | undefined, questionCount: number): number {
  const durationMinutes = constraints?.durationMinutes;
  if (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0 && questionCount > 0) {
    return Math.max(15_000, Math.round(durationMinutes * 60_000 / questionCount));
  }
  return 90_000;
}

function questionEvidenceMetadata(question: QuestionRecord, values: JsonObject): JsonObject {
  return {
    ...values,
    questionOriginType: question.originType ?? 'ai_generated',
    questionSourceId: question.sourceId ?? null,
    questionCalibrationRole: question.calibrationRole ?? 'none',
    questionIsOfficial: question.isOfficial ?? false
  };
}

function speedScore(elapsedMs: number, targetMs: number): number {
  if (elapsedMs <= targetMs) return 1;
  return Math.round(Math.max(0, 1 - (elapsedMs - targetMs) / (targetMs * 1.5)) * 10_000) / 10_000;
}

function correctOptionIdOf(question: QuestionRecord): string {
  const value = question.correctAnswer.optionId;
  if (typeof value !== 'string' || !question.content.options.some((option) => option.id === value)) {
    throw new Error(`Question has invalid single-choice answer contract: ${question.id}`);
  }
  return value;
}

function sessionTypeFor(role: AssessmentRole): typeof LearningSessionType[keyof typeof LearningSessionType] {
  if (role === AssessmentRole.Retention) return LearningSessionType.Retention;
  if (role === AssessmentRole.Transfer) return LearningSessionType.Transfer;
  if (role === AssessmentRole.Anchor) return LearningSessionType.Anchor;
  return LearningSessionType.Practice;
}

function initialDiagnosisDetail(result: typeof AttemptResult[keyof typeof AttemptResult]): string {
  if (result === AttemptResult.Unanswered) {
    return '本题未作答。当前只有结果事实，尚未记录题型识别、方法选择或关键条件判断，不能直接推断具体错因。';
  }
  return '本题结果为错误。当前只有选项结果，尚未记录题型识别、方法选择或推理过程，不能直接归因为概念不清、粗心或方法错误。';
}

function summary(
  session: { readonly id: LearningSessionId; readonly examCycleId: string; readonly questionCount: number; readonly answeredCount: number; readonly correctCount: number },
  attemptCount: number,
  diagnosisCount: number,
  capabilityNodeId: CapabilityNodeId | undefined
): ObjectiveSessionSubmissionResult {
  if (!capabilityNodeId) throw new Error('Submitted objective session contains no capability evidence');
  return {
    sessionId: session.id,
    examCycleId: session.examCycleId,
    capabilityNodeId,
    total: session.questionCount,
    answered: session.answeredCount,
    correct: session.correctCount,
    incorrect: attemptCount - session.correctCount - (session.questionCount - session.answeredCount),
    unanswered: session.questionCount - session.answeredCount,
    diagnosisCount
  };
}
