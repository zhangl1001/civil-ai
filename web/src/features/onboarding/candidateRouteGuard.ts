import type { NavigationGuard } from 'vue-router';
import { initializeTutorRuntime } from '@/composition-root/public';

export const requireCandidateCycle: NavigationGuard = async (to) => {
  const isOnboarding = to.name === 'VueOnboarding';
  if (!to.meta.requiresCandidate && !to.meta.onboardingEntry && !isOnboarding) return true;
  const runtime = await initializeTutorRuntime();
  const current = await runtime.candidateRepository.findCurrentCycle();
  if (isOnboarding) return current ? { name: 'VueHome' } : true;
  if (current) return true;
  if (to.meta.onboardingEntry) return { name: 'VueOnboarding' };
  return {
    name: 'VueOnboarding',
    query: { redirect: to.fullPath }
  };
};
