import { createTutorDatabaseRuntime, type TutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';

let runtime: TutorDatabaseRuntime | undefined;
let initialization: Promise<TutorDatabaseRuntime> | undefined;

export function initializeTutorRuntime(): Promise<TutorDatabaseRuntime> {
  if (runtime) return Promise.resolve(runtime);
  if (!initialization) {
    initialization = createInitializedRuntime()
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

async function createInitializedRuntime(): Promise<TutorDatabaseRuntime> {
  const initialized = await createTutorDatabaseRuntime();
  await initialized.initialize();
  runtime = initialized;
  return initialized;
}
