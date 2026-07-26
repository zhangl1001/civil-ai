import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const agent = await server.ssrLoadModule('/src/modules/agent/public.ts');
  const ai = await server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts');
  const toolActivity = await server.ssrLoadModule('/src/services/AgentToolActivityService.ts');
  const practiceLibraryTool = agent.tutorToolCatalog.find((tool) => tool.code === 'practice.read_library');
  const practiceQuestionSetTool = agent.tutorToolCatalog.find((tool) => tool.code === 'practice.read_question_set');
  assert.ok(practiceLibraryTool);
  assert.ok(practiceQuestionSetTool);
  assert.deepEqual(practiceLibraryTool.inputSchema.required, ['scope']);
  assert.equal(practiceLibraryTool.inputSchema.properties.scope.enum.includes('all'), true);
  assert.equal(practiceLibraryTool.description.includes('不读取题目正文'), true);
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.daily_coaching')
      .toolCodes.includes('practice.read_library'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.daily_coaching')
      .toolCodes.includes('practice.read_question_set'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.daily_coaching')
      .toolCodes.includes('learning.review_session'),
    true
  );
  const requests = [];
  const gateway = {
    provider: ai.ProviderCode.OpenAICompatible,
    model: 'test-model',
    async complete(request) {
      requests.push(request);
      if (requests.length === 1) {
        return {
          text: '',
          toolCalls: [{
            id: 'call-1',
            name: 'student_read_profile',
            arguments: {}
          }],
          usage: {}
        };
      }
      return { text: '今天先完成一组针对性练习。', usage: {} };
    }
  };
  const checkpoints = [];
  const events = [];
  const modelInvoker = {
    async invoke(invocation, selectedGateway, signal) {
      return selectedGateway.complete({
        ...invocation,
        requestId: `${invocation.agentRunId}:test`
      }, signal);
    }
  };
  const loop = new agent.RunAgentLoop(
    modelInvoker,
    {
      async evaluate() {
        return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' };
      }
    },
    {
      async execute() {
        return {
          content: JSON.stringify({ targetScore: 80, weakCapability: '削弱论证' }),
          resultRef: 'candidate-snapshot:current'
        };
      }
    },
    {
      async save(checkpoint) {
        checkpoints.push(checkpoint);
      }
    },
    {
      onEvent(event) {
        events.push(event);
      }
    }
  );
  const result = await loop.execute({
    agentRunId: 'agent-run-1',
    system: '你是个人公考 AI 私教。',
    messages: [{ role: ai.ModelMessageRole.User, content: '今天学什么？' }],
    tools: [agent.tutorToolCatalog[0]],
    executionContext: { agentRunId: 'agent-run-1' }
  }, gateway);
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '今天先完成一组针对性练习。');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].toolSchemaVersion, 'tutor-tools@2');
  assert.equal(requests[0].tools[0].name, 'student_read_profile');
  assert.equal(requests[0].tools.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.name)), true);
  assert.equal(requests[1].messages.at(-1).role, ai.ModelMessageRole.Tool);
  assert.equal(requests[1].messages.at(-1).toolCallId, 'call-1');
  assert.equal(checkpoints.at(-1).turnCount, 2);
  assert.equal(events.some((event) => event.type === 'tool_call_started'), true);
  assert.equal(events.some((event) => event.type === 'tool_call_succeeded'), true);

  const blankAfterToolRequests = [];
  const blankAfterToolLoop = new agent.RunAgentLoop(
    modelInvoker,
    {
      async evaluate() {
        return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' };
      }
    },
    {
      async execute() {
        return { content: '{"sets":[{"questionSetId":"set-1"}]}', resultRef: 'set-1' };
      }
    },
    { async save() {} }
  );
  const blankAfterToolResult = await blankAfterToolLoop.execute({
    agentRunId: 'agent-run-blank-after-tool',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '题库有题吗？' }],
    tools: [agent.tutorToolCatalog.find((tool) => tool.code === 'practice.read_library')],
    executionContext: { agentRunId: 'agent-run-blank-after-tool' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      blankAfterToolRequests.push(request);
      if (blankAfterToolRequests.length === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-library', name: 'practice_read_library', arguments: { scope: 'all' } }],
          usage: {}
        };
      }
      if (blankAfterToolRequests.length === 2) {
        return { text: '', usage: {} };
      }
      assert.equal(request.tools.length, 0);
      assert.equal(request.toolChoice, 'none');
      return { text: '我查到了，题库中已有 1 套题组。', usage: {} };
    }
  });
  assert.equal(blankAfterToolResult.status, 'completed');
  assert.equal(blankAfterToolResult.text, '我查到了，题库中已有 1 套题组。');
  assert.equal(blankAfterToolRequests.length, 3);

  const steeringRequests = [];
  let guidancePollCount = 0;
  const steeringLoop = new agent.RunAgentLoop(
    modelInvoker,
    {
      async evaluate() {
        return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' };
      }
    },
    {
      async execute() {
        throw new Error('Steering verification should not execute tools');
      }
    },
    { async save() {} }
  );
  const steeringResult = await steeringLoop.execute({
    agentRunId: 'agent-run-steering',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '生成一套练习' }],
    tools: [],
    executionContext: { agentRunId: 'agent-run-steering' },
    consumeGuidance() {
      guidancePollCount += 1;
      return guidancePollCount === 2
        ? [{ role: ai.ModelMessageRole.User, content: '改成 10 道资料分析题' }]
        : [];
    }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      steeringRequests.push(request);
      return {
        text: steeringRequests.length === 1 ? '正在准备练习。' : '已按引导调整为 10 道资料分析题。',
        usage: {}
      };
    }
  });
  assert.equal(steeringResult.status, 'completed');
  assert.equal(steeringRequests.length, 2);
  assert.equal(steeringRequests[1].messages.at(-1).content, '改成 10 道资料分析题');
  assert.equal(steeringResult.text, '已按引导调整为 10 道资料分析题。');

  toolActivity.agentToolActivityService.record({
    chatSessionId: 'session:1',
    agentRunId: 'agent-run-1',
    call: { id: 'call-1', name: 'student.read_profile', arguments: {} },
    label: '读取学习档案',
    status: 'completed'
  });
  toolActivity.agentToolActivityService.record({
    chatSessionId: 'session:1',
    agentRunId: 'agent-run-1',
    call: { id: 'call-2', name: 'file.read_text', arguments: { path: '导入资料/材料.txt' } },
    label: '读取导入文件',
    status: 'running'
  });
  assert.equal(toolActivity.agentToolActivityService.list('session:1').length, 2);
  assert.equal(toolActivity.agentToolActivityService.list('session:1')[0].toolCallId, 'call-2');
  toolActivity.agentToolActivityService.record({
    chatSessionId: 'session:1',
    agentRunId: 'agent-run-2',
    call: { id: 'call-3', name: 'generate_practice', arguments: { module: '判断推理' } },
    label: '生成专项练习',
    status: 'queued'
  });
  assert.equal(toolActivity.agentToolActivityService.list('session:1').length, 1);
  assert.equal(toolActivity.agentToolActivityService.list('session:1')[0].toolCallId, 'call-3');
  assert.equal(toolActivity.agentToolActivityService.list('session:other').length, 0);

  let confirmedExecutions = 0;
  const confirmationLoop = new agent.RunAgentLoop(
    modelInvoker,
    {
      async evaluate() {
        return { decision: agent.AgentToolPolicyDecision.Confirm, reasonCode: 'policy.user_confirmation_required' };
      }
    },
    {
      async execute() {
        confirmedExecutions += 1;
        return { content: '{"updated":true}', resultRef: 'score-target:aptitude' };
      }
    },
    { async save() {} }
  );
  const confirmation = await confirmationLoop.execute({
    agentRunId: 'agent-run-confirm',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '修改目标' }],
    tools: [agent.tutorToolCatalog.find((tool) => tool.code === 'candidate.change_target')],
    executionContext: { agentRunId: 'agent-run-confirm' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete() {
      return {
        text: '',
        toolCalls: [{ id: 'call-confirm', name: 'candidate_change_target', arguments: { targetScore: 90 } }],
        usage: {}
      };
    }
  });
  assert.equal(confirmation.status, 'waiting_user');
  assert.equal(confirmation.checkpoint.pendingConfirmation.id, 'call-confirm');
  assert.equal(confirmation.checkpoint.pendingConfirmation.name, 'candidate.change_target');
  assert.equal(confirmedExecutions, 0);
  const resumed = await confirmationLoop.execute({
    agentRunId: 'agent-run-confirm',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '修改目标' }],
    tools: [agent.tutorToolCatalog.find((tool) => tool.code === 'candidate.change_target')],
    executionContext: { agentRunId: 'agent-run-confirm' },
    checkpoint: confirmation.checkpoint,
    confirmationDecision: 'confirm'
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      const toolResult = request.messages.at(-1);
      assert.equal(toolResult.role, ai.ModelMessageRole.Tool);
      assert.equal(toolResult.toolCallId, 'call-confirm');
      return { text: '目标已按你的确认更新。', usage: {} };
    }
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.text, '目标已按你的确认更新。');
  assert.equal(confirmedExecutions, 1);
  assert.equal(resumed.checkpoint.pendingConfirmation, undefined);

  const budgeter = new agent.AgentContextBudgeter();
  const budgeted = budgeter.compile([
    { code: 'goal', content: '目标分 80', priority: 100, required: true, maxTokens: 64 },
    { code: 'history', content: '旧对话 '.repeat(1_000), priority: 10, required: false, maxTokens: 200 }
  ], 256);
  assert.deepEqual(budgeted.includedCodes, ['goal', 'history']);
  assert.match(budgeted.text, /context truncated/);

  const subAgents = new agent.SubAgentRegistry();
  subAgents.register({
    code: 'tutor.aptitude_specialist',
    description: '处理行测能力诊断和教学建议。',
    instructionRef: 'prompt.agent.aptitude@1',
    skillCodes: ['tutor.daily_coaching'],
    toolCodes: ['student.read_profile'],
    delegationMode: agent.AgentDelegationMode.AsTool,
    maxTurns: 4,
    maxToolCalls: 6
  });
  assert.equal(subAgents.get('tutor.aptitude_specialist').maxTurns, 4);

  console.log('Agent loop verification passed.');
} finally {
  await server.close();
}
