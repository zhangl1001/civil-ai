export const GeneratedContentBlockCode = {
  QuestionSet: 'question_set',
  Lecture: 'lecture',
  Material: 'material',
  Prompt: 'prompt',
  Options: 'options',
  Answer: 'answer',
  Explanation: 'explanation',
  Diagnosis: 'diagnosis'
} as const;

export type GeneratedContentBlockCode =
  typeof GeneratedContentBlockCode[keyof typeof GeneratedContentBlockCode];

export const GeneratedContentValidationTier = {
  RequiredToPractice: 'required_to_practice',
  PendingEnrichment: 'pending_enrichment',
  PostPractice: 'post_practice'
} as const;

export type GeneratedContentValidationTier =
  typeof GeneratedContentValidationTier[keyof typeof GeneratedContentValidationTier];

export interface GeneratedContentBlockPolicy {
  readonly block: GeneratedContentBlockCode;
  readonly tier: GeneratedContentValidationTier;
}

const policies: Readonly<Record<GeneratedContentBlockCode, GeneratedContentBlockPolicy>> = {
  question_set: policy(GeneratedContentBlockCode.QuestionSet, GeneratedContentValidationTier.RequiredToPractice),
  lecture: policy(GeneratedContentBlockCode.Lecture, GeneratedContentValidationTier.RequiredToPractice),
  material: policy(GeneratedContentBlockCode.Material, GeneratedContentValidationTier.RequiredToPractice),
  prompt: policy(GeneratedContentBlockCode.Prompt, GeneratedContentValidationTier.RequiredToPractice),
  options: policy(GeneratedContentBlockCode.Options, GeneratedContentValidationTier.RequiredToPractice),
  answer: policy(GeneratedContentBlockCode.Answer, GeneratedContentValidationTier.RequiredToPractice),
  explanation: policy(GeneratedContentBlockCode.Explanation, GeneratedContentValidationTier.PendingEnrichment),
  diagnosis: policy(GeneratedContentBlockCode.Diagnosis, GeneratedContentValidationTier.PostPractice)
};

export function generatedContentBlockPolicy(block: GeneratedContentBlockCode): GeneratedContentBlockPolicy {
  return policies[block];
}

function policy(
  block: GeneratedContentBlockCode,
  tier: GeneratedContentValidationTier
): GeneratedContentBlockPolicy {
  return { block, tier };
}
