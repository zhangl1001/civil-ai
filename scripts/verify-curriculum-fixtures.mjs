import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const fixturePath = path.join(projectRoot, 'web/src/modules/curriculum/fixtures/civil-service-national-v1.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const errors = [];

const contentHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(fixture.payload)).digest('hex')}`;
if (fixture.manifest.contentHash !== contentHash) errors.push(`content hash mismatch; expected ${contentHash}`);
if (fixture.manifest.status !== 'published') errors.push('bundled metadata package must be published');
if (fixture.payload.curriculum.status !== 'published') errors.push('bundled curriculum must be published');
if (fixture.payload.curriculum.metadataPackageId !== fixture.manifest.id) errors.push('curriculum metadataPackageId mismatch');

const nodes = fixture.payload.capabilityNodes;
const ids = new Set();
const codes = new Set();
for (const node of nodes) {
  if (!node.id || ids.has(node.id)) errors.push(`duplicate or empty capability id: ${node.id}`);
  if (!node.code || codes.has(node.code)) errors.push(`duplicate or empty capability code: ${node.code}`);
  if (node.scoreWeight < 0) errors.push(`negative scoreWeight: ${node.code}`);
  if (node.defaultTargetAccuracy !== undefined && (node.defaultTargetAccuracy < 0 || node.defaultTargetAccuracy > 1)) {
    errors.push(`invalid defaultTargetAccuracy: ${node.code}`);
  }
  ids.add(node.id);
  codes.add(node.code);
}

for (const node of nodes) {
  if (node.parentId && !ids.has(node.parentId)) errors.push(`missing parent ${node.parentId} for ${node.id}`);
}
for (const edge of fixture.payload.capabilityEdges) {
  if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) errors.push(`edge references missing node: ${JSON.stringify(edge)}`);
  if (edge.fromNodeId === edge.toNodeId) errors.push(`self edge: ${edge.fromNodeId}`);
  if (edge.weight < 0 || edge.weight > 1) errors.push(`invalid edge weight: ${JSON.stringify(edge)}`);
}

const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
for (const node of nodes) {
  const visited = new Set();
  let current = node.id;
  while (current) {
    if (visited.has(current)) {
      errors.push(`parent cycle detected at ${current}`);
      break;
    }
    visited.add(current);
    current = parentById.get(current);
  }
}

if (errors.length > 0) {
  console.error('Curriculum fixture verification failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Curriculum fixture verification passed (${nodes.length} nodes, ${fixture.payload.capabilityEdges.length} edges).`);
