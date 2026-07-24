import type { InstantMs, JsonObject } from '@/kernel/public';
import type { LearningThreadRecord } from '../contracts/LearningThreadRepository';
import { LearningThreadEventType, LearningThreadStatus } from './LearningThreadCodes';
import { LearningThreadStage } from './LearningThreadStage';

const nextStages: Readonly<Record<LearningThreadRecord['stage'], readonly LearningThreadRecord['stage'][]>> = {
  [LearningThreadStage.Diagnose]: [LearningThreadStage.Prerequisite, LearningThreadStage.Teach],
  [LearningThreadStage.Prerequisite]: [LearningThreadStage.Teach],
  [LearningThreadStage.Teach]: [LearningThreadStage.Guided],
  [LearningThreadStage.Guided]: [LearningThreadStage.Independent],
  [LearningThreadStage.Independent]: [LearningThreadStage.Consolidate],
  [LearningThreadStage.Consolidate]: [LearningThreadStage.Retention],
  [LearningThreadStage.Retention]: [LearningThreadStage.Transfer, LearningThreadStage.Maintain],
  [LearningThreadStage.Transfer]: [LearningThreadStage.Maintain],
  [LearningThreadStage.Maintain]: []
};

export interface LearningThreadTransition {
  readonly thread: LearningThreadRecord;
  readonly eventType: typeof LearningThreadEventType[keyof typeof LearningThreadEventType];
  readonly fromStage?: LearningThreadRecord['stage'];
  readonly toStage?: LearningThreadRecord['stage'];
}

export class LearningThreadMachine {
  advance(
    current: LearningThreadRecord,
    nextStage: LearningThreadRecord['stage'],
    nextAction: JsonObject | undefined,
    now: InstantMs
  ): LearningThreadTransition {
    this.assertActive(current);
    if (!nextStages[current.stage].includes(nextStage)) {
      throw new Error(`Illegal learning thread stage transition: ${current.stage} -> ${nextStage}`);
    }
    return {
      thread: this.next(current, {
        stage: nextStage,
        nextAction,
        pausedAt: undefined,
        completedAt: undefined,
        closedReason: undefined
      }, now),
      eventType: LearningThreadEventType.StageAdvanced,
      fromStage: current.stage,
      toStage: nextStage
    };
  }

  pause(current: LearningThreadRecord, now: InstantMs): LearningThreadTransition {
    this.assertActive(current);
    return {
      thread: this.next(current, { status: LearningThreadStatus.Paused, pausedAt: now }, now),
      eventType: LearningThreadEventType.Paused,
      fromStage: current.stage,
      toStage: current.stage
    };
  }

  resume(current: LearningThreadRecord, now: InstantMs): LearningThreadTransition {
    if (current.status !== LearningThreadStatus.Paused) throw new Error(`Only paused learning thread can resume: ${current.status}`);
    return {
      thread: this.next(current, { status: LearningThreadStatus.Active, pausedAt: undefined }, now),
      eventType: LearningThreadEventType.Resumed,
      fromStage: current.stage,
      toStage: current.stage
    };
  }

  complete(current: LearningThreadRecord, reason: string, now: InstantMs): LearningThreadTransition {
    this.assertOpen(current);
    if (!reason.trim()) throw new Error('Learning thread completion requires a reason');
    return {
      thread: this.next(current, {
        status: LearningThreadStatus.Completed,
        completedAt: now,
        closedReason: reason.trim(),
        nextAction: undefined,
        pausedAt: undefined
      }, now),
      eventType: LearningThreadEventType.Completed,
      fromStage: current.stage,
      toStage: current.stage
    };
  }

  abandon(current: LearningThreadRecord, reason: string, now: InstantMs): LearningThreadTransition {
    this.assertOpen(current);
    if (!reason.trim()) throw new Error('Learning thread abandonment requires a reason');
    return {
      thread: this.next(current, {
        status: LearningThreadStatus.Abandoned,
        completedAt: now,
        closedReason: reason.trim(),
        nextAction: undefined,
        pausedAt: undefined
      }, now),
      eventType: LearningThreadEventType.Abandoned,
      fromStage: current.stage,
      toStage: current.stage
    };
  }

  private next(
    current: LearningThreadRecord,
    patch: Partial<LearningThreadRecord>,
    now: InstantMs
  ): LearningThreadRecord {
    return { ...current, ...patch, updatedAt: now, version: current.version + 1 };
  }

  private assertActive(thread: LearningThreadRecord): void {
    if (thread.status !== LearningThreadStatus.Active) throw new Error(`Learning thread is not active: ${thread.status}`);
  }

  private assertOpen(thread: LearningThreadRecord): void {
    if (thread.status !== LearningThreadStatus.Active && thread.status !== LearningThreadStatus.Paused) {
      throw new Error(`Learning thread is terminal: ${thread.status}`);
    }
  }
}
