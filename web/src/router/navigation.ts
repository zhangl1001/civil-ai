import type { Router } from 'vue-router';

export function goBackOrHome(router: Router): void {
  if (window.history.state?.back) {
    router.back();
    return;
  }
  const fallback = router.currentRoute.value.meta.fallbackPath;
  void router.replace(typeof fallback === 'string' ? fallback : '/');
}
