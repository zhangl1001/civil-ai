import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, LearningSessionId } from '@/kernel/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { GetObjectiveSessionReview } from '@/modules/evidence/public';
import { ErrorCauseCode } from '@/modules/evidence/public';
import type { MasteryRepository, MasteryTrack } from '@/modules/mastery/public';
import type { DailyPlanRepository } from '@/modules/planning/public';
import type { TutorCycleRepository } from '../contracts/TutorCycleRepository';
import {
  TUTOR_CYCLE_POLICY_VERSION,
  TutorCycleConclusionType,
  TutorDecisionScope
} from '../domain/TutorCycleCodes';

export class RecordObjectiveTutorConclusion {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: TutorCycleRepository,
    private readonly review: GetObjectiveSessionReview,
    private readonly candidates: CandidateRepository,
    private readonly curriculums: CurriculumRepository,
    private readonly mastery: MasteryRepository,
    private readonly plans: DailyPlanRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: {
    readonly idempotencyKey: string;
    readonly sessionId: LearningSessionId;
    readonly diagnosisRunIds: readonly string[];
    readonly pendingSteps: readonly string[];
  }) {
    const existing = await this.repository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return existing;
    const sessionReview = await this.review.execute(command.sessionId);
    if (!sessionReview) throw new Error(`Learning session does not exist: ${command.sessionId}`);
    const cycle = await this.candidates.findCycle(sessionReview.session.examCycleId);
    if (!cycle) throw new Error(`Exam cycle does not exist: ${sessionReview.session.examCycleId}`);
    const curriculum = await this.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
    const nodeById = new Map(curriculum?.capabilityNodes.map((node) => [node.id, node]) ?? []);
    const capabilityIds = [...new Set(sessionReview.items.map((item) => item.attempt.capabilityNodeId))];
    const [tracks, reviews, plan] = await Promise.all([
      Promise.all(capabilityIds.map((id) => this.mastery.findTrack(cycle.examCycle.id, id))),
      this.mastery.listReviews(cycle.examCycle.id, 40),
      this.plans.findCurrent(cycle.examCycle.id, localDate(this.clock.now(), cycle.examCycle.timeZone))
    ]);
    const incorrect = sessionReview.items.filter((item) => item.grading.result === 'incorrect');
    const diagnoses = incorrect.flatMap((item) => item.diagnoses);
    const knownDiagnoses = diagnoses.filter((item) => item.causeCode !== ErrorCauseCode.Unknown);
    const resolvedTracks = tracks.filter((track): track is MasteryTrack => Boolean(track));
    const nextAction = actionFor(resolvedTracks);
    const now = this.clock.now();
    const conclusion: import('../contracts/TutorCycleRepository').TutorCycleConclusion = {
      id: this.ids.next('TutorCycleConclusionId'),
      examCycleId: sessionReview.session.examCycleId,
      learningThreadId: sessionReview.session.learningThreadId,
      learningSessionId: sessionReview.session.id,
      questionSetId: sessionReview.session.questionSetId,
      capabilityNodeIds: capabilityIds,
      conclusionType: TutorCycleConclusionType.ObjectiveSession,
      decisionScope: new Set(capabilityIds.map((id) => nodeById.get(id)?.module).filter(Boolean)).size > 1
        ? TutorDecisionScope.CrossModule
        : capabilityIds.length > 1 ? TutorDecisionScope.SingleModule : TutorDecisionScope.SingleCapability,
      observation: {
        questionCount: sessionReview.session.questionCount,
        answeredCount: sessionReview.session.answeredCount,
        correctCount: sessionReview.session.correctCount,
        elapsedMs: sessionReview.session.elapsedMs,
        assessmentRole: sessionReview.session.assessmentRole,
        capabilities: capabilityIds.map((id) => ({
          capabilityNodeId: id,
          code: nodeById.get(id)?.code ?? null,
          name: nodeById.get(id)?.name ?? null,
          module: nodeById.get(id)?.module ?? null
        }))
      },
      diagnosis: {
        status: incorrect.length === 0 ? 'not_needed' : knownDiagnoses.length ? 'available' : 'pending',
        incorrectCount: incorrect.length,
        knownCauseCodes: [...new Set(knownDiagnoses.map((item) => item.causeCode))],
        pendingDiagnosisRunIds: [...command.diagnosisRunIds]
      },
      proposal: {
        nextAction: nextAction.action,
        reason: nextAction.reason,
        requiresConfirmation: false
      },
      execution: {
        type: 'objective_practice',
        learningSessionId: sessionReview.session.id,
        questionSetId: sessionReview.session.questionSetId,
        completedAt: sessionReview.session.completedAt
      },
      assessment: {
        accuracy: ratio(sessionReview.session.correctCount, sessionReview.session.answeredCount),
        averageSecondsPerAnswered: sessionReview.session.answeredCount > 0
          ? Math.round(sessionReview.session.elapsedMs / sessionReview.session.answeredCount / 100) / 10
          : null,
        mastery: resolvedTracks.map((track) => ({
          capabilityNodeId: track.capabilityNodeId,
          state: track.state,
          accuracy: track.accuracy,
          speed: track.speed,
          retention: track.retention,
          transfer: track.transfer,
          confidence: track.confidence,
          effectiveSample: track.effectiveSample
        })),
        pendingSteps: [...command.pendingSteps]
      },
      schedule: {
        reviews: reviews.filter((item) => capabilityIds.includes(item.capabilityNodeId) && item.status === 'scheduled').slice(0, 6).map((item) => ({
          reviewQueueItemId: item.id,
          capabilityNodeId: item.capabilityNodeId,
          reviewType: item.reviewType,
          dueAt: item.dueAt,
          reason: item.reason
        })),
        dailyPlanItems: (plan?.items ?? []).filter((item) => capabilityIds.includes(item.capabilityNodeId)).slice(0, 6).map((item) => ({
          dailyPlanItemId: item.id,
          capabilityNodeId: item.capabilityNodeId,
          itemType: item.itemType,
          status: item.status,
          reason: item.reason
        }))
      },
      policyVersion: TUTOR_CYCLE_POLICY_VERSION,
      idempotencyKey: command.idempotencyKey,
      createdAt: now
    };
    await this.unitOfWork.run((context) => this.repository.append(conclusion, context));
    return conclusion;
  }
}

function actionFor(tracks: readonly MasteryTrack[]) {
  if (!tracks.length) return { action: 'diagnose', reason: '当前证据不足，先补能力样本。' };
  const weakest = [...tracks].sort((left, right) => left.stability - right.stability || left.accuracy - right.accuracy)[0]!;
  if (weakest.state === 'regressed' || weakest.accuracy < 0.55) return { action: 'repair', reason: '正确率或稳定性不足，下一步先纠正当前错误模式。' };
  if (weakest.state === 'learning' || weakest.state === 'diagnosed') return { action: 'guided_practice', reason: '概念正在形成，下一步需要带反馈的针对性练习。' };
  if (weakest.state === 'practicing') return { action: 'independent_practice', reason: '进入独立作答阶段，需要补充无提示证据。' };
  if (weakest.state === 'consolidating') return { action: 'transfer', reason: '基础表现已稳定，下一步验证变式迁移能力。' };
  return { action: 'retention_review', reason: '当前表现稳定，按间隔复习维持掌握。' };
}

function ratio(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 10_000) / 10_000 : null;
}

function localDate(now: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) as Parameters<DailyPlanRepository['findCurrent']>[1];
}
