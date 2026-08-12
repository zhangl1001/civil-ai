// Concrete adapters are registered here; business modules depend only on their public ports.
export { createNativeTutorDatabase } from './database/createNativeTutorDatabase';
export type { NativeTutorDatabaseRuntime } from './database/createNativeTutorDatabase';
export { createWebTutorDatabase } from './database/createWebTutorDatabase';
export type { WebTutorDatabaseRuntime } from './database/createWebTutorDatabase';
export { createTutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export type { TutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export { getTutorRuntime, initializeTutorRuntime } from './TutorRuntimeProvider';
export { createConfiguredProviderGateway } from './ai/createConfiguredProviderGateway';
export { agentWorkerCoordinator } from './agent/AgentWorkerCoordinator';
export { enqueueBusinessAgentTask } from './agent/enqueueBusinessAgentTask';
export { EssayGenerationCoordinator, type EssayContext } from './essay/EssayGenerationCoordinator';
export {
  importAgentAttachment,
  importAgentAttachments,
  type AgentAttachmentImportResult
} from './files/importAgentAttachment';
export {
  ConfiguredAIClient,
  configuredAIClient,
  type AITextMessage,
  type AITextRequestOptions
} from './ai/ConfiguredAIClient';
