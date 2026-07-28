import { Capacitor } from '@capacitor/core';
import { tutorDatabaseConfig } from '@/capabilities/database/public';
import {
  appLifecycleAdapter,
  type AppLifecycleEvent
} from '@/platform/AppLifecycleAdapter';
import type { TutorDatabaseRuntime } from './createTutorDatabaseRuntime';

interface DatabaseLifecycleRuntime {
  readonly databaseLifecycle: TutorDatabaseRuntime['databaseLifecycle'];
  readonly recoverExpiredAgentRuns: TutorDatabaseRuntime['recoverExpiredAgentRuns'];
}

export interface TutorDatabaseLifecycleDependencies {
  readonly isNativePlatform: () => boolean;
  readonly lifecycle: Pick<typeof appLifecycleAdapter, 'current' | 'onChange'>;
  readonly isDocumentHidden: () => boolean;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timer: number) => void;
  readonly healthCheckIntervalMs: number;
  readonly logger: Pick<Console, 'warn' | 'error'>;
}

function defaultDependencies(): TutorDatabaseLifecycleDependencies {
  return {
    isNativePlatform: () => Capacitor.isNativePlatform(),
    lifecycle: appLifecycleAdapter,
    isDocumentHidden: () => document.hidden,
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer),
    healthCheckIntervalMs: tutorDatabaseConfig.healthCheckIntervalMs,
    logger: console
  };
}

/**
 * Owns native database recovery across iOS suspension boundaries.
 * It is installed before every worker so its recovery gate closes first.
 */
export class TutorDatabaseLifecycleCoordinator {
  private runtime?: DatabaseLifecycleRuntime;
  private removeChangeListener?: () => void;
  private recovery?: Promise<void>;
  private healthTimer?: number;
  private interrupted = false;

  constructor(private readonly dependencies: TutorDatabaseLifecycleDependencies = defaultDependencies()) {}

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!this.dependencies.isNativePlatform()) return;
    this.interrupted = this.dependencies.lifecycle.current().state !== 'active';
    if (!this.removeChangeListener) {
      this.removeChangeListener = this.dependencies.lifecycle.onChange((event) => this.handle(event));
    }
    if (!this.interrupted) this.scheduleHealthCheck();
  }

  dispose(): void {
    this.removeChangeListener?.();
    this.removeChangeListener = undefined;
    this.clearHealthCheck();
    this.runtime = undefined;
    this.interrupted = false;
  }

  waitUntilReady(): Promise<void> {
    if (this.recovery) return this.recovery;
    if (this.interrupted) {
      return Promise.reject(new Error('Tutor database recovery is pending'));
    }
    return this.runtime?.databaseLifecycle.waitUntilReady() ?? Promise.resolve();
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
        this.dependencies.logger.error('[TutorDatabaseLifecycle] recovery failed', error);
        throw error;
      })
      .finally(() => {
        this.recovery = undefined;
        if (!this.interrupted) this.scheduleHealthCheck();
      });
    void this.recovery.catch(() => undefined);
  }

  private scheduleHealthCheck(): void {
    if (this.healthTimer || this.dependencies.isDocumentHidden() || !this.runtime) return;
    this.healthTimer = this.dependencies.setTimeout(() => {
      this.healthTimer = undefined;
      void this.runHealthCheck();
    }, this.dependencies.healthCheckIntervalMs);
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.runtime || this.dependencies.isDocumentHidden() || this.recovery) return;
    try {
      await this.runtime.databaseLifecycle.healthCheck();
      this.scheduleHealthCheck();
    } catch (error) {
      this.dependencies.logger.warn('[TutorDatabaseLifecycle] health check failed', error);
      this.startRecovery('health_check_failed');
    }
  }

  private clearHealthCheck(): void {
    if (!this.healthTimer) return;
    this.dependencies.clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
  }
}

export const tutorDatabaseLifecycleCoordinator = new TutorDatabaseLifecycleCoordinator();
