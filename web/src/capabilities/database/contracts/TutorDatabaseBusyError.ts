/**
 * Another operation held the local database longer than this caller would
 * wait. The holder is still inside its own deadline, so nothing is stalled:
 * retry on the next tick instead of recovering the connection.
 */
export class TutorDatabaseBusyError extends Error {
  readonly code = 'database.busy';

  constructor(readonly operation: string) {
    super(`本地数据库正忙（${operation}），请稍后重试`);
    this.name = 'TutorDatabaseBusyError';
  }
}

export function isTutorDatabaseBusy(error: unknown): error is TutorDatabaseBusyError {
  return error instanceof TutorDatabaseBusyError;
}
