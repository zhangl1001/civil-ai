import { ModelMessageRole, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import {
  AgentExecutionBudgetTier,
  AgentSkillBundleCompiler,
  AgentSkillRegistry,
  AgentToolRegistry,
  agentExternalToolCatalog,
  RegisteredAgentToolExecutor,
  tutorToolCatalog,
  type AgentLoopCheckpoint,
  type AgentRuntimeEvent,
  type AgentSkillManifest,
  type RunAgentLoop
} from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { QuestionImportDraftRepository, ScanQuestionImportDraft } from '@/modules/content/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { BusinessAgentExecutionContext, BusinessAgentTask } from './BusinessAgentExecutors';
import { QuestionImportAgentService } from '@/services/QuestionImportAgentService';
import { webResearchService } from '@/services/WebResearchService';

export interface TrueQuestionResearchAgentDependencies {
  readonly candidates: CandidateRepository;
  readonly curriculums: CurriculumRepository;
  readonly scanDraft: ScanQuestionImportDraft;
  readonly drafts: QuestionImportDraftRepository;
  readonly createAgentLoop: (executor: RegisteredAgentToolExecutor, observer?: { onEvent(event: AgentRuntimeEvent): Promise<void> | void }) => RunAgentLoop;
}

export interface TrueQuestionResearchResult {
  readonly draftId: string;
  readonly totalCount: number;
  readonly readyCount: number;
  readonly needsConfirmationCount: number;
}

const directTools = [
  ...agentExternalToolCatalog,
  requireTool('question_bank.scan')
];
const registry = new AgentToolRegistry();
registry.registerAll(directTools);
const skillRegistry = new AgentSkillRegistry(registry);
skillRegistry.register(trueQuestionResearchSkill());
const compiler = new AgentSkillBundleCompiler(skillRegistry, registry);

export async function runTrueQuestionResearchAgent(
  task: BusinessAgentTask,
  run: { readonly id: string; readonly examCycleId?: string; readonly checkpoint: JsonObject },
  gateway: ProviderGateway,
  context: BusinessAgentExecutionContext,
  dependencies: TrueQuestionResearchAgentDependencies
): Promise<TrueQuestionResearchResult> {
  const scope = String(task.payload.scope || task.detail || '').trim();
  if (!scope) throw new Error('联网真题研究缺少明确范围。');
  const maxQuestions = clampQuestionCount(task.payload.maxQuestions);
  const ownerSessionId = `true-question-research:${run.id}`;
  const diagnostics = new TrueQuestionResearchDiagnostics(run.id);
  const bundle = compiler.compile(['workflow.true_question_research'], 'tutor_turn', {
    maxSkills: 1,
    maxTools: 3,
    maxContextBudgetTokens: 2_000
  });
  const executor = new RegisteredAgentToolExecutor();
  const questionImport = new QuestionImportAgentService({
    candidates: dependencies.candidates,
    curriculums: dependencies.curriculums,
    scanDraft: dependencies.scanDraft
  });
  let latestDraft: TrueQuestionResearchResult | undefined;
  executor.register('web.search', async (call, execution) => {
    try {
      const query = String(call.arguments.query || '');
      const result = await webResearchService.searchForAgentRun({
        agentRunId: execution.agentRunId,
        query,
        freshness: normalizeFreshness(call.arguments.freshness),
        limit: Number(call.arguments.limit || 5),
        signal: execution.signal
      });
      diagnostics.searchCompleted(call.id, query, result.hits);
      return {
        content: JSON.stringify({
          query: result.query,
          fetchedAt: result.fetchedAt,
          results: result.hits.map((hit) => ({
            title: hit.title,
            url: hit.url,
            domain: hit.domain,
            snippet: (hit.snippet || hit.content || '').slice(0, 1_800),
            publishedAt: hit.publishedAt ?? null
          }))
        }),
        resultRef: result.hits[0]?.url,
        madeProgress: result.hits.length > 0
      };
    } catch (error) {
      diagnostics.toolError(call.id, 'web.search', error);
      throw error;
    }
  });
  executor.register('web.read_page', async (call, execution) => {
    try {
      const page = await webResearchService.readPageForAgentRun({
        agentRunId: execution.agentRunId,
        url: String(call.arguments.url || ''),
        focus: String(call.arguments.focus || scope),
        offset: optionalNumber(call.arguments.offset),
        signal: execution.signal
      });
      diagnostics.pageRead(call.id, page);
      return {
        content: JSON.stringify(researchPageEvidence(page, maxQuestions)),
        resultRef: page.url
      };
    } catch (error) {
      diagnostics.toolError(call.id, 'web.read_page', error);
      throw error;
    }
  });
  executor.register('question_bank.scan', async (call, execution) => {
    try {
      if (!hasPublishableResearchCandidate(call.arguments)) {
        throw new Error('当前候选缺少可核验答案或可答题结构，不能形成可练习草稿。请继续读取答案页、解析页或更完整的同卷来源；不得猜测答案。');
      }
      const view = await questionImport.scan(call.arguments, {
        agentRunId: execution.agentRunId,
        callId: call.id,
        ownerSessionId,
        importedBy: 'research_agent'
      });
      const scannedDraft = {
        draftId: view.draftId,
        totalCount: view.totalCount,
        readyCount: view.readyCount,
        needsConfirmationCount: view.needsConfirmationCount
      };
      diagnostics.draftCreated(call.id, scannedDraft);
      if (!scannedDraft.readyCount) {
        throw new Error(`本次扫描没有可入库题目：${summarizeImportIssues(view.issues, view.candidates)}。请根据缺失项继续核验其他来源。`);
      }
      latestDraft = scannedDraft;
      return { content: JSON.stringify(view), resultRef: view.draftId };
    } catch (error) {
      diagnostics.toolError(call.id, 'question_bank.scan', error);
      throw error;
    }
  });

  await context.update(12, '分析检索范围');
  const loop = dependencies.createAgentLoop(executor, {
    onEvent: (event) => {
      diagnostics.observe(event);
      return updateResearchProgress(event, context);
    }
  });
  const result = await loop.execute({
    agentRunId: run.id as Parameters<RunAgentLoop['execute']>[0]['agentRunId'],
    system: [
      '你是独立运行的公务员考试真题研究 Agent。当前任务不依赖聊天窗口，也不能向用户输出内部工具名。',
      '目标是从公开网页中找到可核验的真实题目正文，形成待用户确认的导入草稿。搜索摘要只用于发现来源，不能直接当题目。',
      '一次空结果不代表任务结束：调整年份、地区、试卷名称、模块、站点限定或关键词后继续；读取实际页面并核验来源。',
      '真题年份不等于网页发布时间：检索历史试卷通常使用 freshness=any，并优先寻找可直读全文或 PDF 的结果；目录页可继续读取其中的公开子链接。',
      '形成可练习草稿前必须读到可答题最低结构：完整题干、按原顺序排列的完整选项，以及来源明确给出的正确答案。只看到题干、摘要或下载介绍时继续读取答案页、目标章节或更换来源，不能提交残缺候选。',
      '解析允许缺失并省略 explanation；答案不允许猜测或自行推断。每道候选保留其真实来源 URL 和试卷身份。',
      `本轮最多整理 ${maxQuestions} 道同一模块或明确考点的题。${maxQuestions} 是上限，不是必须凑齐的数量。`,
      '只要已有至少 1 道题具备完整题干、完整选项和可核验答案，就立即调用 question_bank.scan 形成草稿，不要为了凑题数或解析继续消耗检索轮次。',
      '同一份已核验试卷正文若包含多道完整题，应直接按原顺序提取；不要再拿每道题干逐题搜索做二次验证。待确认草稿允许只依赖一个可核验的公开来源。',
      'PDF 或长网页可能把多道题压在同一行；仍应按题号及 A-D 选项边界提取已有结构，不能因为排版紧凑而忽略可用题目。',
      '只有 question_bank.scan 返回至少 1 道 ready 候选和真实 draftId 才算完成；0 道 ready 是失败反馈，必须继续调整来源。不得自动确认或发布。'
    ].join('\n'),
    messages: [{
      role: ModelMessageRole.User,
      content: `研究范围：${scope}\n请自主制定和调整检索策略，核验网页后把不超过 ${maxQuestions} 道真实题目整理为待确认草稿。`
    }],
    tools: bundle.tools,
    skills: bundle.activations,
    executionContext: {
      agentRunId: run.id as Parameters<RunAgentLoop['execute']>[0]['agentRunId'],
      examCycleId: run.examCycleId,
      sessionId: ownerSessionId,
      signal: context.signal
    },
    checkpoint: parseCheckpoint(run.checkpoint.agentLoop),
    maxToolCallsPerTurn: 4,
    maxParallelReadToolCalls: 3,
    maxToolResultChars: 12_000,
    preferStream: false,
    requiredToolName: 'question_bank.scan'
  }, gateway, context.signal);
  if (result.status === 'budget_exhausted') {
    throw new Error('联网真题研究在当前来源中未能形成可核验草稿，请缩小年份、地区或模块后重试。');
  }
  if (!latestDraft) {
    const existing = await dependencies.drafts.findLatestPendingByOwner(ownerSessionId);
    if (existing) {
      const existingDraft = {
        draftId: existing.draft.id,
        totalCount: existing.candidates.length,
        readyCount: existing.candidates.filter((item) => item.status === 'ready').length,
        needsConfirmationCount: existing.candidates.filter((item) => item.status === 'needs_confirmation').length
      };
      if (existingDraft.readyCount) latestDraft = existingDraft;
    }
  }
  if (!latestDraft) {
    throw new Error('公开来源中没有找到可核验并可渲染的题目正文，请缩小范围或改用文件导入。');
  }
  await context.update(94, `已形成 ${latestDraft.totalCount} 道待确认真题`);
  return latestDraft;
}

class TrueQuestionResearchDiagnostics {
  private turn = 0;

  constructor(private readonly runId: string) {}

  observe(event: AgentRuntimeEvent): void {
    if (!this.enabled()) return;
    if (event.type === 'model_turn_started') {
      this.turn = event.turn;
      this.write('model_turn_started', { turn: event.turn });
      return;
    }
    if (event.type === 'tool_call_requested') {
      this.write('tool_call_requested', {
        turn: this.turn,
        callId: event.call.id,
        tool: event.call.name,
        input: summarizeToolArguments(event.call.name, event.call.arguments)
      });
      return;
    }
    if (event.type === 'tool_call_succeeded') {
      this.write('tool_call_succeeded', {
        turn: this.turn,
        callId: event.call.id,
        tool: event.call.name,
        resultRef: event.resultRef
      });
      return;
    }
    if (event.type === 'tool_call_failed') {
      this.write('tool_call_failed', {
        turn: this.turn,
        callId: event.call.id,
        tool: event.call.name,
        reasonCode: event.reasonCode
      });
      return;
    }
    if (event.type === 'run_completed' || event.type === 'run_stopped') {
      this.write(event.type, {
        turn: this.turn,
        ...('reasonCode' in event ? { reasonCode: event.reasonCode } : {})
      });
    }
  }

  searchCompleted(callId: string, query: string, hits: readonly {
    readonly title: string;
    readonly domain: string;
    readonly url: string;
  }[]): void {
    this.write('search_completed', {
      turn: this.turn,
      callId,
      query,
      hitCount: hits.length,
      hits: hits.slice(0, 5).map((hit) => ({
        title: hit.title.slice(0, 100),
        domain: hit.domain,
        url: hit.url
      }))
    });
  }

  pageRead(callId: string, page: { readonly title: string; readonly domain: string; readonly url: string; readonly content: string }): void {
    this.write('page_read', {
      turn: this.turn,
      callId,
      title: page.title.slice(0, 120),
      domain: page.domain,
      url: page.url,
      contentChars: page.content.length
    });
  }

  draftCreated(callId: string, draft: TrueQuestionResearchResult): void {
    this.write('draft_created', { turn: this.turn, callId, ...draft });
  }

  toolError(callId: string, tool: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    this.write('tool_error_detail', {
      turn: this.turn,
      callId,
      tool,
      message: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
    });
  }

  private write(event: string, detail: Record<string, unknown>): void {
    if (!this.enabled()) return;
    console.info('[TrueQuestionResearch]', JSON.stringify({ runId: this.runId, event, ...detail }));
  }

  private enabled(): boolean {
    return import.meta.env.DEV && typeof window !== 'undefined';
  }
}

function summarizeToolArguments(toolName: string, args: JsonObject): JsonObject {
  if (toolName === 'web.search') {
    return {
      query: String(args.query || '').slice(0, 300),
      purpose: String(args.purpose || ''),
      freshness: String(args.freshness || ''),
      limit: Number(args.limit || 0)
    };
  }
  if (toolName === 'web.read_page') return {
    url: String(args.url || '').slice(0, 2_000),
    focus: String(args.focus || '').slice(0, 160),
    offset: Number(args.offset || 0)
  };
  if (toolName === 'question_bank.scan') {
    const questions = Array.isArray(args.questions) ? args.questions : [];
    return {
      capability: String(args.capability || '').slice(0, 100),
      module: String(args.module || '').slice(0, 80),
      questionCount: questions.length,
      questionStructure: questions.slice(0, 10).map((value) => {
        const question = value && typeof value === 'object' && !Array.isArray(value)
          ? value as JsonObject
          : {};
        const options = Array.isArray(question.options) ? question.options : [];
        return {
          hasPrompt: typeof question.prompt === 'string' && Boolean(question.prompt.trim()),
          optionCount: options.length,
          hasAnswer: typeof question.correctOptionId === 'string' && Boolean(question.correctOptionId.trim()),
          hasExplanation: Boolean(question.explanation),
          hasVisual: Boolean(question.visual)
        };
      }),
      sourceUrl: String((args.sourceMetadata as JsonObject | undefined)?.sourceUrl || '').slice(0, 2_000)
    };
  }
  return {};
}

function trueQuestionResearchSkill(): AgentSkillManifest {
  return {
    name: 'workflow.true_question_research',
    version: '1.0.0',
    description: '独立检索、核验公开真题来源，并把小批量真实题目整理为待确认草稿。',
    dependencies: [],
    conflicts: [],
    workflow: {
      name: '真题研究任务',
      description: '根据证据质量动态调整检索策略；一旦至少一题达到可练习结构就先形成草稿。',
      steps: [
        { name: '制定查询', description: '围绕年份、地区、考试类型、试卷名称和模块生成必要且相互独立的查询。' },
        { name: '检索与纠偏', description: '并行搜索；结果过宽、被百科或日历污染时收窄站点和关键词后继续。' },
        { name: '核验正文', description: '读取候选网页；长试卷使用 focus 聚焦目标模块，必要时用 offset 分段。同一证据块已有多道完整题时直接提取，不逐题重复检索。' },
        { name: '生成草稿', description: '题量是上限；至少一题具备完整题干、选项和可核验答案时立即调用 question_bank.scan，不补造答案、解析或官方身份。' }
      ],
      completionCriteria: ['question_bank.scan 返回至少 1 道 ready 候选和真实 draftId；草稿等待用户确认，未自动发布。'],
      failureRecovery: ['搜索为空时改变关键词或来源；网页不完整时更换来源；证据不足时停止并报告具体范围。']
    },
    promptChapters: [{
      name: 'true-question.evidence',
      title: '证据和结构边界',
      content: '搜索摘要不是题目证据。每道可练习题必须来自已读取页面，并至少包含完整题干、完整选项和可核验答案；共用材料使用 materialGroups；解析可缺失，答案不可猜测；图形缺失时不得凭空生成 SVG。'
    }],
    resources: [],
    allowedTools: ['web.search', 'web.read_page', 'question_bank.scan'],
    validators: [
      { name: 'source-grounding', description: '来源 URL、试卷身份与题目正文相互一致。' },
      { name: 'draft-created', description: '必须获得至少 1 道 ready 候选和真实 draftId 才能完成。' }
    ],
    contextBudgetTokens: 1_800,
    executionBudget: AgentExecutionBudgetTier.LongRunning
  };
}

function requireTool(name: string) {
  const tool = tutorToolCatalog.find((item) => item.name === name);
  if (!tool) throw new Error(`Missing true-question research tool: ${name}`);
  return tool;
}

async function updateResearchProgress(event: AgentRuntimeEvent, context: BusinessAgentExecutionContext): Promise<void> {
  if (event.type === 'model_turn_started') {
    await context.update(Math.min(72, 12 + event.turn * 4), `正在评估第 ${event.turn} 轮证据`);
    return;
  }
  if (event.type === 'tool_call_started') {
    const message = event.call.name === 'web.search'
      ? '正在检索公开来源'
      : event.call.name === 'web.read_page'
        ? '正在核验网页正文'
        : '正在生成待确认草稿';
    const progress = event.call.name === 'question_bank.scan' ? 82 : event.call.name === 'web.read_page' ? 58 : 34;
    await context.update(progress, message);
  }
}

function parseCheckpoint(value: unknown): AgentLoopCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkpoint = value as Partial<AgentLoopCheckpoint>;
  return checkpoint.agentRunId && Array.isArray(checkpoint.messages)
    ? checkpoint as AgentLoopCheckpoint
    : undefined;
}

function clampQuestionCount(value: unknown): number {
  const count = Math.round(Number(value || 5));
  return Number.isFinite(count) ? Math.min(10, Math.max(1, count)) : 5;
}

function normalizeFreshness(value: unknown): 'day' | 'week' | 'month' | 'year' | 'any' {
  return value === 'day' || value === 'week' || value === 'month' || value === 'year'
    ? value
    : 'any';
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function researchPageEvidence(
  page: { readonly title: string; readonly url: string; readonly domain: string; readonly content: string; readonly fetchedAt: number },
  maxQuestions: number
) {
  const maxContentChars = 9_500;
  const content = page.content.length > maxContentChars
    ? `${page.content.slice(0, maxContentChars)}\n[当前证据块已截断；需要后文时使用 offset 继续读取]`
    : page.content;
  return {
    workflowGuidance: `先检查本证据块。只要其中至少 1 道、最多 ${maxQuestions} 道题具备完整题干、完整选项和来源明确给出的答案，下一步就调用 question_bank.scan；若缺答案则继续找同卷答案页，不要猜测；不要为解析或逐题复核继续搜索。`,
    page: { ...page, content }
  };
}

function hasPublishableResearchCandidate(argumentsValue: JsonObject): boolean {
  const questions = Array.isArray(argumentsValue.questions) ? argumentsValue.questions : [];
  return questions.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const question = value as JsonObject;
    if (typeof question.prompt !== 'string' || !question.prompt.trim()) return false;
    const options = Array.isArray(question.options) ? question.options : [];
    const optionIds = options.flatMap((option) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
      const id = (option as JsonObject).id;
      return typeof id === 'string' && id.trim() ? [id.trim()] : [];
    });
    const answer = typeof question.correctOptionId === 'string' ? question.correctOptionId.trim() : '';
    return optionIds.length >= 2 && Boolean(answer) && optionIds.includes(answer);
  });
}

function summarizeImportIssues(
  draftIssues: readonly { readonly message: string }[],
  candidates: readonly { readonly issues: readonly { readonly message: string }[] }[]
): string {
  const messages = [...draftIssues, ...candidates.flatMap((candidate) => candidate.issues)]
    .map((issue) => issue.message.trim())
    .filter(Boolean);
  return [...new Set(messages)].slice(0, 5).join('；') || '候选结构未达到可入库标准';
}
