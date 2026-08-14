import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
// Every bundled package is checked, not one named file: a track that ships
// without being validated is exactly how a broken pack reaches a candidate.
const fixtureDirectory = path.join(projectRoot, 'web/src/modules/curriculum/fixtures');
const fixturePaths = fs.readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => path.join(fixtureDirectory, name));
if (fixturePaths.length === 0) throw new Error('no bundled curriculum fixtures found');

const errors = [];
let totalNodes = 0;
let totalEdges = 0;
let totalDeliveryPolicies = 0;
const seenExamTypes = new Set();

for (const fixturePath of fixturePaths) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  verifyFixture(fixture, path.basename(fixturePath));
}

if (errors.length > 0) {
  console.error('Curriculum fixture verification failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Curriculum fixture verification passed (${fixturePaths.length} packages, ${totalNodes} nodes, ${totalEdges} edges, ${totalDeliveryPolicies} exam_delivery policies).`);

function verifyFixture(fixture, label) {
  const push = (message) => push(`${label}: ${message}`);

const contentHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(fixture.payload)).digest('hex')}`;
if (fixture.manifest.contentHash !== contentHash) push(`content hash mismatch; expected ${contentHash}`);
if (fixture.manifest.status !== 'published') push('bundled metadata package must be published');
if (fixture.payload.curriculum.status !== 'published') push('bundled curriculum must be published');
if (fixture.payload.curriculum.metadataPackageId !== fixture.manifest.id) push('curriculum metadataPackageId mismatch');

const nodes = fixture.payload.capabilityNodes;
const ids = new Set();
const codes = new Set();
for (const node of nodes) {
  if (!node.id || ids.has(node.id)) push(`duplicate or empty capability id: ${node.id}`);
  if (!node.code || codes.has(node.code)) push(`duplicate or empty capability code: ${node.code}`);
  if (node.scoreWeight < 0) push(`negative scoreWeight: ${node.code}`);
  if (node.defaultTargetAccuracy !== undefined && (node.defaultTargetAccuracy < 0 || node.defaultTargetAccuracy > 1)) {
    push(`invalid defaultTargetAccuracy: ${node.code}`);
  }
  ids.add(node.id);
  codes.add(node.code);
}

for (const node of nodes) {
  if (node.parentId && !ids.has(node.parentId)) push(`missing parent ${node.parentId} for ${node.id}`);
}
for (const edge of fixture.payload.capabilityEdges) {
  if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) push(`edge references missing node: ${JSON.stringify(edge)}`);
  if (edge.fromNodeId === edge.toNodeId) push(`self edge: ${edge.fromNodeId}`);
  if (edge.weight < 0 || edge.weight > 1) push(`invalid edge weight: ${JSON.stringify(edge)}`);
}

const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
for (const node of nodes) {
  const visited = new Set();
  let current = node.id;
  while (current) {
    if (visited.has(current)) {
      push(`parent cycle detected at ${current}`);
      break;
    }
    visited.add(current);
    current = parentById.get(current);
  }
}

// Exam flows resolve a subject's answering mode from metadata, so every subject
// node must carry a published, parseable exam_delivery policy.
const policies = fixture.payload.assessmentPolicies;
const deliveryKinds = new Set(['objective', 'subjective']);
const deliveryBySubject = new Map();
for (const policy of policies) {
  if (policy.policyType !== 'exam_delivery') continue;
  if (policy.status !== 'published') continue;
  if (deliveryBySubject.has(policy.subject)) {
    push(`duplicate published exam_delivery policy for subject: ${policy.subject}`);
  }
  deliveryBySubject.set(policy.subject, policy);
}

for (const node of nodes.filter((item) => item.nodeType === 'subject' && item.status === 'active')) {
  const policy = deliveryBySubject.get(node.subject);
  if (!policy) {
    push(`subject ${node.subject} has no published exam_delivery policy`);
    continue;
  }
  if (!deliveryKinds.has(policy.config.deliveryKind)) {
    push(`subject ${node.subject} has invalid deliveryKind: ${policy.config.deliveryKind}`);
  }
  const mockExam = policy.config.mockExam;
  if (mockExam === undefined) continue;
  if (!Number.isInteger(mockExam.defaultQuestionCount) || mockExam.defaultQuestionCount <= 0) {
    push(`subject ${node.subject} has invalid mockExam.defaultQuestionCount`);
  }
  if (!Number.isInteger(mockExam.defaultDurationMinutes) || mockExam.defaultDurationMinutes <= 0) {
    push(`subject ${node.subject} has invalid mockExam.defaultDurationMinutes`);
  }
  const schemeCodes = new Set();
  for (const scheme of mockExam.schemes ?? []) {
    if (!scheme.code || schemeCodes.has(scheme.code)) {
      push(`subject ${node.subject} has duplicate or empty mock scheme code: ${scheme.code}`);
    }
    if (!scheme.name) push(`subject ${node.subject} mock scheme ${scheme.code} has no name`);
    if (!Number.isInteger(scheme.questionCount) || scheme.questionCount <= 0) {
      push(`subject ${node.subject} mock scheme ${scheme.code} has invalid questionCount`);
    }
    if (!Number.isInteger(scheme.durationMinutes) || scheme.durationMinutes <= 0) {
      push(`subject ${node.subject} mock scheme ${scheme.code} has invalid durationMinutes`);
    }
    schemeCodes.add(scheme.code);
  }
}

  if (seenExamTypes.has(fixture.manifest.examType)) push(`duplicate examType across packages: ${fixture.manifest.examType}`);
  seenExamTypes.add(fixture.manifest.examType);
  totalNodes += nodes.length;
  totalEdges += fixture.payload.capabilityEdges.length;
  totalDeliveryPolicies += deliveryBySubject.size;
}
