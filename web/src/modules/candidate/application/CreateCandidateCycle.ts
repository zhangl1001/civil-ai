import type { UnitOfWork } from '@/capabilities/database/public';
import {
  ApplicationError,
  ErrorCategory,
  parseId,
  type Clock,
  type CurriculumVersionId,
  type IdGenerator,
  type JsonObject,
  type LocalDate,
  type SubjectCode,
  type TimeZoneId
} from '@/kernel/public';
import type { AssessmentPolicyVersion, CurriculumRepository } from '@/modules/curriculum/public';
import type { CommandReceiptRepository, OutboxRepository } from '@/modules/task/public';
import type { CandidateCycleBundle, CandidateRepository } from '../contracts/CandidateRepository';
import { ExamCycleStatus } from '../domain/ExamCycleStatus';
import type { ExamPhase } from '../domain/ExamPhase';
import type { ExplanationDepth, ProactiveLevel } from '../domain/LearningPreferenceCodes';
import {
  BaselineStatus,
  CandidateCommandType,
  CandidateEventType,
  CandidateResourceType,
  type CompanionTone,
  type StudyMode,
  type TeachingOrder
} from '../domain/OnboardingCodes';
import { ProjectStatus } from '../domain/ProjectStatus';
import { ScoreMeasurementType } from '../domain/ScoreMeasurementType';
import { ScoreTargetSource, ScoreTargetStatus } from '../domain/ScoreTargetStatus';

export interface CandidateOnboardingPolicy {
  readonly selfReportConfidence: number;
  readonly minimumFocusMinutes: number;
  readonly maximumFocusMinutes: number;
  readonly maximumDailyMinutes: number;
  readonly draftRetentionMs: number;
}

export const candidateOnboardingPolicy: CandidateOnboardingPolicy = {
  selfReportConfidence: 0.4,
  minimumFocusMinutes: 5,
  maximumFocusMinutes: 240,
  maximumDailyMinutes: 1_440,
  draftRetentionMs: 30 * 24 * 60 * 60 * 1_000
};

export interface OnboardingSubjectScore {
  readonly subject: SubjectCode;
  readonly targetScore: number;
  readonly maxScore: number;
  readonly currentScore?: number;
}

export interface CreateCandidateCycleCommand {
  readonly idempotencyKey: string;
  readonly draftId?: string;
  readonly projectName: string;
  readonly preferredName?: string;
  readonly preparationExperience?: string;
  readonly timeZone: TimeZoneId;
  readonly examType: string;
  readonly examName?: string;
  readonly province?: string;
  readonly position?: string;
  readonly examDate: LocalDate;
  readonly phase: ExamPhase;
  readonly curriculumVersionId: CurriculumVersionId;
  readonly subjectScores: readonly OnboardingSubjectScore[];
  readonly study: {
    readonly mode: StudyMode;
    readonly weeklyStudyDays: number;
    readonly weekdayMinutes: number;
    readonly weekendMinutes: number;
    readonly maxFocusMinutes?: number;
    readonly availableWindows: readonly JsonObject[];
    readonly interruptionRisks: readonly JsonObject[];
  };
  readonly preferences: {
    readonly teachingOrder: TeachingOrder;
    readonly explanationDepth: ExplanationDepth;
    readonly proactiveLevel: ProactiveLevel;
    readonly companionTone: CompanionTone;
    readonly quietHours: readonly JsonObject[];
    readonly accessibility: JsonObject;
  };
}

export class CreateCandidateCycle {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly candidateRepository: CandidateRepository,
    private readonly curriculumRepository: CurriculumRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly receiptRepository: CommandReceiptRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: CandidateOnboardingPolicy
  ) {}

  async execute(command: CreateCandidateCycleCommand): Promise<CandidateCycleBundle> {
    this.validateCommand(command);
    const previous = await this.findIdempotentResult(command.idempotencyKey);
    if (previous) return previous;

    const current = await this.candidateRepository.findCurrentCycle();
    if (current) {
      throw this.conflict('candidate.active_cycle_exists', { examCycleId: current.examCycle.id });
    }

    const curriculum = await this.curriculumRepository.findBundle(command.curriculumVersionId);
    if (!curriculum || curriculum.curriculum.status !== 'published') {
      throw new ApplicationError({
        code: 'candidate.curriculum_unavailable',
        category: ErrorCategory.NotFound,
        userMessageKey: 'candidate.onboarding.curriculumUnavailable'
      });
    }

    const bundle = this.createBundle(command, curriculum.assessmentPolicies);
    try {
      await this.unitOfWork.run(async (context) => {
        await this.candidateRepository.createCycleBundle(bundle, context);
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: CandidateResourceType.ExamCycle,
          aggregateId: bundle.examCycle.id,
          eventType: CandidateEventType.ExamCycleCreated,
          payload: {
            projectId: bundle.project.id,
            examCycleId: bundle.examCycle.id,
            curriculumVersionId: bundle.examCycle.curriculumVersionId
          },
          occurredAt: bundle.examCycle.createdAt,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:exam-cycle-created`
        }, context);
        await this.receiptRepository.append({
          idempotencyKey: command.idempotencyKey,
          commandType: CandidateCommandType.CreateExamCycle,
          resultResourceType: CandidateResourceType.ExamCycle,
          resultResourceId: bundle.examCycle.id,
          completedAt: bundle.examCycle.createdAt
        }, context);
        if (command.draftId) await this.candidateRepository.deleteOnboardingDraft(command.draftId, context);
      });
      return bundle;
    } catch (error) {
      const concurrentResult = await this.findIdempotentResult(command.idempotencyKey);
      if (concurrentResult) return concurrentResult;
      const conflictingCycle = await this.candidateRepository.findCurrentCycle();
      if (conflictingCycle) {
        throw this.conflict('candidate.active_cycle_created_concurrently', {
          examCycleId: conflictingCycle.examCycle.id
        });
      }
      throw error;
    }
  }

  private createBundle(
    command: CreateCandidateCycleCommand,
    policies: readonly AssessmentPolicyVersion[]
  ): CandidateCycleBundle {
    const now = this.clock.now();
    const projectId = this.ids.next('ProjectId');
    const examCycleId = this.ids.next('ExamCycleId');
    const measurements = command.subjectScores.flatMap((subject) => subject.currentScore === undefined ? [] : [{
      id: this.ids.next('ScoreMeasurementId'),
      examCycleId,
      subject: subject.subject,
      score: subject.currentScore,
      maxScore: subject.maxScore,
      measurementType: ScoreMeasurementType.SelfReport,
      source: 'candidate_onboarding',
      measuredAt: now,
      confidence: this.policy.selfReportConfidence,
      metadata: { collectionStage: 'onboarding' },
      createdAt: now
    }]);
    const targetSubjects = command.subjectScores.map((score) => score.subject);
    const subjectSet = new Set<string>(targetSubjects);
    const policyBindings = policies
      .filter((policy) => policy.status === 'published' && subjectSet.has(policy.subject))
      .map((policy) => ({
        examCycleId,
        subject: policy.subject,
        policyType: policy.policyType,
        assessmentPolicyVersionId: policy.id,
        boundAt: now
      }));
    for (const subject of targetSubjects) {
      if (!policyBindings.some((binding) => binding.subject === subject && binding.policyType === 'mastery')) {
        throw new ApplicationError({
          code: 'candidate.mastery_policy_missing',
          category: ErrorCategory.Validation,
          userMessageKey: 'candidate.onboarding.masteryPolicyMissing',
          details: { subject }
        });
      }
    }

    return {
      project: {
        id: projectId,
        name: command.projectName.trim(),
        status: ProjectStatus.Active,
        createdAt: now,
        updatedAt: now,
        version: 1
      },
      profile: {
        id: this.ids.next('CandidateProfileId'),
        projectId,
        preferredName: command.preferredName?.trim() || undefined,
        timeZone: command.timeZone,
        preparationExperience: command.preparationExperience?.trim() || undefined,
        currentState: {
          baselineStatus: measurements.length > 0 ? BaselineStatus.SelfReported : BaselineStatus.NeedsDiagnosis,
          targetSubjects
        },
        extension: {},
        createdAt: now,
        updatedAt: now,
        version: 1
      },
      examCycle: {
        id: examCycleId,
        projectId,
        examType: command.examType.trim(),
        examName: command.examName?.trim() || undefined,
        province: command.province?.trim() || undefined,
        position: command.position?.trim() || undefined,
        examDate: command.examDate,
        timeZone: command.timeZone,
        phase: command.phase,
        status: ExamCycleStatus.Active,
        curriculumVersionId: command.curriculumVersionId,
        createdAt: now,
        updatedAt: now,
        version: 1
      },
      scoreTargets: command.subjectScores.map((subject) => ({
        id: this.ids.next('ScoreTargetId'),
        examCycleId,
        subject: subject.subject,
        targetScore: subject.targetScore,
        maxScore: subject.maxScore,
        source: ScoreTargetSource.Candidate,
        status: ScoreTargetStatus.Active,
        effectiveFrom: now,
        createdAt: now
      })),
      scoreMeasurements: measurements,
      studyConstraints: {
        id: this.ids.next('StudyConstraintsId'),
        examCycleId,
        studyMode: command.study.mode,
        weeklyStudyDays: command.study.weeklyStudyDays,
        weekdayMinutes: command.study.weekdayMinutes,
        weekendMinutes: command.study.weekendMinutes,
        maxFocusMinutes: command.study.maxFocusMinutes,
        availableWindows: command.study.availableWindows,
        interruptionRisks: command.study.interruptionRisks,
        updatedAt: now,
        version: 1
      },
      learningPreferences: {
        id: this.ids.next('LearningPreferencesId'),
        examCycleId,
        teachingOrder: command.preferences.teachingOrder,
        explanationDepth: command.preferences.explanationDepth,
        proactiveLevel: command.preferences.proactiveLevel,
        companionTone: command.preferences.companionTone,
        quietHours: command.preferences.quietHours,
        accessibility: command.preferences.accessibility,
        extension: {},
        updatedAt: now,
        version: 1
      },
      policyBindings
    };
  }

  private async findIdempotentResult(idempotencyKey: string): Promise<CandidateCycleBundle | undefined> {
    const receipt = await this.receiptRepository.find(idempotencyKey);
    if (!receipt) return undefined;
    if (
      receipt.commandType !== CandidateCommandType.CreateExamCycle
      || receipt.resultResourceType !== CandidateResourceType.ExamCycle
    ) {
      throw this.conflict('candidate.idempotency_key_reused', { idempotencyKey });
    }
    const examCycleId = parseId<'ExamCycleId'>(receipt.resultResourceId, 'receipt.resultResourceId');
    const bundle = await this.candidateRepository.findCycle(examCycleId);
    if (!bundle) throw new Error(`Command receipt points to missing exam cycle ${examCycleId}`);
    return bundle;
  }

  private validateCommand(command: CreateCandidateCycleCommand): void {
    if (!command.idempotencyKey.trim()) throw this.validation('candidate.idempotency_key_required');
    const projectName = command.projectName.trim();
    if (!projectName || projectName.length > 80) throw this.validation('candidate.project_name_invalid');
    if (!command.examType.trim()) throw this.validation('candidate.exam_type_required');
    this.validateTimeZone(command.timeZone);
    this.validateLocalDate(command.examDate);
    if (command.subjectScores.length === 0) throw this.validation('candidate.subject_scores_required');
    const subjects = new Set<string>();
    for (const score of command.subjectScores) {
      if (subjects.has(score.subject)) throw this.validation('candidate.subject_score_duplicate', { subject: score.subject });
      subjects.add(score.subject);
      if (!Number.isFinite(score.maxScore) || score.maxScore <= 0) throw this.validation('candidate.max_score_invalid');
      if (!Number.isFinite(score.targetScore) || score.targetScore < 0 || score.targetScore > score.maxScore) {
        throw this.validation('candidate.target_score_invalid', { subject: score.subject });
      }
      if (score.currentScore !== undefined && (
        !Number.isFinite(score.currentScore) || score.currentScore < 0 || score.currentScore > score.maxScore
      )) {
        throw this.validation('candidate.current_score_invalid', { subject: score.subject });
      }
    }
    if (!Number.isInteger(command.study.weeklyStudyDays) || command.study.weeklyStudyDays < 1 || command.study.weeklyStudyDays > 7) {
      throw this.validation('candidate.weekly_study_days_invalid');
    }
    for (const minutes of [command.study.weekdayMinutes, command.study.weekendMinutes]) {
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > this.policy.maximumDailyMinutes) {
        throw this.validation('candidate.daily_minutes_invalid');
      }
    }
    if (command.study.maxFocusMinutes !== undefined && (
      !Number.isInteger(command.study.maxFocusMinutes)
      || command.study.maxFocusMinutes < this.policy.minimumFocusMinutes
      || command.study.maxFocusMinutes > this.policy.maximumFocusMinutes
    )) {
      throw this.validation('candidate.focus_minutes_invalid');
    }
  }

  private validateTimeZone(timeZone: TimeZoneId): void {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone }).format(0);
    } catch {
      throw this.validation('candidate.time_zone_invalid');
    }
  }

  private validateLocalDate(localDate: LocalDate): void {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
    if (!match) throw this.validation('candidate.exam_date_invalid');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      throw this.validation('candidate.exam_date_invalid');
    }
  }

  private validation(code: string, details?: Readonly<Record<string, unknown>>): ApplicationError {
    return new ApplicationError({
      code,
      category: ErrorCategory.Validation,
      userMessageKey: 'candidate.onboarding.validationFailed',
      details
    });
  }

  private conflict(code: string, details: Readonly<Record<string, unknown>>): ApplicationError {
    return new ApplicationError({
      code,
      category: ErrorCategory.Conflict,
      userMessageKey: 'candidate.onboarding.conflict',
      details
    });
  }
}
