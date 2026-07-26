export interface TutorDatabaseLifecycle {
  waitUntilReady(): Promise<void>;
  healthCheck(): Promise<void>;
  recoverAfterInterruption(reason: string): Promise<void>;
}
