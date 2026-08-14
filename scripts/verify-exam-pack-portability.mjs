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
  const [curriculum, evidence, labels, gradingRules, writtenFormats, capabilitySelection, dailyCapabilitySelection] = await Promise.all([
    server.ssrLoadModule('/src/modules/curriculum/public.ts'),
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/domain/labels.ts'),
    server.ssrLoadModule('/src/domain/choiceGradingRules.ts'),
    server.ssrLoadModule('/src/domain/writtenFormats.ts'),
    server.ssrLoadModule('/src/composition-root/agent/selectPracticeCapability.ts'),
    server.ssrLoadModule('/src/features/practice/CapabilitySelection.ts')
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
    ['education_theory', 'subject_knowledge', 'teaching_design'],
    'subjects are whatever the package declares'
  );
  assert.deepEqual(subjects.map((subject) => subject.shortName), ['教综', '学科', '写作']);
  assert.deepEqual(
    subjects.map((subject) => subject.deliveryKind),
    ['objective', 'objective', 'subjective']
  );
  assert.equal(subjects[0].score.maxScore, 150, 'score bands come from the package, not a 100-point assumption');
  assert.deepEqual(
    subjects[0].modules.map((module) => module.code),
    ['pedagogy', 'psychology']
  );

  // --- 少选 is scored per subject, not per package ------------------------------
  // This track scores its two objective subjects differently on purpose: a
  // package is not required to agree with itself, and the earlier version of
  // this check only looked at the first subject, so it passed while every
  // 学科专业知识 set was being frozen with 教综's rule.
  const deliveryForGrading = await server.ssrLoadModule('/src/domain/subjectDelivery.ts');
  deliveryForGrading.installSubjectDelivery(subjects, teacher.bundle.capabilityNodes);
  gradingRules.installChoiceGradingRule(subjects);
  assert.equal(gradingRules.choiceGradingRule('education_theory').underSelectionCreditWeight, 0);
  assert.equal(gradingRules.choiceGradingRule('subject_knowledge').underSelectionCreditWeight, 0.5);
  assert.equal(
    gradingRules.choiceGradingRule().underSelectionCreditWeight,
    0.5,
    'with no subject in hand and no single answer, the grader falls back to the default rather than guessing one'
  );
  assert.equal(
    evidence.gradeChoiceAnswer('multiple_choice', ['A', 'B'], ['A'], gradingRules.choiceGradingRule('education_theory')).score,
    0,
    'an under-selected answer earns nothing in 教综'
  );
  assert.equal(
    evidence.gradeChoiceAnswer('multiple_choice', ['A', 'B'], ['A'], gradingRules.choiceGradingRule('subject_knowledge')).score,
    0.25,
    'the same answer earns partial credit in 学科专业知识'
  );
  assert.match(
    gradingRules.multiAnswerGradingHint('multiple_choice', gradingRules.choiceGradingRule('education_theory')),
    /少选不得分/,
    'the page promises what this subject actually does'
  );

  // A set freezes its own subject's rule, resolved from the capability node.
  const frozenTheory = gradingRules.gradingPolicyForCapabilityNode('capability:edu-theory:pedagogy:principles');
  const frozenSubject = gradingRules.gradingPolicyForCapabilityNode('capability:subject-knowledge:fundamentals:core');
  assert.equal(frozenTheory.underSelectionCreditWeight, 0);
  assert.equal(frozenSubject.underSelectionCreditWeight, 0.5);
  assert.notEqual(frozenTheory.policyHash, undefined);
  assert.equal(
    gradingRules.gradingPolicyForCapabilityNode('capability:teaching-design:writing:argument'),
    undefined,
    'a written subject freezes no choice-grading rule'
  );
  assert.deepEqual(
    gradingRules.choiceGradingRuleForCapabilityNode('capability:edu-theory:pedagogy:principles'),
    { underSelectionCreditWeight: 0 },
    'legacy sets without a frozen policy must use their own capability subject'
  );
  assert.deepEqual(
    gradingRules.choiceGradingRuleForCapabilityNode('capability:subject-knowledge:fundamentals:core'),
    { underSelectionCreditWeight: 0.5 },
    'legacy scoring must not borrow the first objective subject rule'
  );

  // --- labels and answer formats follow the package ----------------------------
  labels.installCurriculumLabels(teacher.bundle.capabilityNodes);
  assert.equal(labels.practiceModuleLabel('pedagogy'), '教育学基础');
  assert.equal(labels.practiceModuleCode('教育学基础'), 'pedagogy');
  // Written answering is named by the package too: nothing here is 申论.
  writtenFormats.installWrittenFormats(subjects);
  assert.deepEqual(writtenFormats.writtenFormatNames(), ['教育案例分析', '教育写作']);
  assert.equal(writtenFormats.isLongFormTopic('教育写作'), true, 'the package says which format is one long piece');
  assert.equal(writtenFormats.isLongFormTopic('教育案例分析'), false);
  assert.equal(writtenFormats.isLongFormTopic('申发论述'), false, 'another track\'s format is unknown here');
  assert.equal(writtenFormats.defaultLongFormTopic(), '教育写作');
  assert.equal(writtenFormats.defaultShortFormTopic(), '教育案例分析');

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
  assert.ok(generationNodes.length > 0, 'the objective subjects of this track are generatable');
  assert.ok(
    generationNodes.every((node) => node.subject !== 'teaching_design'),
    'a written subject is not fed to objective generation'
  );
  assert.ok(
    capabilitySelection.selectPracticeCapability(generationNodes, { module: '心理学基础' }),
    'the generation path must resolve a capability on this package'
  );
  assert.deepEqual(
    new Set(dailyCapabilitySelection.trainableObjectiveNodes(nodes).map((node) => node.subject)),
    new Set(['education_theory', 'subject_knowledge']),
    'diagnosis and daily practice must keep every objective subject declared by the package'
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
  assert.equal(delivery.subjectDeliveryKind('teaching_design'), 'subjective');
  assert.equal(delivery.subjectDeliveryKind('aptitude'), undefined, 'another track\'s subject is unknown here');
  assert.equal(delivery.isInterviewSubject('education_theory'), false);

  const planItem = { id: 'item:1', itemType: 'independent_practice', capabilityNodeId: 'capability:edu-theory:pedagogy:principles', exitCriteria: {} };
  const route = planNavigation.dailyPlanItemLocation(planItem, 'education_theory');
  assert.equal(route.path, '/vue/practice');
  assert.equal(route.query.subject, 'aptitude', 'an objective subject reaches the objective flow whatever it is called');

  // A written plan item reaches the written flow, named by this package.
  const writtenRoute = planNavigation.dailyPlanItemLocation(planItem, 'teaching_design');
  assert.equal(writtenRoute.path, '/vue/practice');
  assert.equal(writtenRoute.query.subject, 'essay', 'a subjective subject reaches the written flow');

  // Labels follow the package, so this track never says 行测 or 申论 on screen.
  assert.equal(practiceSubject.practiceSubjectLabel('aptitude'), '教综');
  assert.equal(practiceSubject.practiceSubjectLabel('essay'), '写作');

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

  // --- written mocks are dispatched by delivery kind, not by a subject name ----
  const taskContract = await server.ssrLoadModule('/src/services/GenerationTaskContract.ts');
  const writtenMock = taskContract.generationTaskActionParams({
    intent: 'mock',
    payload: { deliveryKind: 'subjective', essayTopic: '教育写作', essayType: 'long' }
  });
  assert.equal(writtenMock.type, 'long', 'a written mock reaches the written contract');
  assert.equal(writtenMock.topic, '教育写作');
  const untitledGrade = taskContract.generationTaskActionParams({ intent: 'essayGrade', payload: {} });
  assert.equal(untitledGrade.topic, '教育案例分析', 'the default topic is the package\'s own short format');

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
