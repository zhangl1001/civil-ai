export interface BusinessModel {
  version: number;
  created_at: string;
  exam_type: string;
  exam_name: string;
  province: string;
  exam_date: string;
  position: string;
  requirements: string;
  question_count: number;
  confidence: 'low' | 'medium' | 'high';
  gaps: string[];
}

export interface PlanPhaseMap {
  '基础期'?: string;
  '强化期'?: string;
  '冲刺期'?: string;
}

export interface ExamPlan {
  exam_date?: string;
  exam_name?: string;
  exam_type?: string;
  province?: string;
  mock_exam_count?: number;
  position?: string;
  requirements?: string;
  business_model?: BusinessModel;
  phases?: PlanPhaseMap;
  tasks?: Record<string, DailyPlan>;
}

export interface CreateProjectInput {
  name: string;
  examDate?: string;
  examType?: string;
  province?: string;
  mockExamCount?: number;
  position?: string;
  requirements?: string;
}

export interface TodayTaskPrescription {
  purpose?: string;
  question_count?: number;
  difficulty?: string;
  new_review_ratio?: string;
  reason?: string;
}

export interface PlanTask {
  id: number | string;
  type: 'diagnosis' | 'practice' | 'essay' | 'review' | 'digest' | 'mock';
  module?: string;
  text: string;
  knowledge_point?: string;
  target: number;
  actual: number;
  done: boolean;
  source: string;
  reason?: string;
  sub?: string;
  prescription?: TodayTaskPrescription;
}

export interface DailyPlan {
  generated_by: string;
  phase: string;
  diagnosis?: {
    sample_total: number;
    covered_modules: number;
    gaps: string[];
    ready: boolean;
    label: string;
  };
  items: PlanTask[];
}

export interface SyllabusTarget {
  module: string;
  group: string;
  knowledge_point: string;
  status: string;
  attempts: number;
  accuracy: number;
  proficiency: number;
  errors: number;
  priority: number;
  reason: string;
}
