// Proves the app is driven by the installed exam package rather than by the
// civil-service track it was first written for.
//
// Everything here runs against the bundled 教师招聘 package, whose subjects,
// modules, score bands and 少选 rule all differ from 公务员考试. Anything that
// still assumes 行测 shows up as a failure rather than as a surprise in the app.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

try {
  const [curriculum, evidence, labels, gradingRules, writtenFormats, capabilitySelection] = await Promise.all([
    server.ssrLoadModule('/src/modules/curriculum/public.ts'),
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/domain/labels.ts'),
    server.ssrLoadModule('/src/domain/choiceGradingRules.ts'),
    server.ssrLoadModule('/src/domain/writtenFormats.ts'),
    server.ssrLoadModule('/src/composition-root/agent/selectPracticeCapability.ts')
  ]);

  const packs = curriculum.createBundledCurriculumPacks();
  assert.ok(packs.length >= 2, 'the app must ship more than one exam package');
  const teacher = packs.find((pack) => pack.examType === 'teacher_recruitment');
  assert.ok(teacher, 'teacher_recruitment package must be bundled');
  assert.equal(teacher.regionScoped, false, 'a track sat the same way everywhere hides scope and province');
  assert.deepEqual(teacher.promptBundles, [], 'a package with no wording of its own falls back to shared prompts');

  // --- subjects come from the package, not from code ---------------------------
  const subjects = curriculum.projectExamSubjects(teacher.bundle);
  assert.deepEqual(
    subjects.map((subject) => subject.code),
    ['education_theory', 'subject_knowledge'],
    'subjects are whatever the package declares'
  );
  assert.deepEqual(subjects.map((subject) => subject.shortName), ['教综', '学科']);
  assert.deepEqual(subjects.map((subject) => subject.deliveryKind), ['objective', 'objective']);
  assert.equal(subjects[0].score.maxScore, 150, 'score bands come from the package, not a 100-point assumption');
  assert.deepEqual(
    subjects[0].modules.map((module) => module.code),
    ['pedagogy', 'psychology']
  );

  // --- the package decides how 少选 scores -------------------------------------
  gradingRules.installChoiceGradingRule(subjects);
  assert.equal(
    gradingRules.choiceGradingRule().underSelectionCreditWeight,
    0,
    'this package gives no credit for an under-selected answer'
  );
  const graded = evidence.gradeChoiceAnswer(
    'multiple_choice', ['A', 'B'], ['A'], gradingRules.choiceGradingRule()
  );
  assert.equal(graded.score, 0, 'grading follows the package rule');
  assert.match(
    gradingRules.multiAnswerGradingHint('multiple_choice'),
    /少选不得分/,
    'the page promises what this package actually does'
  );
  assert.ok(gradingRules.activeGradingPolicy(), 'a question set published now can freeze this rule');

  // --- labels and answer formats follow the package ----------------------------
  labels.installCurriculumLabels(teacher.bundle.capabilityNodes);
  assert.equal(labels.practiceModuleLabel('pedagogy'), '教育学基础');
  assert.equal(labels.practiceModuleCode('教育学基础'), 'pedagogy');
  writtenFormats.installWrittenFormats(subjects);
  assert.deepEqual(writtenFormats.writtenFormatNames(), [], 'an all-objective track offers no written formats');

  // --- practice targeting works on this package's own modules ------------------
  const nodes = teacher.bundle.capabilityNodes.filter((node) => node.status === 'active');
  const picked = capabilitySelection.selectPracticeCapability(nodes, {
    module: '教育学基础',
    capabilityIndex: 0
  });
  assert.ok(picked, 'a module of this package must resolve to a trainable node');
  assert.equal(picked.module, 'pedagogy', 'practice must not fall back across modules');
  assert.equal(picked.nodeType, 'knowledge_point');
  const byName = capabilitySelection.selectPracticeCapability(nodes, {
    module: '心理学基础',
    knowledgePoint: '学习动机'
  });
  assert.equal(byName.code, 'edu_theory.psychology.learning', 'a named knowledge point still wins');

  // --- generation targets this package's objective subjects --------------------
  // The package names none of its subjects 'aptitude', so a generation path that
  // filtered on that code would find nothing and refuse to generate at all.
  assert.equal(
    nodes.filter((node) => node.subject === 'aptitude').length,
    0,
    'this package deliberately shares no subject code with the civil-service track'
  );
  const objectiveSubjects = new Set(
    subjects.filter((subject) => subject.deliveryKind === 'objective').map((subject) => subject.code)
  );
  const generationNodes = nodes.filter((node) => objectiveSubjects.has(node.subject));
  assert.equal(generationNodes.length, nodes.length, 'every node of an all-objective track is generatable');
  assert.ok(
    capabilitySelection.selectPracticeCapability(generationNodes, { module: '心理学基础' }),
    'the generation path must resolve a capability on this package'
  );

  // The assertions above run the package through the projection; this one pins
  // the application code itself, which the projection cannot reach from here.
  const generationSource = await readFile(
    path.join(root, 'src/composition-root/agent/createTutorAgentHandlers.ts'),
    'utf8'
  );
  assert.doesNotMatch(
    generationSource,
    /subject === 'aptitude'/,
    'generation must select subjects by delivery kind, never by the civil-service subject code'
  );
  assert.match(generationSource, /ExamDeliveryKind\.Objective/);

  console.log(`Exam pack portability verification passed (${packs.length} packages, ${subjects.length} subjects on the second track).`);
} finally {
  await server.close();
}
