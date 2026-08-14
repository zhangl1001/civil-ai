import { watch, type Ref } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { QuestionSetEntryMode } from '@/modules/content/public';
import { PracticeSubject } from './PracticeSubject';

const SUPPORTED_COUNTS = new Set([5, 10, 15, 20, 25]);

export interface PracticeSelfAutoStartRequest {
  readonly capabilityNodeId: string;
  readonly count: number;
}

interface PracticeSelfAutoStartOptions {
  readonly route: RouteLocationNormalizedLoaded;
  readonly router: Router;
  readonly loading: Readonly<Ref<boolean>>;
  /**
   * Resolves to whether the task was accepted. The page reports its own failure
   * to the user, so a rejected start is an ordinary outcome here rather than a
   * thrown error — but it has to be distinguishable from success, or a failed
   * request would be consumed as handled and could never be retried.
   */
  readonly start: (request: PracticeSelfAutoStartRequest) => Promise<boolean>;
}

/** Consumes an explicit one-shot route request through the regular practice task flow. */
export function usePracticeSelfAutoStart(options: PracticeSelfAutoStartOptions) {
  let handledKey = '';

  async function tryStart(): Promise<void> {
    const capabilityNodeId = queryText(options.route.query.capabilityNodeId);
    if (
      options.loading.value
      || options.route.query.subject !== PracticeSubject.Aptitude
      || options.route.query.mode !== QuestionSetEntryMode.Self
      || options.route.query.start !== '1'
      || !capabilityNodeId
    ) return;

    const requestedCount = Number(options.route.query.count);
    const count = SUPPORTED_COUNTS.has(requestedCount) ? requestedCount : 10;
    const requestKey = `${capabilityNodeId}:${count}`;
    if (handledKey === requestKey) return;
    // Marked only after the task is accepted: a failed start keeps start=1 in
    // the URL so the page can retry it rather than swallowing the request.
    if (!await options.start({ capabilityNodeId, count })) return;
    handledKey = requestKey;

    const nextQuery = { ...options.route.query };
    delete nextQuery.start;
    await options.router.replace({ query: nextQuery });
  }

  watch(
    () => [
      options.route.query.start,
      options.route.query.mode,
      options.route.query.subject,
      options.route.query.capabilityNodeId
    ] as const,
    () => {
      if (options.route.query.start !== '1') handledKey = '';
      else void tryStart();
    }
  );

  return { tryStart };
}

function queryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
