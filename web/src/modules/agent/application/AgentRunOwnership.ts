import type { AgentRunId } from '@/kernel/public';

export interface AgentRunOwnershipSnapshot {
  /** Runs a live controller owns: in this context, and in every other one when `coversOtherContexts`. */
  readonly ownedRunIds: ReadonlySet<string>;
  /**
   * False when other contexts of the app (browser tabs sharing one IndexedDB)
   * cannot be observed. A caller must then assume any recently written run may
   * be owned elsewhere.
   */
  readonly coversOtherContexts: boolean;
}

/**
 * Who is driving a run right now. A worker proves it with its lease; a
 * foreground controller (the chat) has no lease, so it holds ownership here for
 * as long as its execution is registered. Recovery reads it before closing a
 * lease-less run that looks abandoned.
 */
export interface AgentRunOwnership {
  /** Holds ownership of the run until the returned release is called. */
  hold(runId: AgentRunId): () => void;
  snapshot(): Promise<AgentRunOwnershipSnapshot>;
}

interface OwnershipLockManager {
  request(name: string, options: { readonly mode: 'exclusive' }, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{
    readonly held?: readonly { readonly name?: string }[];
    readonly pending?: readonly { readonly name?: string }[];
  }>;
}

const OWNERSHIP_LOCK_PREFIX = 'zhangl-agent:agent-run:';

/**
 * Ownership held as one Web Lock per run, so every tab of the app sees every
 * other tab's live runs and a lock disappears with the tab that held it. The
 * in-memory count answers for this context even where Web Locks do not exist.
 */
export class LockedAgentRunOwnership implements AgentRunOwnership {
  private readonly local = new Map<string, number>();
  /** Every tab of an origin shares one browser; if this one cannot hold locks, no tab's are visible. */
  private locksRefused = false;

  /** `null` observes this context only (no Web Locks, or a caller that wants none). */
  constructor(private readonly locks: OwnershipLockManager | null = browserLockManager()) {}

  hold(runId: AgentRunId): () => void {
    this.local.set(runId, (this.local.get(runId) ?? 0) + 1);
    let releaseLock: () => void = () => undefined;
    const released = new Promise<void>((resolve) => { releaseLock = resolve; });
    try {
      void this.locks?.request(`${OWNERSHIP_LOCK_PREFIX}${runId}`, { mode: 'exclusive' }, () => released)
        .catch(() => { this.locksRefused = true; });
    } catch {
      // This context still counts its own runs through `local`; registering an
      // execution must never fail because locks are refused.
      this.locksRefused = true;
    }
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const remaining = (this.local.get(runId) ?? 1) - 1;
      if (remaining > 0) this.local.set(runId, remaining);
      else this.local.delete(runId);
      releaseLock();
    };
  }

  async snapshot(): Promise<AgentRunOwnershipSnapshot> {
    const ownedRunIds = new Set(this.local.keys());
    if (!this.locks || this.locksRefused) return { ownedRunIds, coversOtherContexts: false };
    try {
      const state = await this.locks.query();
      for (const lock of [...(state.held ?? []), ...(state.pending ?? [])]) {
        if (lock.name?.startsWith(OWNERSHIP_LOCK_PREFIX)) ownedRunIds.add(lock.name.slice(OWNERSHIP_LOCK_PREFIX.length));
      }
      return { ownedRunIds, coversOtherContexts: true };
    } catch {
      return { ownedRunIds, coversOtherContexts: false };
    }
  }
}

let sharedOwnership: AgentRunOwnership | undefined;

/** The one ownership view of this context, shared by the execution registry and recovery. */
export function sharedAgentRunOwnership(): AgentRunOwnership {
  sharedOwnership ??= new LockedAgentRunOwnership();
  return sharedOwnership;
}

function browserLockManager(): OwnershipLockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as { readonly locks?: unknown }).locks;
  return locks && typeof locks === 'object' ? locks as OwnershipLockManager : null;
}
