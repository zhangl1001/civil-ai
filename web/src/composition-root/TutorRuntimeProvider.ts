import { createTutorDatabaseRuntime, type TutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';

let runtime: TutorDatabaseRuntime | undefined;
let initialization: Promise<TutorDatabaseRuntime> | undefined;

export function initializeTutorRuntime(): Promise<TutorDatabaseRuntime> {
  if (runtime) return Promise.resolve(runtime);
  if (!initialization) {
    initialization = createTutorDatabaseRuntime()
      .then(async (nextRuntime) => {
        await nextRuntime.initialize();
        runtime = nextRuntime;
        return nextRuntime;
      })
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
  }
  return initialization;
}

export function getTutorRuntime(): TutorDatabaseRuntime {
  if (!runtime) throw new Error('Tutor runtime has not been initialized');
  return runtime;
}
