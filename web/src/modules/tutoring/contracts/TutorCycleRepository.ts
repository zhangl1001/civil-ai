import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  LearningSessionId,
  LearningThreadId,
  QuestionSetId,
  TutorCycleConclusionId
} from '@/kernel/public';
import type {
  TutorCycleConclusionType,
  TutorDecisionScope
} from '../domain/TutorCycleCodes';

export interface TutorCycleConclusion {
  readonly id: TutorCycleConclusionId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId: LearningThreadId;
  readonly learningSessionId: LearningSessionId;
  readonly questionSetId: QuestionSetId;
  readonly capabilityNodeIds: readonly CapabilityNodeId[];
  readonly conclusionType: TutorCycleConclusionType;
  readonly decisionScope: TutorDecisionScope;
  readonly observation: JsonObject;
  readonly diagnosis: JsonObject;
  readonly proposal: JsonObject;
  readonly execution: JsonObject;
  readonly assessment: JsonObject;
  readonly schedule: JsonObject;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
  readonly createdAt: InstantMs;
}

export interface TutorCycleRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<TutorCycleConclusion | undefined>;
  findLatestBySession(sessionId: LearningSessionId): Promise<TutorCycleConclusion | undefined>;
  listRecent(examCycleId: ExamCycleId, limit: number): Promise<readonly TutorCycleConclusion[]>;
  append(conclusion: TutorCycleConclusion, context: TransactionContext): Promise<void>;
}
