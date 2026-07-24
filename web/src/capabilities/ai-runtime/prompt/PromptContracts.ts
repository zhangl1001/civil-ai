import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';

export const PromptSectionCode = {
  Role: 'role',
  TeachingObjective: 'teaching_objective',
  InputContract: 'input_contract',
  OutputContract: 'output_contract',
  QualityRules: 'quality_rules',
  SelfCheck: 'self_check'
} as const;

export type PromptSectionCode = typeof PromptSectionCode[keyof typeof PromptSectionCode];

export interface PromptSection {
  readonly code: PromptSectionCode;
  readonly title: string;
  readonly order: number;
  readonly template: string;
}

export interface PromptBundle {
  readonly definitionId: string;
  readonly versionId: PromptVersionId;
  readonly promptCode: string;
  readonly taskType: string;
  readonly description: string;
  readonly version: string;
  readonly contentHash: string;
  readonly createdAt: InstantMs;
  readonly requiredVariables: readonly string[];
  readonly compatibleSchemaVersions: readonly string[];
  readonly responseSchema: JsonObject;
  readonly sections: readonly PromptSection[];
}

export interface CompiledPrompt {
  readonly promptCode: string;
  readonly version: string;
  readonly contentHash: string;
  readonly system: string;
  readonly user: string;
  readonly responseSchema: JsonObject;
}

export type PromptVariables = Readonly<Record<string, string | number | boolean>>;
