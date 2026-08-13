export const MetadataPackageStatus = {
  Draft: 'draft',
  Published: 'published',
  Retired: 'retired',
  Rejected: 'rejected'
} as const;

export type MetadataPackageStatus = typeof MetadataPackageStatus[keyof typeof MetadataPackageStatus];

export const CurriculumStatus = {
  Draft: 'draft',
  Published: 'published',
  Retired: 'retired'
} as const;

export type CurriculumStatus = typeof CurriculumStatus[keyof typeof CurriculumStatus];

export const CapabilityNodeType = {
  Subject: 'subject',
  Module: 'module',
  QuestionType: 'question_type',
  KnowledgePoint: 'knowledge_point',
  SubPoint: 'sub_point',
  CognitiveSkill: 'cognitive_skill',
  ProblemSolvingSkill: 'problem_solving_skill',
  ExamStrategy: 'exam_strategy',
  ExpressionSkill: 'expression_skill'
} as const;

export type CapabilityNodeType = typeof CapabilityNodeType[keyof typeof CapabilityNodeType];

export const CapabilityRelationType = {
  Prerequisite: 'prerequisite',
  Contains: 'contains',
  Related: 'related',
  Confusable: 'confusable',
  Transfer: 'transfer'
} as const;

export type CapabilityRelationType = typeof CapabilityRelationType[keyof typeof CapabilityRelationType];

export const AssessmentPolicyStatus = {
  Draft: 'draft',
  Published: 'published',
  Retired: 'retired'
} as const;

export type AssessmentPolicyStatus = typeof AssessmentPolicyStatus[keyof typeof AssessmentPolicyStatus];

/**
 * Policy types are evolvable metadata, so the contract keeps `policyType` open.
 * These constants only name the types this codebase resolves, so call sites do
 * not repeat raw strings.
 */
export const AssessmentPolicyType = {
  Mastery: 'mastery',
  GradingRubric: 'grading_rubric',
  ExamDelivery: 'exam_delivery'
} as const;

export type AssessmentPolicyType = typeof AssessmentPolicyType[keyof typeof AssessmentPolicyType];

/**
 * How a subject is answered and graded. Objective subjects have a deterministic
 * answer key; subjective subjects are graded against a rubric. Exam flows branch
 * on this instead of on a subject name, so a new exam pack only ships metadata.
 */
export const ExamDeliveryKind = {
  Objective: 'objective',
  Subjective: 'subjective'
} as const;

export type ExamDeliveryKind = typeof ExamDeliveryKind[keyof typeof ExamDeliveryKind];

const EXAM_DELIVERY_KINDS: readonly string[] = Object.values(ExamDeliveryKind);

export function isExamDeliveryKind(value: unknown): value is ExamDeliveryKind {
  return typeof value === 'string' && EXAM_DELIVERY_KINDS.includes(value);
}

export function parseExamDeliveryKind(value: unknown): ExamDeliveryKind | undefined {
  return isExamDeliveryKind(value) ? value : undefined;
}
