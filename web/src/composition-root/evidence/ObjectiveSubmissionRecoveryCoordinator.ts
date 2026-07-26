import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import type { TutorDatabaseRuntime } from '../database/createTutorDatabaseRuntime';
import { agentWorkerCoordinator } from '../agent/AgentWorkerCoordinator';
import { tutorDatabaseLifecycleCoordinator } from '../database/TutorDatabaseLifecycleCoordinator';

const POLL_INTERVAL_MS = 15_000;

/** Runs the durable, idempotent side effects that follow an already committed objective session. */
export class ObjectiveSubmissionRecoveryCoordinator {
  private runtime?: TutorDatabaseRuntime;
  private worker?: Promise<void>;
  private timer?: number;
  private removeActiveListener?: () => void;

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!this.removeActiveListener) {
      this.removeActiveListener = appLifecycleAdapter.onActive(() => this.start());
    }
    this.start();
  }

  start(): void {
    if (!this.runtime || this.worker || document.hidden) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.worker = this.run(this.runtime)
      .catch((error: unknown) => console.warn('[ObjectiveSubmissionRecovery] worker paused', error))
      .finally(() => {
        this.worker = undefined;
        this.schedule();
      });
  }

  private async run(runtime: TutorDatabaseRuntime): Promise<void> {
    while (!document.hidden) {
      await tutorDatabaseLifecycleCoordinator.waitUntilReady();
      const result = await runtime.processObjectiveSubmissionOutbox.execute(
        `objective-submission-worker:${crypto.randomUUID()}`
      );
      if (result.completed > 0) agentWorkerCoordinator.start(runtime);
      if (result.claimed === 0 || result.retried > 0) return;
    }
  }

  private schedule(): void {
    if (this.timer || document.hidden) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, POLL_INTERVAL_MS);
  }
}

export const objectiveSubmissionRecoveryCoordinator = new ObjectiveSubmissionRecoveryCoordinator();
