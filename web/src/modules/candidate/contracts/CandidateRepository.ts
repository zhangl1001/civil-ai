import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CandidateProfileId,
  AssessmentPolicyVersionId,
  CurriculumVersionId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  LocalDate,
  ProjectId,
  ScoreMeasurementId,
  ScoreTargetId,
  SubjectCode,
  TimeZoneId
} from '@/kernel/public';
import type { ExamCycleStatus } from '../domain/ExamCycleStatus';
import type { ExamPhase } from '../domain/ExamPhase';
import type { ExplanationDepth, ProactiveLevel } from '../domain/LearningPreferenceCodes';
import type { ProjectStatus } from '../domain/ProjectStatus';
import type { ScoreMeasurementType } from '../domain/ScoreMeasurementType';
import type { ScoreTargetSource, ScoreTargetStatus } from '../domain/ScoreTargetStatus';

export interface CandidateProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface CandidateProfile {
  readonly id: CandidateProfileId;
  readonly projectId: ProjectId;
  readonly preferredName?: string;
  readonly timeZone: TimeZoneId;
  readonly preparationExperience?: string;
  readonly currentState: JsonObject;
  readonly extension: JsonObject;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface ExamCycle {
  readonly id: ExamCycleId;
  readonly projectId: ProjectId;
  readonly examType: string;
  readonly examName?: string;
  readonly province?: string;
  readonly position?: string;
  readonly examDate: LocalDate;
  readonly timeZone: TimeZoneId;
  readonly phase: ExamPhase;
  readonly status: ExamCycleStatus;
  readonly curriculumVersionId: CurriculumVersionId;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface ScoreTarget {
  readonly id: ScoreTargetId;
  readonly examCycleId: ExamCycleId;
  readonly subject: SubjectCode;
  readonly targetScore: number;
  readonly maxScore: number;
  readonly source: ScoreTargetSource;
  readonly reason?: string;
  readonly status: ScoreTargetStatus;
  readonly effectiveFrom: InstantMs;
  readonly supersedesTargetId?: ScoreTargetId;
  readonly createdAt: InstantMs;
}

export interface ScoreMeasurement {
  readonly id: ScoreMeasurementId;
  readonly examCycleId: ExamCycleId;
  readonly subject: SubjectCode;
  readonly module?: string;
  readonly score: number;
  readonly maxScore: number;
  readonly measurementType: ScoreMeasurementType;
  readonly source: string;
  readonly measuredAt: InstantMs;
  readonly confidence: number;
  readonly metadata: JsonObject;
  readonly createdAt: InstantMs;
}

export interface StudyConstraints {
  readonly id: string;
  readonly examCycleId: ExamCycleId;
  readonly studyMode: string;
  readonly weeklyStudyDays: number;
  readonly weekdayMinutes: number;
  readonly weekendMinutes: number;
  readonly maxFocusMinutes?: number;
  readonly availableWindows: readonly JsonObject[];
  readonly interruptionRisks: readonly JsonObject[];
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface LearningPreferences {
  readonly id: string;
  readonly examCycleId: ExamCycleId;
  readonly teachingOrder: string;
  readonly explanationDepth: ExplanationDepth;
  readonly proactiveLevel: ProactiveLevel;
  readonly companionTone: string;
  readonly quietHours: readonly JsonObject[];
  readonly accessibility: JsonObject;
  readonly extension: JsonObject;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface ExamCyclePolicyBinding {
  readonly examCycleId: ExamCycleId;
  readonly subject: SubjectCode;
  readonly policyType: string;
  readonly assessmentPolicyVersionId: AssessmentPolicyVersionId;
  readonly boundAt: InstantMs;
}

export interface OnboardingDraft {
  readonly id: string;
  readonly stepCode: string;
  readonly data: JsonObject;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly expiresAt?: InstantMs;
}

export interface CandidateCycleBundle {
  readonly project: CandidateProject;
  readonly profile: CandidateProfile;
  readonly examCycle: ExamCycle;
  readonly scoreTargets: readonly ScoreTarget[];
  readonly scoreMeasurements: readonly ScoreMeasurement[];
  readonly studyConstraints: StudyConstraints;
  readonly learningPreferences: LearningPreferences;
  readonly policyBindings: readonly ExamCyclePolicyBinding[];
}

export interface CandidateRepository {
  createCycleBundle(bundle: CandidateCycleBundle, context: TransactionContext): Promise<void>;
  replaceActiveScoreTargets(targets: readonly ScoreTarget[], context: TransactionContext): Promise<void>;
  findCurrentCycle(): Promise<CandidateCycleBundle | undefined>;
  findCycle(examCycleId: ExamCycleId): Promise<CandidateCycleBundle | undefined>;
  findActiveCycle(projectId: ProjectId): Promise<CandidateCycleBundle | undefined>;
  saveOnboardingDraft(draft: OnboardingDraft): Promise<void>;
  findOnboardingDraft(draftId: string): Promise<OnboardingDraft | undefined>;
  deleteOnboardingDraft(draftId: string, context: TransactionContext): Promise<void>;
}
