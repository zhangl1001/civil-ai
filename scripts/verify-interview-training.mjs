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
  const [interview, executors, prompts, navigation] = await Promise.all([
    server.ssrLoadModule('/src/domain/interview.ts'),
    server.ssrLoadModule('/src/composition-root/agent/BusinessAgentInterviewExecutors.ts'),
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/features/planning/DailyPlanNavigation.ts')
  ]);

  const generated = [{
    id: 'interview_ai:test:1',
    type: '综合分析',
    text: '针对基层数字化治理中的形式主义问题，你怎么看？',
    hint: '回应问题、分析成因，并提出可执行的治理措施。'
  }];
  const excluded = new Set(['综合分析:0', '综合分析:1', '综合分析:2']);
  assert.deepEqual(
    interview.pickInterviewQuestions({
      selectedTypes: ['综合分析'],
      count: 1,
      excludedIds: excluded,
      generatedQuestions: generated,
      fallbackQuestions: [
        { id: '综合分析:0', type: '综合分析', text: '允许被排除的兜底题', hint: '兜底' }
      ],
      random: () => 0
    }),
    generated,
    'generated questions should be preferred when built-in fallback questions were recently used'
  );

  const [answer] = interview.prepareInterviewAnswers([{
    question: generated[0],
    answer: '先回应题意，再分析制度设计、基层执行和监督反馈三个层面的原因，最后提出精简流程、明确责任与持续评估的改进措施。',
    skipped: false,
    elapsedSeconds: 52
  }]);
  assert.equal(answer.completeness.status, 'substantive');
  assert.equal(Object.hasOwn(answer, 'score'), false, 'local answer heuristics must not create a formal score');

  assert.equal(typeof executors.interviewQuestionsExecutor, 'function');
  assert.equal(typeof executors.interviewReviewExecutor, 'function');
  assert.equal(prompts.BusinessTutorPromptCode.InterviewQuestions, 'content.generate.interview.questions');
  assert.equal(prompts.BusinessTutorPromptCode.InterviewReview, 'teaching.review.interview');

  const location = navigation.dailyPlanItemLocation(planItem(), 'interview');
  assert.equal(location.path, '/vue/interview');
  assert.equal(location.query.dailyPlanItemId, 'DailyPlanItemId:interview');

  console.log('Interview training verification passed.');
} finally {
  await server.close();
}

function planItem() {
  return {
    id: 'DailyPlanItemId:interview',
    dailyPlanId: 'DailyPlanId:interview',
    capabilityNodeId: 'capability:interview:content',
    itemType: 'independent_practice',
    sequence: 1,
    targetMinutes: 12,
    exitCriteria: {},
    reason: 'interview capability needs practice',
    status: 'pending',
    actualMinutes: 0
  };
}
