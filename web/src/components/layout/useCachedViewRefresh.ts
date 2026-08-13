import { onActivated } from 'vue';

/**
 * Reloads a cached tab root when the user comes back to it.
 *
 * Tab roots live inside `<KeepAlive>`, so revisiting one never remounts it and
 * `onMounted` runs exactly once. This hook owns the revisit instead: the
 * already-rendered content stays on screen while the reload runs in the
 * background, which is the entire point of caching them — replaying
 * skeleton to spinner to content on every switch is the flicker being removed.
 *
 * The first activation is skipped because mounting has already loaded the view,
 * and the hook is inert outside `<KeepAlive>`, so a view dropped from the cache
 * whitelist keeps working without any change here.
 */
export function useCachedViewRefresh(refresh: () => void | Promise<void>): void {
  let awaitingFirstActivation = true;
  onActivated(() => {
    if (awaitingFirstActivation) {
      awaitingFirstActivation = false;
      return;
    }
    void refresh();
  });
}
