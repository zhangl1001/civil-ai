export const DB_NAME = 'zhangl-agent-local';
export const DB_VERSION = 7;

export const STORES = {
  projects: 'projects',
  examProfiles: 'exam_profiles',
  settings: 'settings',
  files: 'files',
  practiceLectures: 'practice_lectures',
  questions: 'questions',
  practiceSessions: 'practice_sessions',
  answers: 'answers',
  wrongItems: 'wrong_items',
  abilityProfiles: 'ability_profiles',
  profileStatsSnapshots: 'profile_stats_snapshots',
  abilityDiagnoses: 'ability_diagnoses',
  profileInsights: 'profile_insights',
  learningEvents: 'learning_events',
  digestItems: 'digest_items',
  interviewSessions: 'interview_sessions',
  aiSessions: 'ai_sessions',
  aiMessages: 'ai_messages',
  aiTasks: 'ai_tasks',
  taskLogs: 'task_logs'
} as const;

export type StoreName = typeof STORES[keyof typeof STORES];

export interface FileRecord {
  id: string;
  projectId: string;
  path: string;
  content: string;
  contentType: 'text' | 'json' | 'markdown';
  createdAt: number;
  updatedAt: number;
}

export interface DigestItemRecord {
  id: string;
  projectId: string;
  type: 'news' | 'tips';
  date: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  source?: string;
  sourceRef?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface InterviewSessionRecord {
  id: string;
  projectId: string;
  date: string;
  interviewType: 'structured' | 'group';
  difficulty: 'easy' | 'medium' | 'hard';
  questionTypes: string[];
  questionCount: number;
  answers: unknown[];
  score: {
    content: number;
    expression: number;
    logic: number;
    total: number;
    feedback: string;
  };
  aiFeedback?: string;
  createdAt: number;
  updatedAt: number;
}

export function fileId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}
