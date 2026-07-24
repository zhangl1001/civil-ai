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
