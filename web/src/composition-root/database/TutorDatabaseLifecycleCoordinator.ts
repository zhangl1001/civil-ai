import { Capacitor } from '@capacitor/core';
import { tutorDatabaseConfig } from '@/capabilities/database/public';
import {
  appLifecycleAdapter,
  type AppLifecycleEvent
} from '@/platform/AppLifecycleAdapter';
import type { TutorDatabaseRuntime } from './createTutorDatabaseRuntime';

/**
 * Owns native database recovery across iOS suspension boundaries.
 * It is installed before every worker so its recovery gate closes first.
 */
export class TutorDatabaseLifecycleCoordinator {
  private runtime?: TutorDatabaseRuntime;
  private removeChangeListener?: () => void;
  private recovery?: Promise<void>;
  private healthTimer?: number;
  private interrupted = false;

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!Capacitor.isNativePlatform()) return;
    this.interrupted = appLifecycleAdapter.current().state !== 'active';
    if (!this.removeChangeListener) {
      this.removeChangeListener = appLifecycleAdapter.onChange((event) => this.handle(event));
    }
    if (!this.interrupted) this.scheduleHealthCheck();
  }

  waitUntilReady(): Promise<void> {
    return this.recovery ?? this.runtime?.databaseLifecycle.waitUntilReady() ?? Promise.resolve();
  }

  private handle(event: AppLifecycleEvent): void {
    if (event.state !== 'active') {
      this.interrupted = true;
      this.clearHealthCheck();
      return;
    }
    if (this.interrupted) {
      this.interrupted = false;
      this.startRecovery(`resume.${event.reason}`);
      return;
    }
    this.scheduleHealthCheck();
  }

  private startRecovery(reason: string): void {
    if (!this.runtime || this.recovery) return;
    this.clearHealthCheck();
    const runtime = this.runtime;
    this.recovery = (async () => {
      await runtime.databaseLifecycle.recoverAfterInterruption(reason);
      await runtime.recoverExpiredAgentRuns.execute();
    })()
      .catch((error: unknown) => {
        this.interrupted = true;
        console.error('[TutorDatabaseLifecycle] recovery failed', error);
        throw error;
      })
      .finally(() => {
        this.recovery = undefined;
        if (!this.interrupted) this.scheduleHealthCheck();
      });
    void this.recovery.catch(() => undefined);
  }

  private scheduleHealthCheck(): void {
    if (this.healthTimer || document.hidden || !this.runtime) return;
    this.healthTimer = window.setTimeout(() => {
      this.healthTimer = undefined;
      void this.runHealthCheck();
    }, tutorDatabaseConfig.healthCheckIntervalMs);
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.runtime || document.hidden || this.recovery) return;
    try {
      await this.runtime.databaseLifecycle.healthCheck();
      this.scheduleHealthCheck();
    } catch (error) {
      console.warn('[TutorDatabaseLifecycle] health check failed', error);
      this.startRecovery('health_check_failed');
    }
  }

  private clearHealthCheck(): void {
    if (!this.healthTimer) return;
    window.clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
  }
}

export const tutorDatabaseLifecycleCoordinator = new TutorDatabaseLifecycleCoordinator();
