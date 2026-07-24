export type TaskStatus = 'queued' | 'running' | 'retrying' | 'paused' | 'done' | 'failed' | 'cancelled';

export type TaskType = 'chat' | 'generate' | 'grade' | 'essay' | 'digest' | 'study' | 'mock' | 'redo' | 'interview' | 'sync' | 'demo';

export interface LocalTask {
  id: string;
  type: TaskType;
  projectId: string;
  status: TaskStatus;
  title: string;
  detail?: string;
  progress: number;
  progressText?: string;
  inputHash?: string;
  lockKey?: string;
  payload?: Record<string, unknown>;
  resultRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskLog {
  id: string;
  taskId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: number;
}
