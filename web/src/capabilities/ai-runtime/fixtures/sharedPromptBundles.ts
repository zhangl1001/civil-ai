import type { PromptBundle } from '../prompt/PromptContracts';
import { errorDiagnosisBatchPromptV1 } from './errorDiagnosisBatchPromptV1';
import { errorDiagnosisPromptV1 } from './errorDiagnosisPromptV1';
import { questionImportPolicyV1 } from './questionImportPolicyV1';
import { questionSetEnrichmentPromptV1 } from './questionSetEnrichmentPromptV1';
import { structuredObjectivePromptV2 } from './structuredObjectivePromptV2';

/**
 * Prompts every exam package inherits. A package ships wording only for the
 * tasks whose voice differs; everything else resolves here.
 *
 * Listed once so the native and web composition roots cannot drift apart on
 * which prompts the runtime is expected to have.
 */
export const sharedPromptBundles: readonly PromptBundle[] = [
  structuredObjectivePromptV2,
  questionSetEnrichmentPromptV1,
  questionImportPolicyV1,
  errorDiagnosisPromptV1,
  errorDiagnosisBatchPromptV1
];
