import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import type { PromptRepository } from '../contracts/PromptRepository';
import type { PromptBundle, PromptSection, PromptSectionCode } from '../prompt/PromptContracts';

interface PromptRow extends SqlRow {
  definition_id: string;
  version_id: string;
  prompt_code: string;
  task_type: string;
  description: string;
  version: string;
  manifest_json: string;
  sections_json: string;
  compatible_schema_versions_json: string;
  content_hash: string;
  created_at: number;
}

export class SqlitePromptRepository implements PromptRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async install(bundle: PromptBundle, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await transaction.run(
      `INSERT INTO prompt_definitions(id, prompt_code, task_type, description, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [bundle.definitionId, bundle.promptCode, bundle.taskType, bundle.description, bundle.createdAt]
    );
    await transaction.run(
      `INSERT INTO prompt_versions(
        id, prompt_definition_id, version, manifest_json, sections_json,
        compatible_schema_versions_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
      [bundle.versionId, bundle.definitionId, bundle.version, JSON.stringify({
        requiredVariables: bundle.requiredVariables,
        responseSchema: bundle.responseSchema
      }), JSON.stringify(bundle.sections), JSON.stringify(bundle.compatibleSchemaVersions),
        bundle.contentHash, bundle.createdAt]
    );
  }

  async find(promptCode: string, version: string): Promise<PromptBundle | undefined> {
    const rows = await this.database.query<PromptRow>(
      `SELECT definition.id AS definition_id, prompt.id AS version_id,
              definition.prompt_code, definition.task_type, definition.description,
              prompt.version, prompt.manifest_json, prompt.sections_json,
              prompt.compatible_schema_versions_json, prompt.content_hash, prompt.created_at
       FROM prompt_versions prompt
       JOIN prompt_definitions definition ON definition.id = prompt.prompt_definition_id
       WHERE definition.prompt_code = ? AND prompt.version = ? AND prompt.status = 'published'
       LIMIT 1`,
      [promptCode, version]
    );
    return rows[0] ? mapPrompt(rows[0]) : undefined;
  }

  async findById(versionId: PromptVersionId): Promise<PromptBundle | undefined> {
    const rows = await this.database.query<PromptRow>(
      `SELECT definition.id AS definition_id, prompt.id AS version_id,
              definition.prompt_code, definition.task_type, definition.description,
              prompt.version, prompt.manifest_json, prompt.sections_json,
              prompt.compatible_schema_versions_json, prompt.content_hash, prompt.created_at
       FROM prompt_versions prompt
       JOIN prompt_definitions definition ON definition.id = prompt.prompt_definition_id
       WHERE prompt.id = ? AND prompt.status = 'published' LIMIT 1`,
      [versionId]
    );
    return rows[0] ? mapPrompt(rows[0]) : undefined;
  }
}

function mapPrompt(row: PromptRow): PromptBundle {
  const manifest = parseJsonObject(row.manifest_json, 'prompt_versions.manifest_json');
  return {
      definitionId: row.definition_id,
      versionId: row.version_id as PromptVersionId,
      promptCode: row.prompt_code,
      taskType: row.task_type,
      description: row.description,
      version: row.version,
      contentHash: row.content_hash,
      createdAt: row.created_at as InstantMs,
      requiredVariables: parseStringArray(manifest.requiredVariables, 'manifest.requiredVariables'),
      compatibleSchemaVersions: parseStringArray(
        parseJson(row.compatible_schema_versions_json, 'prompt_versions.compatible_schema_versions_json'),
        'compatible schema versions'
      ),
      responseSchema: asJsonObject(manifest.responseSchema, 'manifest.responseSchema'),
      sections: parseSections(parseJson(row.sections_json, 'prompt_versions.sections_json'))
  };
}

function parseSections(input: unknown): readonly PromptSection[] {
  if (!Array.isArray(input)) throw new TypeError('prompt sections must be an array');
  return input.map((item, index) => {
    const row = asJsonObject(item, `prompt section ${index}`);
    if (typeof row.code !== 'string' || typeof row.title !== 'string' || typeof row.order !== 'number' || typeof row.template !== 'string') {
      throw new TypeError(`prompt section ${index} is invalid`);
    }
    return { code: row.code as PromptSectionCode, title: row.title, order: row.order, template: row.template };
  });
}

function parseStringArray(input: unknown, field: string): readonly string[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) throw new TypeError(`${field} must be a string array`);
  return input;
}

function parseJsonObject(serialized: string, field: string): JsonObject {
  return asJsonObject(parseJson(serialized, field), field);
}

function parseJson(serialized: string, field: string): unknown {
  try { return JSON.parse(serialized) as unknown; } catch { throw new TypeError(`${field} must contain valid JSON`); }
}

function asJsonObject(input: unknown, field: string): JsonObject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${field} must be an object`);
  return input as JsonObject;
}
