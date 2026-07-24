export const TUTOR_DATABASE_NAME = 'zhangl-agent-tutor-v1';

export interface TutorDatabaseConfig {
  readonly name: typeof TUTOR_DATABASE_NAME;
  readonly version: number;
  readonly busyTimeoutMs: number;
  readonly journalMode: 'WAL';
  readonly foreignKeys: true;
}

export const tutorDatabaseConfig: TutorDatabaseConfig = {
  name: TUTOR_DATABASE_NAME,
  version: 1,
  busyTimeoutMs: 5_000,
  journalMode: 'WAL',
  foreignKeys: true
};
