import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const fixturePath = path.join(projectRoot, 'web/src/modules/content/fixtures/content-metadata-v2.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const errors = [];
const expectedHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(fixture.payload)).digest('hex')}`;

if (fixture.manifest.contentHash !== expectedHash) errors.push(`content hash mismatch; expected ${expectedHash}`);
if (fixture.manifest.status !== 'published') errors.push('bundled content metadata must be published');

const schemas = fixture.payload.schemaVersions;
const templates = fixture.payload.questionTemplateVersions;
const schemaIds = new Set();
const schemaKeys = new Set();
for (const schema of schemas) {
  const key = `${schema.schemaCode}:${schema.version}`;
  if (!schema.id || schemaIds.has(schema.id)) errors.push(`duplicate or empty schema id: ${schema.id}`);
  if (schemaKeys.has(key)) errors.push(`duplicate schema version: ${key}`);
  if (schema.status !== 'published') errors.push(`bundled schema must be published: ${schema.id}`);
  schemaIds.add(schema.id);
  schemaKeys.add(key);
}

const templateKeys = new Set();
for (const template of templates) {
  const key = `${template.templateCode}:${template.version}`;
  if (templateKeys.has(key)) errors.push(`duplicate question template version: ${key}`);
  if (!schemaIds.has(template.contentSchemaVersionId)) {
    errors.push(`question template references missing schema: ${template.contentSchemaVersionId}`);
  }
  if (template.status !== 'published') errors.push(`bundled template must be published: ${template.id}`);
  templateKeys.add(key);
}

if (errors.length) {
  console.error('Content metadata verification failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Content metadata verification passed (${schemas.length} schemas, ${templates.length} templates).`);
