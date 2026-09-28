// Concrete adapters are registered here; business modules depend only on their public ports.
// The platform databases are reached only through createTutorDatabaseRuntime, whose dynamic
// imports keep the adapter a device does not use out of its bundle; re-exporting either
// factory here would pull both back into the first chunk.
export type { NativeTutorDatabaseRuntime } from './database/createNativeTutorDatabase';
export type { WebTutorDatabaseRuntime } from './database/createWebTutorDatabase';
export { createTutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export type { TutorDatabaseRuntime } from './database/createTutorDatabaseRuntime';
export { getTutorRuntime, initializeTutorRuntime } from './TutorRuntimeProvider';
export { createConfiguredProviderGateway } from './ai/createConfiguredProviderGateway';
export { agentWorkerCoordinator } from './agent/AgentWorkerCoordinator';
export { enqueueBusinessAgentTask } from './agent/enqueueBusinessAgentTask';
export {
  EssayGenerationCoordinator,
  type EssayContext,
  type EssayGenerationContext
} from './essay/EssayGenerationCoordinator';
export { EssayGradingCoordinator } from './essay/EssayGradingCoordinator';
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
