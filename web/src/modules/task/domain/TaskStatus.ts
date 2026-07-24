export const TaskStatus = {
  Queued: 'queued',
  Running: 'running',
  WaitingForUser: 'waiting_for_user',
  Paused: 'paused',
  Resumable: 'resumable',
  Cancelling: 'cancelling',
  Cancelled: 'cancelled',
  Failed: 'failed',
  Completed: 'completed'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

const values: ReadonlySet<string> = new Set(Object.values(TaskStatus));

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && values.has(value);
}
