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

try {
  const [evidence, content] = await Promise.all([
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/modules/content/public.ts')
  ]);
  const { gradeChoiceAnswer, AttemptResult } = evidence;
  const { QuestionTemplateCode } = content;
  const single = QuestionTemplateCode.SingleChoice;
  const multiple = QuestionTemplateCode.MultipleChoice;
  const indeterminate = QuestionTemplateCode.IndeterminateChoice;

  // --- single choice ----------------------------------------------------------
  assert.deepEqual(gradeChoiceAnswer(single, ['B'], ['B']), { result: AttemptResult.Correct, score: 1 });
  assert.deepEqual(gradeChoiceAnswer(single, ['B'], ['A']), { result: AttemptResult.Incorrect, score: 0 });
  assert.deepEqual(gradeChoiceAnswer(single, ['B'], []), { result: AttemptResult.Unanswered, score: 0 });
  // Malformed data must not sneak partial credit into a single-answer template.
  assert.deepEqual(gradeChoiceAnswer(single, ['A', 'B'], ['A']), { result: AttemptResult.Incorrect, score: 0 });

  // --- multiple choice --------------------------------------------------------
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], ['A', 'C']), { result: AttemptResult.Correct, score: 1 });
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], ['C', 'A']), { result: AttemptResult.Correct, score: 1 });
  // 错选：any wrong option scores nothing, even alongside correct ones.
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], ['A', 'B']), { result: AttemptResult.Incorrect, score: 0 });
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], ['A', 'C', 'D']), { result: AttemptResult.Incorrect, score: 0 });
  // 少选：correct but incomplete earns proportional, discounted credit.
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], ['A']), { result: AttemptResult.Partial, score: 0.25 });
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'B', 'C'], ['A', 'B']), { result: AttemptResult.Partial, score: 0.3333 });
  assert.deepEqual(gradeChoiceAnswer(multiple, ['A', 'C'], []), { result: AttemptResult.Unanswered, score: 0 });

  // --- indeterminate choice ---------------------------------------------------
  assert.deepEqual(gradeChoiceAnswer(indeterminate, ['B'], ['B']), { result: AttemptResult.Correct, score: 1 });
  assert.deepEqual(gradeChoiceAnswer(indeterminate, ['A', 'D'], ['D']), { result: AttemptResult.Partial, score: 0.25 });
  assert.deepEqual(gradeChoiceAnswer(indeterminate, ['A', 'D'], ['B']), { result: AttemptResult.Incorrect, score: 0 });

  // Scores must stay inside the attempts.score CHECK constraint.
  const scores = [
    gradeChoiceAnswer(multiple, ['A', 'B', 'C', 'D'], ['A']).score,
    gradeChoiceAnswer(multiple, ['A', 'B'], ['A']).score,
    gradeChoiceAnswer(multiple, ['A', 'B'], ['A', 'B']).score
  ];
  assert(scores.every((score) => score >= 0 && score <= 1), `score out of range: ${scores}`);

  // --- the review loop must see partial credit ---------------------------------
  // Adding `partial` to the result set silently dropped those attempts out of the
  // wrong book, AI diagnosis, tutor conclusions and the post-submit page.
  assert.equal(evidence.isMistakenAttempt(AttemptResult.Incorrect), true);
  assert.equal(evidence.isMistakenAttempt(AttemptResult.Partial), true);
  assert.equal(evidence.isMistakenAttempt(AttemptResult.Correct), false);
  assert.equal(evidence.isMistakenAttempt(AttemptResult.Unanswered), false);
  // A partially correct multi-answer attempt is graded partial, so it must enter
  // the same review loop an outright wrong answer does.
  const underSelected = gradeChoiceAnswer(multiple, ['A', 'C'], ['A']);
  assert.equal(evidence.isMistakenAttempt(underSelected.result), true);

  // --- the 少选 rule belongs to the exam package -------------------------------
  const curriculum = await server.ssrLoadModule('/src/modules/curriculum/public.ts');
  const rules = await server.ssrLoadModule('/src/domain/choiceGradingRules.ts');
  const bundled = curriculum.projectExamSubjects(curriculum.createBundledNationalCurriculum());
  rules.installChoiceGradingRule(bundled);
  assert.deepEqual(rules.choiceGradingRule(), { underSelectionCreditWeight: 0.5 });

  // A package declaring a different rule changes the score without code changes.
  const strictPack = bundled.map((subject) => (subject.deliveryKind === 'objective'
    ? { ...subject, choiceGrading: { underSelectionCreditWeight: 0.2 } }
    : subject));
  rules.installChoiceGradingRule(strictPack);
  assert.deepEqual(
    gradeChoiceAnswer(multiple, ['A', 'C'], ['A'], rules.choiceGradingRule()),
    { result: AttemptResult.Partial, score: 0.1 }
  );

  // A package awarding nothing for 少选 still records the attempt as partial,
  // so it stays in the review loop even at zero score.
  rules.installChoiceGradingRule(bundled.map((subject) => (subject.deliveryKind === 'objective'
    ? { ...subject, choiceGrading: { underSelectionCreditWeight: 0 } }
    : subject)));
  const noCredit = gradeChoiceAnswer(multiple, ['A', 'C'], ['A'], rules.choiceGradingRule());
  assert.deepEqual(noCredit, { result: AttemptResult.Partial, score: 0 });
  assert.equal(evidence.isMistakenAttempt(noCredit.result), true);

  // A package with no rule falls back to the shipped default.
  rules.installChoiceGradingRule([]);
  assert.deepEqual(rules.choiceGradingRule(), evidence.DEFAULT_CHOICE_GRADING_RULE);

  // --- persisted answer round trip -------------------------------------------
  const stored = evidence.choiceAttemptAnswer(['A', 'C']);
  assert.deepEqual(stored, { optionIds: ['A', 'C'] });
  assert.deepEqual([...evidence.submittedOptionIds(stored)], ['A', 'C']);
  assert.equal(evidence.submittedAnswerLabel(stored), 'AC');
  assert.deepEqual([...evidence.submittedOptionIds({})], []);
  assert.equal(evidence.submittedAnswerLabel({}), '');
  // Rows written before answers became lists must not resurrect as selections.
  assert.deepEqual([...evidence.submittedOptionIds({ optionId: 'B' })], []);
  assert.deepEqual([...evidence.submittedOptionIds({ optionIds: ['A', 7, '', null] })], ['A']);

  console.log('Choice grading verification passed.');
} finally { await server.close(); }
