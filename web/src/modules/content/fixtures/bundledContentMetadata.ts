import type {
  ContentSchemaVersionId,
  InstantMs,
  JsonObject,
  QuestionTemplateVersionId
} from '@/kernel/public';
import fixture from './content-metadata-v1.json';
import type { ContentMetadataBundle } from '../contracts/ContentRepository';
import type {
  ContentDocumentType,
  PublishedAssetStatus,
  QuestionTemplateCode
} from '../domain/ContentCodes';

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function createBundledContentMetadata(): ContentMetadataBundle {
  return {
    releaseId: fixture.manifest.id,
    contentHash: fixture.manifest.contentHash,
    schemaVersions: fixture.payload.schemaVersions.map((schema) => ({
      id: schema.id as ContentSchemaVersionId,
      schemaCode: schema.schemaCode,
      documentType: schema.documentType as ContentDocumentType,
      version: schema.version,
      schema: asJsonObject(schema.schema),
      contentHash: fixture.manifest.contentHash,
      status: schema.status as PublishedAssetStatus,
      createdAt: schema.createdAt as InstantMs
    })),
    questionTemplateVersions: fixture.payload.questionTemplateVersions.map((template) => ({
      id: template.id as QuestionTemplateVersionId,
      templateCode: template.templateCode as QuestionTemplateCode,
      version: template.version,
      rendererCode: template.rendererCode,
      contentSchemaVersionId: template.contentSchemaVersionId as ContentSchemaVersionId,
      config: asJsonObject(template.config),
      contentHash: fixture.manifest.contentHash,
      status: template.status as PublishedAssetStatus,
      createdAt: template.createdAt as InstantMs
    }))
  };
}
