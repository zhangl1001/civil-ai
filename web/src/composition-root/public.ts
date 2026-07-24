// Concrete adapters are registered here as new vertical slices replace legacy runtime paths.
export { createNativeTutorDatabase } from './database/createNativeTutorDatabase';
export type { NativeTutorDatabaseRuntime } from './database/createNativeTutorDatabase';
export { createWebTutorDatabase } from './database/createWebTutorDatabase';
export type { WebTutorDatabaseRuntime } from './database/createWebTutorDatabase';
export { createTutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export type { TutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export { getTutorRuntime, initializeTutorRuntime } from './TutorRuntimeProvider';
export { createConfiguredProviderGateway } from './ai/createConfiguredProviderGateway';
