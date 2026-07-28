import { SystemClock } from '@/capabilities/platform/public';
import { Capacitor } from '@capacitor/core';
import type { TutorDatabaseRuntime } from './TutorDatabaseRuntime';

export type { TutorDatabaseRuntime } from './TutorDatabaseRuntime';

export async function createTutorDatabaseRuntime(): Promise<TutorDatabaseRuntime> {
  const clock = new SystemClock();
  if (Capacitor.isNativePlatform()) {
    const { createNativeTutorDatabase } = await import('./createNativeTutorDatabase');
    const runtime = createNativeTutorDatabase(clock);
    if (!runtime) throw new Error('Native tutor database runtime is unavailable');
    return runtime;
  }
  const { createWebTutorDatabase } = await import('./createWebTutorDatabase');
  return createWebTutorDatabase(clock);
}
