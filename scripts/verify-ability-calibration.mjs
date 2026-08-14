import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

const now = 1_800_000_000_000;
const modules = [
  ['judgment', '判断推理', .25],
  ['verbal', '言语理解', .30],
  ['data_analysis', '资料分析', .20],
  ['quantity', '数量关系', .15],
  ['common_sense', '常识判断', .10]
];

try {
  const [calibration, evidenceModule] = await Promise.all([
    server.ssrLoadModule('/src/modules/calibration/public.ts'),
    server.ssrLoadModule('/src/modules/evidence/public.ts')
  ]);

  const officialWeight = evidenceModule.objectiveEvidencePolicyV2.correctnessWeight(
    'anchor', 0, evidenceModule.ObjectiveEvidenceOrigin.OfficialTrue
  );
  const aiWeight = evidenceModule.objectiveEvidencePolicyV2.correctnessWeight(
    'anchor', 0, evidenceModule.ObjectiveEvidenceOrigin.AiTraining
  );
  assert.ok(officialWeight > aiWeight, 'Official evidence must outweigh AI training evidence');

  const snapshots = [];
  const repository = {
    async findLatest(examCycleId) {
      return snapshots.filter((item) => item.examCycleId === examCycleId).at(-1);
    },
    async findByFingerprint(fingerprint) {
      return snapshots.find((item) => item.inputFingerprint === fingerprint);
    },
    async append(snapshot) {
      if (snapshots.some((item) => item.inputFingerprint === snapshot.inputFingerprint)) {
        throw new Error('duplicate fingerprint');
      }
      snapshots.push(snapshot);
    }
  };
  const evidence = baselineEvidence();
  let id = 0;
  const builder = new calibration.BuildAbilityCalibration(
    { async run(work) { return work({}); } },
    repository,
    { async findCurrentCycle() { return candidateCycle(); } },
    { async findBundle() { return curriculumBundle(); } },
    { async listAllValid() { return evidence; } },
    { async listAllTracks() { return []; } },
    { now() { return now; } },
    { next(namespace) { id += 1; return `${namespace}:${id}`; } }
  );

  const first = await builder.execute();
  assert(first);
  assert.equal(first.baseline.status, 'sufficient');
  assert.equal(first.baseline.coveredModuleCount, 5);
  assert.equal(first.baseline.uncoveredModules.length, 0);
  const judgment = first.modules.find((item) => item.module === 'judgment');
  assert(judgment);
  assert.equal(judgment.trainingAccuracy, 1);
  assert.equal(judgment.trueQuestionAccuracy, .5);
  assert.ok(judgment.calibrationGap < 0);
  const aptitude = first.scoreForecasts.find((item) => item.subject === 'aptitude');
  assert(aptitude?.low !== undefined && aptitude.high !== undefined && aptitude.center !== undefined);
  assert.ok(aptitude.low <= aptitude.center && aptitude.center <= aptitude.high);
  assert.ok(aptitude.high - aptitude.low >= 8, 'Low-confidence forecast must remain an interval');
  const essay = first.scoreForecasts.find((item) => item.subject === 'essay');
  assert.equal(essay?.basis, 'blended');
  assert.ok(essay?.center !== undefined && essay.center > 52, 'Essay rubric evidence must update the self-reported baseline');

  const repeated = await builder.execute();
  assert.equal(repeated?.id, first.id);
  assert.equal(snapshots.length, 1, 'Same evidence fingerprint must not create another snapshot');

  evidence.push(makeEvidence('judgment:true:3', 'cap:judgment', 1, 'official'));
  const changed = await builder.execute();
  assert.notEqual(changed?.id, first.id);
  assert.equal(snapshots.length, 2);
  assert.ok(changed?.changes.some((item) => item.module === 'judgment'));
  console.log('Ability calibration verification passed.');
} finally {
  await server.close();
}

function candidateCycle() {
  return {
    project: { id: 'ProjectId:1', name: '江苏省考' },
    profile: { id: 'CandidateProfileId:1' },
    examCycle: {
      id: 'ExamCycleId:1', curriculumVersionId: 'CurriculumVersionId:1', phase: 'foundation'
    },
    scoreTargets: [
      { id: 'ScoreTargetId:1', subject: 'aptitude', targetScore: 80, maxScore: 100, status: 'active' },
      { id: 'ScoreTargetId:2', subject: 'essay', targetScore: 70, maxScore: 100, status: 'active' }
    ],
    scoreMeasurements: [
      { id: 'ScoreMeasurementId:1', subject: 'aptitude', score: 55, maxScore: 100, confidence: .45, measurementType: 'self_report', measuredAt: now },
      { id: 'ScoreMeasurementId:2', subject: 'essay', score: 52, maxScore: 100, confidence: .4, measurementType: 'self_report', measuredAt: now }
    ]
  };
}

function curriculumBundle() {
  return {
    curriculum: { id: 'CurriculumVersionId:1' },
    capabilityNodes: [
      ...modules.flatMap(([module, name, scoreWeight]) => [
      {
        id: `module:${module}`, code: `aptitude.${module}`, name, module, subject: 'aptitude',
        nodeType: 'module', status: 'active', scoreWeight
      },
      {
        id: `cap:${module}`, code: `aptitude.${module}.core`, name: `${name}核心`, module,
        subject: 'aptitude', nodeType: 'knowledge_point', status: 'active', scoreWeight
      }
      ]),
      {
        id: 'cap:essay:material', code: 'essay.material_analysis', name: '材料分析', module: 'essay',
        subject: 'essay', nodeType: 'knowledge_point', status: 'active', scoreWeight: 1
      },
      // Subject nodes carry the delivery policies below; calibration reads them
      // to learn which subjects it can model accuracy for at all.
      {
        id: 'subject:aptitude', code: 'aptitude', name: '行政职业能力测验', module: 'aptitude',
        subject: 'aptitude', nodeType: 'subject', status: 'active', scoreWeight: 1, sequence: 10
      },
      {
        id: 'subject:essay', code: 'essay', name: '申论', module: 'essay',
        subject: 'essay', nodeType: 'subject', status: 'active', scoreWeight: 1, sequence: 20
      }
    ],
    capabilityEdges: [],
    assessmentPolicies: [
      {
        id: 'policy:aptitude:delivery', subject: 'aptitude', policyType: 'exam_delivery',
        version: '1.0.0', status: 'published', config: { deliveryKind: 'objective' }
      },
      {
        id: 'policy:essay:delivery', subject: 'essay', policyType: 'exam_delivery',
        version: '1.0.0', status: 'published', config: { deliveryKind: 'subjective' }
      }
    ]
  };
}

function baselineEvidence() {
  return [
    ...modules.flatMap(([module]) => {
    const values = [1, 1, 1].map((value, index) => makeEvidence(
      `${module}:training:${index}`,
      `cap:${module}`,
      value,
      'diagnostic_anchor'
    ));
    if (module === 'judgment') {
      values.push(makeEvidence('judgment:true:1', 'cap:judgment', 1, 'official'));
      values.push(makeEvidence('judgment:true:2', 'cap:judgment', 0, 'official'));
    }
    return values;
    }),
    ...[.72, .76, .7, .74, .78].map((value, index) => makeSubjectiveEvidence(index, value))
  ];
}

function makeSubjectiveEvidence(index, value) {
  return {
    id: `essay:${index}`,
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'cap:essay:material',
    assessmentRole: 'practice',
    evidenceType: 'correctness',
    value,
    weight: 1,
    quality: .9,
    source: 'ai_grader',
    validationPolicyVersion: 'essay-rubric:v1',
    occurredAt: now,
    idempotencyKey: `essay:${index}`,
    metadata: { evidenceKind: 'subjective_rubric', dimensionKey: `dimension-${index}` }
  };
}

function makeEvidence(id, capabilityNodeId, value, origin) {
  return {
    id,
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId,
    assessmentRole: 'anchor',
    evidenceType: 'correctness',
    value,
    weight: origin === 'official' ? 1 : .85,
    quality: 1,
    source: 'deterministic_grader',
    validationPolicyVersion: 'aptitude-objective:v2',
    occurredAt: now,
    idempotencyKey: id,
    metadata: { questionOriginType: origin }
  };
}
