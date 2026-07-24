export type QuestionType = 'single' | 'multiple' | 'essay' | 'unknown';

export const QUESTION_CONTENT_KINDS = {
  SINGLE: 'single',
  SHARED_MATERIAL: 'shared_material'
} as const;

export type QuestionContentKind = typeof QUESTION_CONTENT_KINDS[keyof typeof QUESTION_CONTENT_KINDS];

export const QUESTION_RENDER_TEMPLATES = {
  STANDARD: 'standard',
  GRAPHIC: 'graphic',
  DATA_ANALYSIS: 'data_analysis',
  SHARED_MATERIAL: 'shared_material'
} as const;

export type QuestionRenderTemplate = typeof QUESTION_RENDER_TEMPLATES[keyof typeof QUESTION_RENDER_TEMPLATES];

export interface Question {
  id: string;
  projectId: string;
  module: string;
  knowledgePoint?: string;
  type: QuestionType;
  contentKind?: QuestionContentKind;
  renderTemplate?: QuestionRenderTemplate;
  material?: string;
  groupId?: string;
  subQuestionIndex?: number;
  subQuestionCount?: number;
  stem: string;
  options: string[];
  answer: string | string[];
  explanation?: string;
  lectureId?: string;
  sourceFile?: string;
  sourceDate?: string;
  createdAt: number;
  updatedAt: number;
}
