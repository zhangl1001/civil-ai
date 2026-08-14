// Proves the app is driven by the installed exam package rather than by the
// civil-service track it was first written for.
//
// Everything here runs against the bundled 教师招聘 package, whose subjects,
// modules, score bands and 少选 rule all differ from 公务员考试. Anything that
// still assumes 行测 shows up as a failure rather than as a surprise in the app.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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

  // --- flows are chosen by how a subject is answered ---------------------------
  const delivery = await server.ssrLoadModule('/src/domain/subjectDelivery.ts');
  const planNavigation = await server.ssrLoadModule('/src/features/planning/DailyPlanNavigation.ts');
  const practiceSubject = await server.ssrLoadModule('/src/features/practice/PracticeSubject.ts');
  delivery.installSubjectDelivery(subjects);
  assert.equal(delivery.subjectDeliveryKind('education_theory'), 'objective');
  assert.equal(delivery.subjectDeliveryKind('aptitude'), undefined, 'another track\'s subject is unknown here');
  assert.equal(delivery.isInterviewSubject('education_theory'), false);

  const planItem = { id: 'item:1', itemType: 'independent_practice', capabilityNodeId: 'capability:edu-theory:pedagogy:principles', exitCriteria: {} };
  const route = planNavigation.dailyPlanItemLocation(planItem, 'education_theory');
  assert.equal(route.path, '/vue/practice');
  assert.equal(route.query.subject, 'aptitude', 'an objective subject reaches the objective flow whatever it is called');

  // The label follows the package, so this track never says 行测 on screen.
  assert.equal(practiceSubject.practiceSubjectLabel('aptitude'), '教综');

  // The civil-service track keeps its own answer, including the interview flow.
  const civil = curriculum.projectExamSubjects(packs.find((pack) => pack.examType === 'civil_service').bundle);
  delivery.installSubjectDelivery(civil);
  assert.equal(delivery.subjectDeliveryKind('interview'), 'interview');
  assert.equal(
    planNavigation.dailyPlanItemLocation(planItem, 'interview').path,
    '/vue/interview',
    'the interview flow is reached by delivery kind, not by subject code'
  );
  assert.equal(practiceSubject.practiceSubjectLabel('essay'), '申论');

  // --- the schema must not decide which subjects exist -------------------------
  // A CHECK listing subject codes rejects a package's rows outright, which no
  // amount of application-level indirection can work around.
  const migrationDirectory = path.join(root, 'src/capabilities/database/migrations');
  const migrationFiles = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'));
  const currentSubjectChecks = [];
  for (const name of migrationFiles) {
    const sql = await readFile(path.join(migrationDirectory, name), 'utf8');
    // Only the live shape matters: a rebuilt table's old definition is history.
    for (const match of sql.matchAll(/subject TEXT NOT NULL CHECK\(subject IN \(([^)]*)\)\)/g)) {
      currentSubjectChecks.push(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual(
    currentSubjectChecks.filter((entry) => !entry.startsWith('035_')),
    [],
    'no migration after the original may constrain subject to a fixed set of codes'
  );
  const latestBlockShape = await readFile(
    path.join(migrationDirectory, '042_daily_plan_block_subject.sql'), 'utf8'
  );
  assert.match(latestBlockShape, /subject TEXT NOT NULL CHECK\(length\(subject\) > 0\)/);

  console.log(`Exam pack portability verification passed (${packs.length} packages, ${subjects.length} subjects on the second track).`);
} finally {
  await server.close();
}
