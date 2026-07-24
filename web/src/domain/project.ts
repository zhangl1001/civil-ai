export type ProjectStatus = 'onboarding' | 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  status?: ProjectStatus;
  activeProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}

export type ExamProfileStatus = 'draft' | 'active' | 'archived';

export interface ExamScoreSet {
  xingce?: number;
  shenlun?: number;
  interview?: number;
}

export interface ExamProfileTimeBudget {
  dailyStudyMinutes?: number;
  weeklyStudyDays?: number;
  isFullTime?: boolean;
  weekdayMinutes?: number;
  weekendMinutes?: number;
  preferredStudySlots?: string[];
}

export interface ExamProfileBaseline {
  source?: 'self_report' | 'mock' | 'imported';
  latestMockLimited?: boolean;
  latestMockDate?: string;
  previousAttempts?: number;
  weakestModules?: string[];
  weakQuestionTypes?: string[];
  strengths?: string[];
  blockers?: string[];
  selfAssessment?: string;
}

export interface ExamProfilePreferences {
  intensity?: 'light' | 'standard' | 'high';
  taskStyle?: 'short' | 'balanced' | 'deep';
  encouragementStyle?: 'calm' | 'strict' | 'warm';
  reviewPreference?: 'daily' | 'spaced' | 'exam_first';
  dailyQuestionTarget?: number;
}

export interface ExamProfile {
  id: string;
  projectId: string;
  version: number;
  status: ExamProfileStatus;
  examType?: string;
  examName?: string;
  province?: string;
  examDate?: string;
  position?: string;
  requirements?: string;
  currentScores: ExamScoreSet;
  targetScores: ExamScoreSet;
  timeBudget: ExamProfileTimeBudget;
  baseline: ExamProfileBaseline;
  preferences: ExamProfilePreferences;
  createdAt: number;
  updatedAt: number;
}
