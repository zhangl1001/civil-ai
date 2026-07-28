import {
  chatAttachmentService,
  type ImportedChatAttachment
} from '@/services/ChatAttachmentService';

export type AgentAttachmentImportResult = ImportedChatAttachment;

export function importAgentAttachment(file: File): Promise<AgentAttachmentImportResult> {
  return chatAttachmentService.import(file);
}

export function importAgentAttachments(files: readonly File[]): Promise<AgentAttachmentImportResult> {
  return chatAttachmentService.importMany(files);
}
