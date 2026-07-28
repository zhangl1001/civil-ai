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
  const chatCapabilities = await server.ssrLoadModule('/src/services/ChatAgentCapabilities.ts');
  const practiceLibraryTool = agent.tutorToolCatalog.find((tool) => tool.code === 'practice.read_library');
  const practiceQuestionSetTool = agent.tutorToolCatalog.find((tool) => tool.code === 'practice.read_question_set');
  assert.ok(practiceLibraryTool);
  assert.ok(practiceQuestionSetTool);
  assert.deepEqual(practiceLibraryTool.inputSchema.required, ['scope']);
  assert.equal(practiceLibraryTool.inputSchema.properties.scope.enum.includes('all'), true);
  assert.equal(practiceLibraryTool.description.includes('不读取题目正文'), true);
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.practice_library')
      .toolCodes.includes('practice.read_library'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.practice_library')
      .toolCodes.includes('practice.read_question_set'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.code === 'tutor.practice_library')
      .toolCodes.includes('learning.review_session'),
    true
  );
  const companionExposure = chatCapabilities.planChatAgentCapabilities();
  assert.equal(companionExposure.skills.length, 0);
  assert.deepEqual(
    companionExposure.tools.map((tool) => tool.code),
    ['agent.select_skills'],
    'ordinary chat exposes only the catalog selector, never business tools'
  );
  const dailyExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['tutor.daily_coaching']
  });
  assert.deepEqual(dailyExposure.skillCodes, ['tutor.daily_coaching']);
  assert.deepEqual(dailyExposure.tools.map((tool) => tool.code), [
    'agent.select_skills',
    'tutor.read_daily_context',
    'planning.propose_daily_plan',
    'teaching.request_practice'
  ]);
  const libraryExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['tutor.practice_library']
  });
  assert.deepEqual(libraryExposure.skillCodes, ['tutor.practice_library']);
  assert.deepEqual(libraryExposure.tools.map((tool) => tool.code), [
    'agent.select_skills',
    'practice.read_library',
    'practice.read_question_set',
    'learning.review_session'
  ]);
  const essayExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['tutor.essay_workflow']
  });
  assert.deepEqual(essayExposure.skillCodes, ['tutor.essay_workflow']);
  assert.deepEqual(essayExposure.tools.map((tool) => tool.code), ['agent.select_skills', 'generate_essay', 'grade_essay']);
  const hotspotExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['research.current_affairs']
  });
  assert.deepEqual(hotspotExposure.skillCodes, ['research.current_affairs']);
  assert.deepEqual(hotspotExposure.tools.map((tool) => tool.code), ['agent.select_skills', 'web.search', 'web.read_page']);
  const digestExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['research.current_affairs', 'tutor.digest_generation']
  });
  assert.deepEqual(digestExposure.skillCodes, ['research.current_affairs', 'tutor.digest_generation']);
  assert.deepEqual(digestExposure.tools.map((tool) => tool.code), [
    'agent.select_skills',
    'web.search',
    'web.read_page',
    'generate_digest',
    'generate_monthly_digest'
  ]);
  const trueQuestionExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['research.true_questions']
  });
  assert.deepEqual(trueQuestionExposure.skillCodes, ['research.true_questions']);
  assert.deepEqual(trueQuestionExposure.tools.map((tool) => tool.code), [
    'agent.select_skills',
    'web.search',
    'web.read_page',
    'question_bank.scan',
    'question_bank.resume',
    'question_bank.confirm',
    'question_bank.publish'
  ]);
  const syllabusExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillCodes: ['research.exam_syllabus']
  });
  assert.deepEqual(syllabusExposure.skillCodes, ['research.exam_syllabus']);
  assert.deepEqual(syllabusExposure.tools.map((tool) => tool.code), ['agent.select_skills', 'web.search', 'web.read_page']);
  const pendingImportExposure = chatCapabilities.planChatAgentCapabilities({ pendingToolCode: 'question_bank.confirm' });
  assert.deepEqual(pendingImportExposure.skillCodes, ['tutor.question_bank_ingestion']);
  assert.equal(pendingImportExposure.tools.some((tool) => tool.code === 'question_bank.publish'), true);
  assert.equal(
    agent.tutorToolCatalog.find((tool) => tool.code === 'question_bank.publish').requiresConfirmation,
    true,
    'publishing a confirmed question-bank draft requires a second explicit confirmation'
  );
  const composedSystem = chatCapabilities.chatAgentSystemPromptComposer.compose({
    basePrompt: '你是个人公考 AI 私教。',
    exposure: dailyExposure,
    capabilityCatalog: dailyExposure.capabilityCatalog
  });
  assert.match(composedSystem, /可发现能力摘要/);
  assert.match(composedSystem, /agent\.select_skills/);
  assert.match(composedSystem, /当前按需能力/);
  assert.match(composedSystem, /基于今日计划、能力证据和到期复习安排下一步学习/);
  assert.match(composedSystem, /不得只回复“正在导入”后结束/);
  assert.doesNotMatch(composedSystem, /\"scope\"|\"entryMode\"/);

  const extensionRegistry = new agent.AgentToolRegistry();
  extensionRegistry.registerBundle({
    tools: [{
      code: 'research.search',
      description: '检索少量外部来源。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      risk: agent.AgentToolRisk.Read,
      requiresConfirmation: false,
      enabledFor: ['tutor_turn']
    }],
    skills: [{
      code: 'research.exam',
      description: '研究考试公开资料。',
      toolCodes: ['research.search'],
      contextBudgetTokens: 300
    }]
  });
  const extensionPlan = new agent.ToolExposurePlanner(extensionRegistry).plan(
    ['research.exam'],
    'tutor_turn'
  );
  assert.deepEqual(extensionPlan.tools.map((tool) => tool.code), ['research.search']);
  assert.throws(() => extensionRegistry.registerBundle({
    tools: [{
      code: 'research.search',
      description: '重复工具。',
      inputSchema: { type: 'object', properties: {} },
      risk: agent.AgentToolRisk.Read,
      requiresConfirmation: false,
      enabledFor: ['tutor_turn']
    }],
    skills: []
  }), /Duplicate agent tool/);
  assert.deepEqual(
    extensionRegistry.resolve(['research.exam'], 'tutor_turn').tools.map((tool) => tool.code),
    ['research.search'],
    'a rejected capability bundle must not corrupt the existing registry'
  );
  assert.throws(() => extensionRegistry.registerBundle({
    tools: [{
      code: 'research.read_page',
      description: '读取单个页面。',
      inputSchema: { type: 'object', properties: {} },
      risk: agent.AgentToolRisk.Read,
      requiresConfirmation: false,
      enabledFor: ['tutor_turn']
    }],
    skills: [{
      code: 'research.invalid_bundle',
      description: '无效扩展包。',
      toolCodes: ['research.missing_tool'],
      contextBudgetTokens: 300
    }]
  }), /unknown tool/);
  assert.throws(
    () => extensionRegistry.resolve(['research.invalid_bundle'], 'tutor_turn'),
    /Unknown agent skill/,
    'an invalid capability bundle must be rejected atomically'
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
    messages: [{
      role: ai.ModelMessageRole.User,
      content: [
        { type: 'text', text: '今天学什么？' },
        { type: 'image', mediaType: 'image/jpeg', dataBase64: 'ephemeral-image-data', attachmentId: 'image-1' }
      ]
    }],
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
  assert.equal(typeof checkpoints.at(-1).messages[0].content, 'string');
  assert.equal(JSON.stringify(checkpoints.at(-1)).includes('ephemeral-image-data'), false);
  assert.equal(events.some((event) => event.type === 'tool_call_started'), true);
  assert.equal(events.some((event) => event.type === 'tool_call_succeeded'), true);

  const selectorTool = companionExposure.tools[0];
  const dynamicRequests = [];
  const dynamicExecutions = [];
  const dynamicLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute(definition) {
        dynamicExecutions.push(definition.code);
        if (definition.code === 'agent.select_skills') {
          return {
            content: '{"selectedSkills":["tutor.practice_library"]}',
            activateToolCodes: ['practice.read_library', 'practice.read_question_set', 'learning.review_session']
          };
        }
        assert.equal(definition.code, 'practice.read_library');
        return { content: '{"sets":[{"questionSetId":"set-1"}]}' };
      }
    },
    { async save() {} }
  );
  const dynamicResult = await dynamicLoop.execute({
    agentRunId: 'agent-run-dynamic-tool-selection',
    system: 'system with compact skill summaries',
    messages: [{ role: ai.ModelMessageRole.User, content: '题库里现在有几套题组？' }],
    tools: [selectorTool],
    availableTools: companionExposure.availableTools,
    executionContext: { agentRunId: 'agent-run-dynamic-tool-selection' }
  }, {
    provider: ai.ProviderCode.OpenAICompatible,
    model: 'test-model',
    async complete(request) {
      dynamicRequests.push(request);
      if (dynamicRequests.length === 1) {
        assert.deepEqual(request.tools.map((tool) => tool.name), ['agent_select_skills']);
        return {
          text: '',
          toolCalls: [{
            id: 'select-library-skill',
            name: 'agent_select_skills',
            arguments: { skillCodes: ['tutor.practice_library'] }
          }],
          usage: {}
        };
      }
      if (dynamicRequests.length === 2) {
        assert.equal(request.tools.some((tool) => tool.name === 'practice_read_library'), true);
        return {
          text: '',
          toolCalls: [{ id: 'read-library', name: 'practice_read_library', arguments: { scope: 'all' } }],
          usage: {}
        };
      }
      return { text: '当前题库有 1 套题组。', usage: {} };
    }
  });
  assert.equal(dynamicResult.text, '当前题库有 1 套题组。');
  assert.deepEqual(dynamicExecutions, ['agent.select_skills', 'practice.read_library']);
  assert.equal(dynamicRequests.length, 3);

  const requiredToolRequests = [];
  const requiredToolEvents = [];
  let requiredToolExecutions = 0;
  const scanTool = agent.tutorToolCatalog.find((tool) => tool.code === 'question_bank.scan');
  const importPrompt = '请扫描并导入真题。';
  const requiredToolLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.write_allowed' }; } },
    {
      async execute(definition) {
        assert.equal(definition.code, 'question_bank.scan');
        requiredToolExecutions += 1;
        return { content: '{"draftId":"draft-1","totalCount":5}', resultRef: 'draft-1' };
      }
    },
    { async save() {} },
    { onEvent(event) { requiredToolEvents.push(event); } }
  );
  const requiredToolResult = await requiredToolLoop.execute({
    agentRunId: 'agent-run-required-scan',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: importPrompt }],
    tools: [scanTool],
    requiredToolCode: 'question_bank.scan',
    forceRequiredToolOnFirstTurn: true,
    executionContext: { agentRunId: 'agent-run-required-scan' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      requiredToolRequests.push(request);
      if (requiredToolRequests.length === 1) {
        assert.deepEqual(request.toolChoice, { name: 'question_bank_scan' });
        return { text: '我现在正式调用 question_bank.scan，正在导入。', usage: {} };
      }
      if (requiredToolRequests.length === 2) {
        assert.deepEqual(request.toolChoice, { name: 'question_bank_scan' });
        return {
          text: '',
          toolCalls: [{ id: 'scan-call-1', name: 'question_bank_scan', arguments: {} }],
          usage: {}
        };
      }
      return { text: '已生成 5 道题的待确认扫描草稿。', usage: {} };
    }
  });
  assert.equal(requiredToolResult.status, 'completed');
  assert.equal(requiredToolResult.text, '已生成 5 道题的待确认扫描草稿。');
  assert.equal(requiredToolExecutions, 1);
  assert.equal(requiredToolRequests.length, 3);
  assert.equal(requiredToolEvents.filter((event) => event.type === 'tool_call_started').length, 1);
  assert.equal(
    requiredToolEvents.some((event) => event.type === 'text_delta' && event.text.includes('question_bank.scan')),
    false,
    'unbacked operational narration must never be streamed to the user'
  );

  let terminalModelCalls = 0;
  const terminalToolLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute() {
        return {
          content: '{"found":false}',
          terminalText: '没有可继续的导入草稿，请重新上传原文件。'
        };
      }
    },
    { async save() {} }
  );
  const terminalToolResult = await terminalToolLoop.execute({
    agentRunId: 'agent-run-import-resume-missing',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '重新录入吧' }],
    tools: [agent.tutorToolCatalog.find((tool) => tool.code === 'question_bank.resume')],
    requiredToolCode: 'question_bank.resume',
    forceRequiredToolOnFirstTurn: true,
    executionContext: { agentRunId: 'agent-run-import-resume-missing' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete() {
      terminalModelCalls += 1;
      return {
        text: '我会继续处理。',
        toolCalls: [{ id: 'resume-missing', name: 'question_bank_resume', arguments: {} }],
        usage: {}
      };
    }
  });
  assert.equal(terminalToolResult.text, '没有可继续的导入草稿，请重新上传原文件。');
  assert.equal(terminalModelCalls, 1, 'a terminal tool response must not re-enter the model');

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

  const mixedExecutions = [];
  const mixedLoop = new agent.RunAgentLoop(
    modelInvoker,
    {
      async evaluate(definition) {
        return definition.code === 'candidate.change_target'
          ? { decision: agent.AgentToolPolicyDecision.Confirm, reasonCode: 'policy.user_confirmation_required' }
          : { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' };
      }
    },
    {
      async execute(definition) {
        mixedExecutions.push(definition.code);
        return { content: JSON.stringify({ ok: true }) };
      }
    },
    { async save() {} }
  );
  const mixedTools = [
    agent.tutorToolCatalog.find((tool) => tool.code === 'student.read_profile'),
    agent.tutorToolCatalog.find((tool) => tool.code === 'candidate.change_target')
  ];
  const mixedWaiting = await mixedLoop.execute({
    agentRunId: 'agent-run-mixed-confirm',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '先查看档案，再把目标改为 90 分' }],
    tools: mixedTools,
    executionContext: { agentRunId: 'agent-run-mixed-confirm' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete() {
      return {
        text: '',
        toolCalls: [
          { id: 'call-read-before-confirm', name: 'student_read_profile', arguments: {} },
          { id: 'call-write-confirm', name: 'candidate_change_target', arguments: { subject: 'aptitude', targetScore: 90 } }
        ],
        usage: {}
      };
    }
  });
  assert.equal(mixedWaiting.status, 'waiting_user');
  assert.deepEqual(mixedExecutions, [], 'tools preceding a confirmation must not execute out of order');
  assert.equal(
    mixedWaiting.checkpoint.messages.some((message) => (
      message.role === ai.ModelMessageRole.Tool && message.toolCallId === 'call-read-before-confirm'
    )),
    true,
    'every deferred sibling tool call must receive a protocol result'
  );
  const mixedResumed = await mixedLoop.execute({
    agentRunId: 'agent-run-mixed-confirm',
    system: 'system',
    messages: [],
    tools: mixedTools,
    executionContext: { agentRunId: 'agent-run-mixed-confirm' },
    checkpoint: mixedWaiting.checkpoint,
    confirmationDecision: 'confirm'
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      const resultIds = request.messages
        .filter((message) => message.role === ai.ModelMessageRole.Tool)
        .map((message) => message.toolCallId);
      assert.deepEqual(resultIds, ['call-read-before-confirm', 'call-write-confirm']);
      return { text: '目标已更新。', usage: {} };
    }
  });
  assert.equal(mixedResumed.status, 'completed');
  assert.deepEqual(mixedExecutions, ['candidate.change_target']);

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
