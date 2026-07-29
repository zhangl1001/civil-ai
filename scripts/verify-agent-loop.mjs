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
  const externalTools = await server.ssrLoadModule('/src/modules/agent/fixtures/AgentExternalToolCatalog.ts');
  const responsePresentation = await server.ssrLoadModule('/src/services/AgentResponsePresentation.ts');
  assert.equal(
    responsePresentation.visibleAssistantText('`web.search` 和 research.true_questions 暂时不可用'),
    '`联网搜索` 和 真题检索流程 暂时不可用'
  );
  const practiceLibraryTool = agent.tutorToolCatalog.find((tool) => tool.name === 'practice.read_library');
  const practiceQuestionSetTool = agent.tutorToolCatalog.find((tool) => tool.name === 'practice.read_question_set');
  assert.ok(practiceLibraryTool);
  assert.ok(practiceQuestionSetTool);
  assert.deepEqual(practiceLibraryTool.inputSchema.required, ['scope']);
  assert.equal(practiceLibraryTool.inputSchema.properties.scope.enum.includes('all'), true);
  assert.equal(practiceLibraryTool.description.includes('不读取题目正文'), true);
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.name === 'tutor.practice_library')
      .allowedTools.includes('practice.read_library'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.name === 'tutor.practice_library')
      .allowedTools.includes('practice.read_question_set'),
    true
  );
  assert.equal(
    agent.tutorSkillCatalog.find((skill) => skill.name === 'tutor.practice_library')
      .allowedTools.includes('learning.review_session'),
    true
  );
  const companionExposure = chatCapabilities.planChatAgentCapabilities();
  const baseToolNames = [
    'system.read_clock',
    'student.read_profile',
    'tutor.read_daily_context',
    'workspace.discover',
    'task.read_status'
  ];
  assert.equal(companionExposure.skills.length, 0);
  assert.deepEqual(
    companionExposure.tools.map((tool) => tool.name),
    ['agent.select_skills', ...baseToolNames],
    'ordinary chat exposes bounded read-only grounding tools and the Skill selector'
  );
  const dailyExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['tutor.daily_coaching']
  });
  assert.deepEqual(dailyExposure.skillNames, ['tutor.daily_coaching']);
  assert.deepEqual(dailyExposure.tools.map((tool) => tool.name), [
    'agent.select_skills',
    ...baseToolNames,
    'planning.propose_daily_plan',
    'teaching.request_practice'
  ]);
  const libraryExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['tutor.practice_library']
  });
  assert.deepEqual(libraryExposure.skillNames, ['tutor.practice_library']);
  assert.deepEqual(libraryExposure.tools.map((tool) => tool.name), [
    'agent.select_skills',
    ...baseToolNames,
    'practice.read_library',
    'practice.read_question_set',
    'learning.review_session'
  ]);
  const essayExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['tutor.essay_workflow']
  });
  assert.deepEqual(essayExposure.skillNames, ['tutor.essay_workflow']);
  assert.deepEqual(essayExposure.tools.map((tool) => tool.name), [
    'agent.select_skills',
    ...baseToolNames,
    'generate_essay',
    'grade_essay'
  ]);
  const hotspotExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['research.current_affairs']
  });
  assert.deepEqual(hotspotExposure.skillNames, ['research.current_affairs']);
  assert.deepEqual(hotspotExposure.tools.map((tool) => tool.name), ['agent.select_skills', ...baseToolNames, 'web.search', 'web.read_page']);
  const digestExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['research.current_affairs', 'tutor.digest_generation']
  });
  assert.deepEqual(digestExposure.skillNames, ['research.current_affairs', 'tutor.digest_generation']);
  assert.deepEqual(digestExposure.tools.map((tool) => tool.name), [
    'agent.select_skills',
    ...baseToolNames,
    'web.search',
    'web.read_page',
    'generate_digest',
    'generate_monthly_digest'
  ]);
  const trueQuestionExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['research.true_questions']
  });
  assert.deepEqual(trueQuestionExposure.skillNames, ['research.true_questions']);
  assert.deepEqual(trueQuestionExposure.tools.map((tool) => tool.name), [
    'agent.select_skills',
    ...baseToolNames,
    'research_true_questions'
  ]);
  assert.equal(
    trueQuestionExposure.tools.some((tool) => tool.name === 'web.search' || tool.name === 'question_bank.scan'),
    false,
    'chat only dispatches durable research work; the independent Agent owns research tools'
  );
  const syllabusExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['research.exam_syllabus']
  });
  assert.deepEqual(syllabusExposure.skillNames, ['research.exam_syllabus']);
  assert.deepEqual(syllabusExposure.tools.map((tool) => tool.name), ['agent.select_skills', ...baseToolNames, 'web.search', 'web.read_page']);
  const pendingImportExposure = chatCapabilities.planChatAgentCapabilities({ pendingToolName: 'question_bank.confirm' });
  assert.deepEqual(pendingImportExposure.skillNames, ['tutor.question_bank_ingestion']);
  assert.equal(pendingImportExposure.tools.some((tool) => tool.name === 'question_bank.publish'), true);
  assert.equal(
    agent.tutorToolCatalog.find((tool) => tool.name === 'question_bank.publish').requiresConfirmation,
    true,
    'publishing a confirmed question-bank draft requires a second explicit confirmation'
  );
  const memoryExposure = chatCapabilities.planChatAgentCapabilities({
    preselectedSkillNames: ['tutor.personal_memory']
  });
  assert.deepEqual(memoryExposure.skillNames, ['tutor.personal_memory']);
  assert.deepEqual(
    memoryExposure.tools.map((tool) => tool.name),
    ['agent.select_skills', ...baseToolNames, 'memory.remember', 'memory.forget']
  );
  assert.equal(
    memoryExposure.skillCatalog.find((skill) => skill.name === 'tutor.personal_memory').description.includes('明确要求'),
    true
  );
  const composedSystem = chatCapabilities.chatAgentSystemPromptComposer.compose({
    basePrompt: '你是个人公考 AI 私教。',
    skillCatalog: dailyExposure.skillCatalog
  });
  assert.match(composedSystem, /可发现 Skill 摘要/);
  assert.match(composedSystem, /# 自主决策/);
  assert.match(composedSystem, /由你根据当前目标和每轮结果自主决定/);
  assert.match(composedSystem, /tutor\.daily_coaching/);
  assert.doesNotMatch(composedSystem, /Recommended workflow:|Completion checks|Suggested recovery/);
  assert.doesNotMatch(composedSystem, /\"scope\"|\"entryMode\"/);
  assert.doesNotMatch(
    composedSystem,
    /(?:你好|任务|题库|真题|热点).*(?:tutor\.|research\.)/,
    'the discovery prompt must not route natural-language keywords to fixed skills'
  );

  let budgetNow = 0;
  const adaptiveBudget = new agent.AgentExecutionBudget({
    maxTurns: 32,
    maxToolCalls: 64,
    maxWallTimeMs: 900_000
  }, [], () => budgetNow);
  assert.equal(adaptiveBudget.allowNextTurn(7, 0).allowed, true);
  assert.equal(adaptiveBudget.allowNextTurn(8, 0).reasonCode, 'agent.no_progress_budget_exhausted');
  adaptiveBudget.recordProgress();
  assert.equal(adaptiveBudget.allowNextTurn(8, 0).allowed, true, 'new evidence expands the compact soft budget');
  adaptiveBudget.activate([agent.AgentExecutionBudgetTier.Research]);
  budgetNow = 480_001;
  assert.equal(adaptiveBudget.allowNextTurn(8, 0).reasonCode, 'agent.no_progress_budget_exhausted');
  adaptiveBudget.recordProgress();
  assert.equal(adaptiveBudget.allowNextTurn(8, 0).allowed, true, 'progress also expands the wall-clock budget');
  budgetNow = 720_000;
  assert.equal(adaptiveBudget.allowNextTurn(8, 0).reasonCode, 'agent.time_hard_limit');

  const extensionToolRegistry = new agent.AgentToolRegistry();
  extensionToolRegistry.register({
    name: 'research.search',
    description: '检索少量外部来源。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    risk: agent.AgentToolRisk.Read,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  });
  const extensionSkillRegistry = new agent.AgentSkillRegistry(extensionToolRegistry);
  extensionSkillRegistry.register({
    name: 'research.exam',
    version: '1.0.0',
    description: '研究考试公开资料。',
    dependencies: [],
    conflicts: [],
    workflow: {
      name: '考试研究',
      description: '检索并核实考试资料。',
      steps: [{ name: '检索', description: '调用检索工具获取最小必要证据。' }],
      completionCriteria: ['已获得可靠来源或明确说明缺少来源。'],
      failureRecovery: ['检索失败时缩小范围。']
    },
    promptChapters: [{ name: 'source', title: '来源', content: '优先官方来源。' }],
    resources: [],
    allowedTools: ['research.search'],
    validators: [{ name: 'source.required', description: '事实结论必须有来源。' }],
    contextBudgetTokens: 300,
    executionBudget: agent.AgentExecutionBudgetTier.Research
  });
  const extensionCompiler = new agent.AgentSkillBundleCompiler(extensionSkillRegistry, extensionToolRegistry);
  const extensionPlan = extensionCompiler.compile(
    ['research.exam'],
    'tutor_turn'
  );
  assert.deepEqual(extensionPlan.tools.map((tool) => tool.name), ['research.search']);
  assert.match(extensionPlan.activations[0].instructions, /Recommended workflow: 考试研究/);
  assert.match(extensionPlan.activations[0].instructions, /不是不可变脚本/);
  assert.throws(() => extensionToolRegistry.register({
      name: 'research.search',
      description: '重复工具。',
      inputSchema: { type: 'object', properties: {} },
      risk: agent.AgentToolRisk.Read,
      requiresConfirmation: false,
      enabledFor: ['tutor_turn']
  }), /Duplicate agent tool/);
  assert.deepEqual(
    extensionCompiler.compile(['research.exam'], 'tutor_turn').tools.map((tool) => tool.name),
    ['research.search'],
    'a rejected tool must not corrupt the existing registries'
  );
  assert.throws(() => extensionSkillRegistry.register({
      name: 'research.invalid_bundle',
      version: '1.0.0',
      description: '无效扩展包。',
      dependencies: [],
      conflicts: [],
      workflow: {
        name: '无效流程',
        description: '用于校验。',
        steps: [{ name: '执行', description: '调用不存在的工具。' }],
        completionCriteria: ['完成。'],
        failureRecovery: []
      },
      promptChapters: [],
      resources: [],
      allowedTools: ['research.missing_tool'],
      validators: [],
      contextBudgetTokens: 300,
      executionBudget: agent.AgentExecutionBudgetTier.Standard
  }), /unknown tool/i);
  assert.throws(
    () => extensionSkillRegistry.resolve(['research.invalid_bundle']),
    /Unknown agent skill/,
    'an invalid skill must be rejected atomically'
  );
  let directConversationTurns = 0;
  const directConversationLoop = new agent.RunAgentLoop(
    {
      async invoke(request, provider, signal) {
        return provider.complete(request, signal);
      }
    },
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    { async execute() { throw new Error('ordinary conversation must not execute a tool'); } },
    { async save() {} }
  );
  const directConversationResult = await directConversationLoop.execute({
    agentRunId: 'agent-run-direct-conversation',
    system: composedSystem,
    messages: [{ role: ai.ModelMessageRole.User, content: '今天有点累，陪我聊两句。' }],
    tools: companionExposure.tools,
    availableTools: companionExposure.availableTools,
    executionContext: { agentRunId: 'agent-run-direct-conversation' }
  }, {
    provider: ai.ProviderCode.OpenAICompatible,
    model: 'test-model',
    async complete(request) {
      directConversationTurns += 1;
      assert.equal(request.toolChoice, 'auto', 'free chat must leave the tool decision to the model');
      assert.deepEqual(request.tools.map((tool) => tool.name), [
        'agent_select_skills',
        'system_read_clock',
        'student_read_profile',
        'tutor_read_daily_context',
        'workspace_discover',
        'task_read_status'
      ]);
      return { text: '先缓一缓，我们把下一步缩小到一件事。', usage: {} };
    }
  });
  assert.equal(directConversationTurns, 1);
  assert.equal(directConversationResult.text, '先缓一缓，我们把下一步缩小到一件事。');

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

  let adaptiveTurn = 0;
  const adaptiveLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    { async execute() { return { content: JSON.stringify({ evidence: adaptiveTurn }) }; } },
    { async save() {} }
  );
  const adaptiveResult = await adaptiveLoop.execute({
    agentRunId: 'agent-run-adaptive-budget',
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '持续检索直到证据充分。' }],
    tools: [practiceLibraryTool],
    executionContext: { agentRunId: 'agent-run-adaptive-budget' }
  }, {
    provider: ai.ProviderCode.OpenAICompatible,
    model: 'test-model',
    async complete() {
      adaptiveTurn += 1;
      return adaptiveTurn <= 9
        ? {
            text: '',
            toolCalls: [{
              id: `adaptive-call-${adaptiveTurn}`,
              name: 'practice_read_library',
              arguments: { scope: 'all', createdFrom: `2026-07-${String(adaptiveTurn).padStart(2, '0')}` }
            }],
            usage: {}
          }
        : { text: '证据已充分。', usage: {} };
    }
  });
  assert.equal(adaptiveResult.status, 'completed');
  assert.equal(adaptiveTurn, 10, 'a progressing run may continue beyond the compact eight-turn soft budget');

  const selectorTool = companionExposure.tools[0];
  const practiceLibraryBundle = chatCapabilities.compileChatAgentSkills(['tutor.practice_library']);
  const dynamicRequests = [];
  const dynamicExecutions = [];
  const dynamicCheckpoints = [];
  const dynamicLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute(definition) {
        dynamicExecutions.push(definition.name);
        if (definition.name === 'agent.select_skills') {
          return {
            content: '{"selectedSkills":["tutor.practice_library"]}',
            activateToolNames: practiceLibraryBundle.tools.map((tool) => tool.name),
            activateSkills: practiceLibraryBundle.activations
          };
        }
        assert.equal(definition.name, 'practice.read_library');
        return { content: '{"sets":[{"questionSetId":"set-1"}]}' };
      }
    },
    { async save(checkpoint) { dynamicCheckpoints.push(checkpoint); } }
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
        assert.equal(request.toolChoice, 'auto', 'the model autonomously chooses whether to load a skill');
        assert.doesNotMatch(request.system, /# 当前已加载 Skill 工作流/);
        return {
          text: '',
          toolCalls: [{
            id: 'select-library-skill',
            name: 'agent_select_skills',
            arguments: { skillNames: ['tutor.practice_library'] }
          }],
          usage: {}
        };
      }
      if (dynamicRequests.length === 2) {
        assert.match(request.system, /# 当前已加载 Skill 工作流/);
        assert.match(request.system, /# Skill: tutor\.practice_library@/);
        assert.match(request.system, /Completion checks/);
        assert.equal(request.tools.some((tool) => tool.name === 'practice_read_library'), true);
        return { text: '我已经加载题库工作流，接下来读取题库。', usage: {} };
      }
      if (dynamicRequests.length === 3) {
        assert.match(request.messages.at(-1).content, /必须实际调用工具/);
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
  assert.equal(dynamicRequests.length, 4);
  assert.deepEqual(dynamicCheckpoints.at(-1).activeToolNames.sort(), [
    'agent.select_skills',
    'learning.review_session',
    'practice.read_library',
    'practice.read_question_set',
    'workspace.discover'
  ]);
  assert.deepEqual(dynamicCheckpoints.at(-1).activeSkills.map((skill) => skill.name), ['tutor.practice_library']);
  assert.equal(dynamicCheckpoints.at(-1).skillWorkflowState, 'ready_to_finalize');

  const adaptiveSearchQueries = [];
  let adaptiveSearchTurn = 0;
  const adaptiveSearchLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute(_definition, call) {
        adaptiveSearchQueries.push(call.arguments.query);
        return adaptiveSearchQueries.length === 1
          ? {
              content: '{"results":[],"hint":"query_too_broad"}',
              madeProgress: false
            }
          : {
              content: '{"results":[{"title":"2025年江苏行测真题","url":"https://example.test/paper"}]}',
              madeProgress: true
            };
      }
    },
    { async save() {} }
  );
  const adaptiveSearchResult = await adaptiveSearchLoop.execute({
    agentRunId: 'agent-run-adaptive-search',
    system: '工具结果不足时调整策略后继续。',
    messages: [{ role: ai.ModelMessageRole.User, content: '查找近3年江苏行测真题' }],
    tools: [externalTools.agentExternalToolCatalog[0]],
    executionContext: { agentRunId: 'agent-run-adaptive-search' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      adaptiveSearchTurn += 1;
      if (adaptiveSearchTurn === 1) {
        return { text: '', toolCalls: [{ id: 'search-broad', name: 'web_search', arguments: { query: '公考真题', purpose: 'true_question' } }], usage: {} };
      }
      if (adaptiveSearchTurn === 2) {
        assert.match(String(request.messages.at(-1).content), /status: no_progress/);
        assert.match(String(request.messages.at(-1).content), /调整参数、范围、工具或步骤/);
        return { text: '', toolCalls: [{ id: 'search-narrow', name: 'web_search', arguments: { query: '2023 2024 2025 江苏省考 行测 真题', purpose: 'true_question' } }], usage: {} };
      }
      return { text: '已调整搜索策略并找到可核验的真题候选。', usage: {} };
    }
  });
  assert.deepEqual(adaptiveSearchQueries, ['公考真题', '2023 2024 2025 江苏省考 行测 真题']);
  assert.equal(adaptiveSearchResult.text, '已调整搜索策略并找到可核验的真题候选。');

  let recoverableFailureExecutions = 0;
  let recoverableFailureTurns = 0;
  const recoverableFailureLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute() {
        recoverableFailureExecutions += 1;
        return recoverableFailureExecutions === 1
          ? {
              content: '搜索服务连接被临时重置。',
              isError: true,
              retryable: true,
              failureCode: 'web.transient'
            }
          : {
              content: '{"results":[{"title":"江苏省考公告","url":"https://example.test/notice"}]}',
              madeProgress: true
            };
      }
    },
    { async save() {} }
  );
  const recoverableFailureResult = await recoverableFailureLoop.execute({
    agentRunId: 'agent-run-recoverable-tool-failure',
    system: '观察失败后自主决定是否重试或调整策略。',
    messages: [{ role: ai.ModelMessageRole.User, content: '查询江苏省考公告。' }],
    tools: [externalTools.agentExternalToolCatalog[0]],
    executionContext: { agentRunId: 'agent-run-recoverable-tool-failure' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      recoverableFailureTurns += 1;
      if (recoverableFailureTurns === 1) {
        return {
          text: '',
          toolCalls: [{
            id: 'transient-search-1',
            name: 'web_search',
            arguments: { query: '江苏省考 公告', purpose: 'exam_notice' }
          }],
          usage: {}
        };
      }
      if (recoverableFailureTurns === 2) {
        const observation = String(request.messages.at(-1).content);
        assert.match(observation, /status: failed/);
        assert.match(observation, /retryable: true/);
        assert.match(observation, /failure_code: web\.transient/);
        return {
          text: '',
          toolCalls: [{
            id: 'transient-search-2',
            name: 'web_search',
            arguments: { query: '江苏省考 公告', purpose: 'exam_notice' }
          }],
          usage: {}
        };
      }
      return { text: '临时故障恢复后已查到江苏省考公告。', usage: {} };
    }
  });
  assert.equal(recoverableFailureExecutions, 2, 'a recoverable failure may retry the same call once');
  assert.equal(recoverableFailureTurns, 3);
  assert.equal(recoverableFailureResult.text, '临时故障恢复后已查到江苏省考公告。');

  let strategyChangeExecutions = 0;
  let strategyChangeTurns = 0;
  const strategyChangeLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' }; } },
    {
      async execute(_definition, call) {
        strategyChangeExecutions += 1;
        return call.arguments.query === '江苏 真题'
          ? {
              content: '{"results":[]}',
              madeProgress: false
            }
          : {
              content: '{"results":[{"title":"2025江苏省考行测真题","url":"https://example.test/paper"}]}',
              madeProgress: true
            };
      }
    },
    { async save() {} }
  );
  const strategyChangeResult = await strategyChangeLoop.execute({
    agentRunId: 'agent-run-tool-strategy-change',
    system: '连续无进展时改变检索策略。',
    messages: [{ role: ai.ModelMessageRole.User, content: '找江苏省考真题。' }],
    tools: [externalTools.agentExternalToolCatalog[0]],
    executionContext: { agentRunId: 'agent-run-tool-strategy-change' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      strategyChangeTurns += 1;
      if (strategyChangeTurns <= 3) {
        return {
          text: '',
          toolCalls: [{
            id: `same-empty-search-${strategyChangeTurns}`,
            name: 'web_search',
            arguments: { query: '江苏 真题', purpose: 'true_question' }
          }],
          usage: {}
        };
      }
      if (strategyChangeTurns === 4) {
        assert.match(String(request.messages.at(-1).content), /停止机械重复/);
        return {
          text: '',
          toolCalls: [{
            id: 'changed-search',
            name: 'web_search',
            arguments: { query: '2025 江苏省考 行测 真题 PDF', purpose: 'true_question' }
          }],
          usage: {}
        };
      }
      return { text: '调整检索条件后找到了真题候选。', usage: {} };
    }
  });
  assert.equal(strategyChangeExecutions, 3, 'the third identical no-progress call must be blocked before execution');
  assert.equal(strategyChangeTurns, 5);
  assert.equal(strategyChangeResult.text, '调整检索条件后找到了真题候选。');

  const digestBundle = chatCapabilities.compileChatAgentSkills(['tutor.digest_generation']);
  const completionVerificationRequests = [];
  const completionVerificationExecutions = [];
  const completionVerificationCheckpoints = [];
  const completionVerificationLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.allowed' }; } },
    {
      async execute(definition, call) {
        completionVerificationExecutions.push(definition.name);
        if (definition.name === 'workspace.discover') {
          return {
            content: '{"resourceType":"digests","scope":"today","total":0,"items":[]}',
            madeProgress: true
          };
        }
        if (definition.name === 'generate_digest') {
          return {
            content: '{"accepted":true,"taskId":"AgentRunId:task-digest-1"}',
            resultRef: 'AgentRunId:task-digest-1'
          };
        }
        assert.equal(definition.name, 'task.read_status');
        assert.equal(call.arguments.taskId, 'AgentRunId:task-digest-1');
        return {
          content: '{"found":true,"task":{"status":"running","statusText":"生成中"}}',
          madeProgress: true
        };
      }
    },
    { async save(checkpoint) { completionVerificationCheckpoints.push(checkpoint); } }
  );
  const completionVerificationResult = await completionVerificationLoop.execute({
    agentRunId: 'agent-run-completion-verification',
    system: '异步业务必须核验真实状态。',
    messages: [{ role: ai.ModelMessageRole.User, content: '生成今天的每日热点。' }],
    tools: digestBundle.tools,
    skills: digestBundle.activations,
    executionContext: { agentRunId: 'agent-run-completion-verification' }
  }, {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    async complete(request) {
      completionVerificationRequests.push(request);
      if (completionVerificationRequests.length === 1) {
        return {
          text: '',
          toolCalls: [{
            id: 'discover-digest',
            name: 'workspace_discover',
            arguments: { resourceType: 'digests', scope: 'today' }
          }],
          usage: {}
        };
      }
      if (completionVerificationRequests.length === 2) {
        return { text: '我直接为你整理一份今日热点正文。', usage: {} };
      }
      if (completionVerificationRequests.length === 3) {
        assert.match(request.messages.at(-1).content, /必须实际调用工具/);
        return {
          text: '',
          toolCalls: [{
            id: 'generate-digest-task',
            name: 'generate_digest',
            arguments: { digestTab: 'news' }
          }],
          usage: {}
        };
      }
      if (completionVerificationRequests.length === 4) {
        return { text: '今日热点已经生成完成。', usage: {} };
      }
      if (completionVerificationRequests.length === 5) {
        assert.match(request.messages.at(-1).content, /必须调用状态核验工具/);
        return {
          text: '',
          toolCalls: [{
            id: 'verify-digest-task',
            name: 'task_read_status',
            arguments: { taskId: 'AgentRunId:task-digest-1' }
          }],
          usage: {}
        };
      }
      return { text: '每日热点任务已受理，目前正在生成。', usage: {} };
    }
  });
  assert.equal(completionVerificationResult.text, '每日热点任务已受理，目前正在生成。');
  assert.equal(completionVerificationRequests.length, 6);
  assert.deepEqual(completionVerificationExecutions, ['workspace.discover', 'generate_digest', 'task.read_status']);
  assert.equal(completionVerificationCheckpoints.at(-1).awaitingCompletionVerification, false);
  assert.deepEqual(completionVerificationCheckpoints.at(-1).completedToolNames, ['generate_digest']);

  const requiredToolRequests = [];
  const requiredToolEvents = [];
  let requiredToolExecutions = 0;
  const scanTool = agent.tutorToolCatalog.find((tool) => tool.name === 'question_bank.scan');
  const importPrompt = '请扫描并导入真题。';
  const requiredToolLoop = new agent.RunAgentLoop(
    modelInvoker,
    { async evaluate() { return { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.write_allowed' }; } },
    {
      async execute(definition) {
        assert.equal(definition.name, 'question_bank.scan');
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
    requiredToolName: 'question_bank.scan',
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
    tools: [agent.tutorToolCatalog.find((tool) => tool.name === 'question_bank.resume')],
    requiredToolName: 'question_bank.resume',
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
    tools: [agent.tutorToolCatalog.find((tool) => tool.name === 'practice.read_library')],
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
    tools: [agent.tutorToolCatalog.find((tool) => tool.name === 'candidate.change_target')],
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
    tools: [agent.tutorToolCatalog.find((tool) => tool.name === 'candidate.change_target')],
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
        return definition.name === 'candidate.change_target'
          ? { decision: agent.AgentToolPolicyDecision.Confirm, reasonCode: 'policy.user_confirmation_required' }
          : { decision: agent.AgentToolPolicyDecision.Allow, reasonCode: 'policy.read_allowed' };
      }
    },
    {
      async execute(definition) {
        mixedExecutions.push(definition.name);
        return { content: JSON.stringify({ ok: true }) };
      }
    },
    { async save() {} }
  );
  const mixedTools = [
    agent.tutorToolCatalog.find((tool) => tool.name === 'student.read_profile'),
    agent.tutorToolCatalog.find((tool) => tool.name === 'candidate.change_target')
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
    name: 'tutor.aptitude_specialist',
    description: '处理行测能力诊断和教学建议。',
    instructionRef: 'prompt.agent.aptitude@1',
    allowedSkills: ['tutor.daily_coaching'],
    allowedTools: ['student.read_profile'],
    delegationMode: agent.AgentDelegationMode.AsTool,
    maxTurns: 4,
    maxToolCalls: 6
  });
  assert.equal(subAgents.get('tutor.aptitude_specialist').maxTurns, 4);

  console.log('Agent loop verification passed.');
} finally {
  await server.close();
}
