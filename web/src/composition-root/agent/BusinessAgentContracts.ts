import type { JsonObject } from '@/kernel/public';
import type {
  LearningAssetKind as LearningAssetKindCode,
  LearningAssetPurpose as LearningAssetPurposeCode
} from '@/modules/content/public';
import type { AITextMessage, AITextRequestOptions } from '../ai/ConfiguredAIClient';

export type BusinessAgentTaskType =
  | 'chat'
  | 'generate'
  | 'grade'
  | 'digest'
  | 'study'
  | 'mock'
  | 'redo'
  | 'interview'
  | 'research';

export interface BusinessAgentTask {
  readonly id: string;
  readonly type: BusinessAgentTaskType;
  readonly detail?: string;
  readonly payload: Record<string, unknown>;
}

export interface BusinessAgentExecutionContext {
  readonly signal: AbortSignal;
  compilePrompt(
    promptCode: string,
    payload: Record<string, unknown>
  ): { readonly system: string; readonly user: string; readonly responseSchema: JsonObject };
  update(progress: number, progressText?: string): Promise<void>;
  log(message: string): Promise<void>;
  setResult(result: {
    readonly resultRef?: string;
    readonly payload?: Record<string, unknown>;
  }): Promise<void>;
  complete(
    messages: readonly AITextMessage[],
    options?: AITextRequestOptions
  ): Promise<string>;
  stream(
    messages: readonly AITextMessage[],
    onDelta: (delta: string) => void | Promise<void>,
    options?: AITextRequestOptions
  ): Promise<string>;
  generatePractice(input: {
    readonly module: string;
    readonly knowledgePoint?: string;
    readonly requestedCount: number;
    readonly difficultyMin: number;
    readonly difficultyMax: number;
    readonly purpose: string;
    readonly review: boolean;
    readonly capabilityIndex?: number;
  }): Promise<{
    readonly questionSetId: string;
    readonly learningThreadId: string;
    readonly capabilityNodeId: string;
    readonly capabilityCode: string;
  }>;
  saveLearningAsset(input: {
    readonly kind: LearningAssetKindCode;
    readonly businessKey: string;
    readonly title: string;
    readonly payload: Record<string, unknown>;
    readonly purpose?: LearningAssetPurposeCode;
  }): Promise<{ readonly id: string; readonly version: number }>;
  findLatestLearningAsset(input: {
    readonly kind: LearningAssetKindCode;
    readonly businessKey: string;
  }): Promise<{ readonly id: string; readonly payload: Record<string, unknown> } | undefined>;
  listLearningAssets(input: {
    readonly kinds: readonly LearningAssetKindCode[];
    readonly limit: number;
  }): Promise<readonly {
    readonly id: string;
    readonly businessKey: string;
    readonly title: string;
    readonly payload: Record<string, unknown>;
    readonly createdAt: number;
  }[]>;
  recordSubjectiveAssessment(input: {
    readonly sourceAssetId: string;
    readonly rubricVersion: string;
    readonly dimensions: readonly {
      readonly capabilityCode: string;
      readonly dimensionKey: string;
      readonly score: number;
      readonly confidence: number;
      readonly metadata: Record<string, unknown>;
    }[];
  }): Promise<void>;
}

export type BusinessAgentExecutor = (
  task: BusinessAgentTask,
  context: BusinessAgentExecutionContext
) => Promise<void>;
