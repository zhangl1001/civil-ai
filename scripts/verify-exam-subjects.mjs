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

const repositoryFor = (bundle) => ({ async findBundle() { return bundle; } });

try {
  const curriculum = await server.ssrLoadModule('/src/modules/curriculum/public.ts');
  const bundle = curriculum.createBundledNationalCurriculum();
  const versionId = bundle.curriculum.id;

  const subjects = await new curriculum.GetExamSubjects(repositoryFor(bundle)).execute(versionId);

  // Subjects come from the package, in package order, not from application code.
  assert.deepEqual(subjects.map((item) => item.code), ['aptitude', 'essay', 'interview']);

  const aptitude = subjects[0];
  assert.equal(aptitude.name, '行政职业能力测验');
  // Short names let compact UI stay readable without truncating in the page.
  assert.equal(aptitude.shortName, '行测');
  assert.equal(aptitude.deliveryKind, curriculum.ExamDeliveryKind.Objective);
  // Modules replace the former hard-coded XC_MODULES list, ordered by sequence.
  assert.deepEqual(
    aptitude.modules.map((item) => item.name),
    ['判断推理', '言语理解与表达', '资料分析', '数量关系', '常识判断']
  );
  assert.deepEqual(
    aptitude.modules.map((item) => item.shortName ?? item.name),
    ['判断推理', '言语理解', '资料分析', '数量关系', '常识判断']
  );
  assert.equal(aptitude.mockExam.defaultQuestionCount, 120);
  assert.deepEqual(aptitude.mockExam.schemes.map((item) => item.code), ['national', 'provincial', 'compact']);
  assert.equal(aptitude.mockExam.focusTags.length, 7);

  const essay = subjects[1];
  assert.equal(essay.deliveryKind, curriculum.ExamDeliveryKind.Subjective);
  assert.equal(essay.mockExam.defaultDurationMinutes, 180);

  // Interview is its own delivery kind, not a flavour of subjective: the flow
  // that answers it is reached by kind rather than by the subject's code.
  const interview = subjects[2];
  assert.equal(interview.deliveryKind, curriculum.ExamDeliveryKind.Interview);
  assert.notEqual(interview.deliveryKind, essay.deliveryKind);
  assert.equal(interview.mockExam, undefined);
  assert.equal(interview.shortName, '面试');
  // Subjects whose full name already fits carry no short name.
  assert.equal(essay.shortName, undefined);

  // A subject whose delivery policy is missing or unparseable is not offered
  // rather than guessed at.
  const withoutAptitudePolicy = {
    ...bundle,
    assessmentPolicies: bundle.assessmentPolicies.filter((item) => item.id !== 'policy:aptitude:delivery:v1')
  };
  const skipped = await new curriculum.GetExamSubjects(repositoryFor(withoutAptitudePolicy)).execute(versionId);
  assert.deepEqual(skipped.map((item) => item.code), ['essay', 'interview']);

  const withBadKind = {
    ...bundle,
    assessmentPolicies: bundle.assessmentPolicies.map((item) => item.id === 'policy:essay:delivery:v1'
      ? { ...item, config: { ...item.config, deliveryKind: 'written' } }
      : item)
  };
  const rejected = await new curriculum.GetExamSubjects(repositoryFor(withBadKind)).execute(versionId);
  assert.deepEqual(rejected.map((item) => item.code), ['aptitude', 'interview']);

  // Draft policies must not win over the published one.
  const withDraftOverride = {
    ...bundle,
    assessmentPolicies: [
      ...bundle.assessmentPolicies,
      {
        ...bundle.assessmentPolicies.find((item) => item.id === 'policy:aptitude:delivery:v1'),
        id: 'policy:aptitude:delivery:v2',
        version: '2.0.0',
        status: 'draft',
        config: { deliveryKind: 'subjective' }
      }
    ]
  };
  const published = await new curriculum.GetExamSubjects(repositoryFor(withDraftOverride)).execute(versionId);
  assert.equal(published[0].deliveryKind, curriculum.ExamDeliveryKind.Objective);

  // Version resolution picks the highest published version, including 1.10 > 1.9.
  const withNewerPublished = {
    ...bundle,
    assessmentPolicies: [
      ...bundle.assessmentPolicies,
      {
        ...bundle.assessmentPolicies.find((item) => item.id === 'policy:aptitude:delivery:v1'),
        id: 'policy:aptitude:delivery:v110',
        version: '1.10.0',
        config: { deliveryKind: 'subjective' }
      }
    ]
  };
  const newest = await new curriculum.GetExamSubjects(repositoryFor(withNewerPublished)).execute(versionId);
  assert.equal(newest[0].deliveryKind, curriculum.ExamDeliveryKind.Subjective);

  assert.deepEqual(await new curriculum.GetExamSubjects({ async findBundle() { return undefined; } }).execute(versionId), []);

  // Scoring bands drive the exam profile form, so only scored subjects carry one.
  assert.deepEqual(subjects[0].score, { maxScore: 100, defaultCurrent: 50, defaultTarget: 80 });
  assert.deepEqual(subjects[1].score, { maxScore: 100, defaultCurrent: 50, defaultTarget: 70 });
  assert.equal(subjects[2].score, undefined);

  // A target above the band would render an unreachable goal, so it is rejected.
  const impossibleTarget = {
    ...bundle,
    assessmentPolicies: bundle.assessmentPolicies.map((item) => item.id === 'policy:aptitude:delivery:v1'
      ? { ...item, config: { ...item.config, score: { maxScore: 100, defaultCurrent: 50, defaultTarget: 150 } } }
      : item)
  };
  const rejectedScore = await new curriculum.GetExamSubjects(repositoryFor(impossibleTarget)).execute(versionId);
  assert.equal(rejectedScore[0].score, undefined);

  // Every bundled pack must be installable and expose at least one scored subject.
  const packs = curriculum.createBundledCurriculumPacks();
  assert(packs.length >= 1, 'at least one exam pack must be bundled');
  const examTypes = packs.map((pack) => pack.examType);
  assert.equal(new Set(examTypes).size, examTypes.length, 'exam pack examType must be unique');
  for (const pack of packs) {
    assert(pack.examName, `pack ${pack.examType} needs a display name`);
    assert.equal(typeof pack.regionScoped, 'boolean');
    const packSubjects = await new curriculum.GetExamSubjects(repositoryFor(pack.bundle)).execute(pack.bundle.curriculum.id);
    assert(packSubjects.length > 0, `pack ${pack.examType} exposes no subjects`);
    assert(
      packSubjects.some((subject) => subject.score !== undefined),
      `pack ${pack.examType} has no scored subject, so the profile form would be empty`
    );
    assert.equal(pack.bundle.metadataPackage.examType, pack.examType, 'pack examType must match its metadata');
  }

  console.log(`Exam subject projection verification passed (${subjects.length} subjects).`);
} finally { await server.close(); }
