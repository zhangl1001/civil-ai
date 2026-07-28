import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  QuestionId,
  QuestionReferencePackId,
  QuestionSetId,
  QuestionSourceId
} from '@/kernel/public';

export interface TrueQuestionReferenceExample {
  readonly questionId: QuestionId;
  readonly questionSetId: QuestionSetId;
  readonly sourceId?: QuestionSourceId;
  readonly sourceSequence?: number;
  readonly difficulty: number;
  readonly material?: string;
  readonly prompt: string;
  readonly options: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly correctOptionId: string;
  readonly structuralSignature: JsonObject;
}

export interface TrueQuestionReferencePack {
  readonly id: QuestionReferencePackId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly module: string;
  readonly examScope: JsonObject;
  readonly sourceQuestionCount: number;
  readonly sourceSetCount: number;
  readonly sourceIds: readonly QuestionSourceId[];
  readonly questionTypeDistribution: JsonObject;
  readonly difficultyDistribution: JsonObject;
  readonly structuralDistribution: JsonObject;
  readonly distractorPatterns: readonly string[];
  readonly representativeQuestions: readonly TrueQuestionReferenceExample[];
  readonly comparisonQuestions?: readonly Pick<
    TrueQuestionReferenceExample,
    'questionId' | 'prompt' | 'options'
  >[];
  readonly policyVersion: string;
  readonly contentHash: string;
  readonly createdAt: InstantMs;
}

export interface QuestionReferencePackRepository {
  find(referencePackId: QuestionReferencePackId): Promise<TrueQuestionReferencePack | undefined>;
  findByContentHash(contentHash: string): Promise<TrueQuestionReferencePack | undefined>;
  save(referencePack: TrueQuestionReferencePack, context: TransactionContext): Promise<void>;
}
