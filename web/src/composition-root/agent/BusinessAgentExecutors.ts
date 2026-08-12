import { buildCompanionChatPrompt } from '@/ai/prompts';
import { buildEssayRepairPrompt, validateEssayQuestion } from '@/ai/QuestionValidation';
import { BusinessTutorPromptCode, parseStructuredJson } from '@/capabilities/ai-runtime/public';
import { normalizeMarkdownSource } from '@/capabilities/content-rendering/public';
import { abortableDelay, mapWithAbortableConcurrency } from '@/kernel/public';
import type { DigestTab } from '@/domain/digest';
import { aiChatRepository } from '@/services/AIChatRepository';
import { buildDailyDigestRequest } from '@/services/DailyDigestGenerationPolicy';
import { webResearchService } from '@/services/WebResearchService';
import type { EssayQuestionRecord } from '@/services/EssayRepository';
import {
  essayQuestionSetBusinessKey,
  normalizeEssayQuestionSetMode,
  normalizeEssayQuestionSetPurpose
} from '@/domain/essayQuestionSet';
import type { AITextMessage } from '../ai/ConfiguredAIClient';
import {
  GenerationVariationKind,
  LearningAssetKind
} from '@/modules/content/public';
import { AgentRunInputIncompatibleError } from '@/modules/agent/public';
import { completeFreshGeneratedContent, learningAssetReferences } from './FreshGeneratedContent';
import type {
  BusinessAgentExecutionContext,
  BusinessAgentExecutor
} from './BusinessAgentContracts';
export type {
  BusinessAgentExecutionContext,
  BusinessAgentExecutor,
  BusinessAgentTask,
  BusinessAgentTaskType
} from './BusinessAgentContracts';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function digestBusinessKey(tab: DigestTab, date: string): string {
  return `digest:${tab}:${date}`;
}

function interviewBusinessKey(sessionId: string): string {
  return `interview:${sessionId}`;
}

function buildEssayJsonRewritePrompt(rawText: string, issues: string[]): string {
  return [
    '# 命题质检与重写任务：申论题',
    '',
    '你现在是公务员考试申论命题质检编辑。请读取原始输出，按其主题重新整理或重写为可直接入库的申论题 JSON。',
    '',
    '## 已发现的问题',
    ...issues.slice(0, 12).map((issue) => `- ${issue}`),
    '',
    '## 最终输出要求',
    '1. 只输出 JSON 对象，不要 Markdown，不要解释，不要代码围栏。',
    '2. 必须包含 title, material, requirement, lecture。',
    '3. material 必须有多段给定资料，包含事实、主体、矛盾、做法和场景，不要空泛。',
    '4. requirement 必须明确题型、作答对象、字数和限定。',
    '5. lecture 必须是知识点讲义，不是单题解析；使用 knowledgePoint, title, summary, clues, methods, structure, warnings, cases, drills 稳定槽位。',
    '6. 讲清核心知识点、识别方法、作答方法与关键易错点；各列表条数和篇幅按内容需要决定，不为凑数量重复。',
    '7. 题目必须围绕 lecture.knowledgePoint 命制。',
    '',
    '## 原始输出',
    rawText
  ].join('\n');
}

function parseEssayFeedback(text: string): {
  feedback: string;
  score?: number;
  confidence: number;
  dimensions: Array<{ code: string; name: string; score?: number; comment: string; evidence?: string }>;
  suggestions?: string[];
} {
  try {
    const parsed = parseStructuredJson<{
      feedback?: string;
      score?: number;
      confidence?: number;
      dimensions?: Array<{ code?: string; name?: string; score?: number; comment?: string; evidence?: string }>;
      suggestions?: string[];
    }>(text);
    return {
      feedback: parsed.feedback || text,
      score: typeof parsed.score === 'number' ? parsed.score : undefined,
      confidence: clamp01(Number(parsed.confidence ?? 0.65)),
      dimensions: (parsed.dimensions || [])
        .filter((item) => item.name && item.comment)
        .map((item) => ({
          code: item.code || '',
          name: item.name || '',
          score: item.score,
          comment: item.comment || '',
          evidence: item.evidence
        })),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean) : undefined
    };
  } catch {
    return { feedback: text, confidence: 0.4, dimensions: [] };
  }
}

function parseInterviewReview(text: string): {
  feedback: string;
  score: number;
  confidence: number;
  dimensions: Array<{ code: string; name: string; score: number; comment: string; evidence?: string }>;
  suggestions: string[];
} {
  const parsed = parseStructuredJson<{
    feedbackMarkdown?: string;
    score?: number;
    confidence?: number;
    dimensions?: Array<{ code?: string; name?: string; score?: number; comment?: string; evidence?: string }>;
    suggestions?: string[];
  }>(text);
  const feedback = asString(parsed.feedbackMarkdown);
  const expectedCodes = ['content', 'structure', 'expression', 'fluency'];
  const dimensions = (parsed.dimensions || []).flatMap((item) => (
    item.code && expectedCodes.includes(item.code) && item.name && typeof item.score === 'number' && item.comment
      ? [{
          code: item.code,
          name: item.name,
          score: normalizePercent(item.score),
          comment: item.comment,
          evidence: item.evidence
        }]
      : []
  ));
  const dimensionCodes = new Set(dimensions.map((item) => item.code));
  if (!feedback || expectedCodes.some((code) => !dimensionCodes.has(code)) || !Number.isFinite(parsed.score)) {
    throw new Error('面试点评结果缺少完整评分维度');
  }
  return {
    feedback,
    score: normalizePercent(Number(parsed.score)),
    confidence: clamp01(Number(parsed.confidence ?? 0.65)),
    dimensions,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean) : []
  };
}

function parseEssayQuestion(text: string): EssayQuestionRecord {
  const parsed = parseStructuredJson<Partial<EssayQuestionRecord>>(text);
  if (!parsed.title || !parsed.material || !parsed.requirement) {
    throw new Error('申论题目 JSON 缺少 title/material/requirement');
  }
  return {
    id: parsed.id || `essay_mock_${Date.now()}`,
    title: parsed.title,
    material: parsed.material,
    requirement: parsed.requirement,
    lecture: parsed.lecture && parsed.lecture.title && parsed.lecture.summary
      ? {
          knowledgePoint: parsed.lecture.knowledgePoint,
          title: parsed.lecture.title,
          summary: parsed.lecture.summary,
          clues: Array.isArray(parsed.lecture.clues) ? parsed.lecture.clues.filter(Boolean) : [],
          methods: Array.isArray(parsed.lecture.methods) ? parsed.lecture.methods.filter(Boolean) : [],
          structure: Array.isArray(parsed.lecture.structure) ? parsed.lecture.structure.filter(Boolean) : [],
          warnings: Array.isArray(parsed.lecture.warnings) ? parsed.lecture.warnings.filter(Boolean) : [],
          cases: Array.isArray(parsed.lecture.cases) ? parsed.lecture.cases.filter(Boolean) : [],
          drills: Array.isArray(parsed.lecture.drills) ? parsed.lecture.drills.filter(Boolean) : []
        }
      : undefined
  };
}

async function parseOrRepairEssayQuestion(rawText: string, context: BusinessAgentExecutionContext): Promise<EssayQuestionRecord> {
  let parseIssue = '';
  let question: EssayQuestionRecord | undefined;
  try {
    question = parseEssayQuestion(rawText);
  } catch (error) {
    parseIssue = `申论题 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`;
    await context.log(parseIssue);
  }
  if (!question) {
    await context.update(76, '质检并整理申论题');
    const rewritten = await context.complete([
      { role: 'system', content: '你是严格的公务员考试申论命题质检编辑。只输出最终 JSON 对象，不解释，不输出 Markdown。' },
      { role: 'user', content: buildEssayJsonRewritePrompt(rawText, [parseIssue || '无法解析为申论题 JSON']) }
    ], { temperature: 0 });
    question = parseEssayQuestion(rewritten);
  }
  let validation = validateEssayQuestion(question);
  if (validation.valid) return question;

  await context.update(78, '修复申论结构');
  await context.log(`申论题质量校验未通过：${validation.issues.slice(0, 6).join('；')}`);
  const repaired = await context.complete([
    { role: 'system', content: '你是严格的公务员考试申论命题质检编辑。只输出最终 JSON 对象，不解释，不输出 Markdown。' },
    { role: 'user', content: `${buildEssayRepairPrompt(JSON.stringify(question, null, 2), validation.issues)}\n\n${buildEssayJsonRewritePrompt(rawText, validation.issues)}` }
  ], { temperature: 0 });

  question = parseEssayQuestion(repaired);
  validation = validateEssayQuestion(question);
  if (!validation.valid) throw new Error(`申论题质量校验失败：${validation.issues.slice(0, 5).join('；')}`);
  return question;
}

function buildChatContext(history: Awaited<ReturnType<typeof aiChatRepository.listMessages>>, prompt: string): AITextMessage[] {
  const budget = 12000;
  const selected: AITextMessage[] = [];
  let used = 0;
  const usable = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message, index, items) => !(index === items.length - 1 && message.role === 'user' && message.content.trim() === prompt.trim()))
    .slice(-24)
    .reverse();

  for (const message of usable) {
    const content = sanitizeChatContextMessage(message.content);
    if (!content) continue;
    const cost = content.length;
    if (used + cost > budget) break;
    selected.push({ role: message.role as 'user' | 'assistant', content });
    used += cost;
  }

  return selected.reverse();
}

function sanitizeChatContextMessage(content: string): string {
  const clean = content
    .replace(/\n?\s*\[\[ZH_AI_STOPPED\]\]\s*$/g, '')
    .replace(/^回复失败：.*$/g, '')
    .trim();
  return clean.length > 4000 ? `${clean.slice(0, 4000)}\n（以上为较长回复截断摘要）` : clean;
}

export const chatExecutor: BusinessAgentExecutor = async (task, context) => {
  const sessionId = asString(task.payload?.sessionId);
  const prompt = asString(task.payload?.prompt) || task.detail || '';
  const thinkingMode = asString(task.payload?.thinkingMode);
  if (!sessionId || !prompt) throw new Error('AI 对话任务缺少会话或问题内容');
  await context.update(18, '读取安全配置');
  const systemPrompt = buildCompanionChatPrompt(thinkingMode === 'enabled');
  const history = await aiChatRepository.listMessages(sessionId);
  const messages: AITextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...buildChatContext(history, prompt),
    { role: 'user', content: prompt }
  ];
  await context.update(28, '连接大模型');

  let answer = '';
  let lastProgressUpdate = 0;
  await context.stream(messages, async (delta) => {
    answer += delta;
    const now = Date.now();
    if (now - lastProgressUpdate < 260 && answer.length > 24) return;
    lastProgressUpdate = now;
    await context.update(Math.min(86, 32 + Math.floor(answer.length / 80)), 'AI 正在回复');
  });

  await context.update(88, '写入对话结果');
  await aiChatRepository.addMessage({
    sessionId,
    role: 'assistant',
    content: answer,
    toolCallId: task.id
  });
};

export const essayGradeExecutor: BusinessAgentExecutor = async (task, context) => {
  const content = asString(task.payload?.content);
  if (!content.trim()) throw new Error('申论批改任务缺少作答内容');
  const questionSetId = asString(task.payload?.questionSetId).trim();
  if (!questionSetId) {
    throw new AgentRunInputIncompatibleError('该批改任务来自旧版本，缺少可靠的题组标识，已停止恢复。原作答数据不会被删除，请从对应题组重新提交批改。');
  }
  const entryMode = normalizeEssayQuestionSetMode(task.payload?.entryMode);
  const essayContext = {
    questionSetId,
    date: asString(task.payload?.essayDate) || new Date().toISOString().slice(0, 10),
    topic: asString(task.payload?.essayTopic) || '申论',
    type: asString(task.payload?.essayType) === 'long' ? 'long' : 'short',
    entryMode,
    purpose: normalizeEssayQuestionSetPurpose(task.payload?.purpose, entryMode)
  };
  const questionAsset = await context.findLatestLearningAsset({
    kind: LearningAssetKind.EssayQuestion,
    businessKey: essayQuestionSetBusinessKey(essayContext)
  });
  if (!questionAsset) throw new Error('当前申论题目不存在，请先生成题目后再批改');
  const question = asRecord(questionAsset.payload.question);
  await context.update(20, '分析申论作答');
  const prompt = context.compilePrompt(BusinessTutorPromptCode.EssayGrade, {
    question: {
      title: asString(question.title),
      material: asString(question.material),
      requirement: asString(question.requirement)
    },
    candidateAnswer: content,
    rubricVersion: 'essay_rubric@1.0.0'
  });
  const rawFeedback = await context.complete([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], { temperature: 0.1, responseSchema: prompt.responseSchema });
  await context.update(84, '保存批改反馈');
  const parsed = parseEssayFeedback(rawFeedback);
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.EssayAttempt,
    businessKey: essayQuestionSetBusinessKey(essayContext),
    title: `${essayContext.topic}批改 · ${essayContext.date}`,
    purpose: essayContext.purpose,
    payload: {
      questionAssetId: questionAsset.id,
      question,
      content,
      feedback: parsed.feedback,
      score: parsed.score,
      confidence: parsed.confidence,
      rubricVersion: 'essay_rubric@1.0.0',
      dimensions: parsed.dimensions,
      suggestions: parsed.suggestions,
      wordCount: content.length,
      essayContext
    }
  });
  const overallScore = normalizePercent(parsed.score ?? 0) / 100;
  const essayRubricDimensions = [
    { code: 'relevance', capabilityCode: 'essay.material_analysis' },
    { code: 'evidence_extraction', capabilityCode: 'essay.material_analysis' },
    { code: 'structure', capabilityCode: 'essay.structured_expression' },
    { code: 'reasoning', capabilityCode: 'essay.structured_expression' },
    { code: 'expression', capabilityCode: 'essay.structured_expression' }
  ] as const;
  await context.recordSubjectiveAssessment({
    sourceAssetId: saved.id,
    rubricVersion: 'essay_rubric@1.0.0',
    dimensions: essayRubricDimensions.map(({ code, capabilityCode }) => ({
      capabilityCode,
      dimensionKey: code,
      score: dimensionScore(parsed.dimensions, [code], overallScore),
      confidence: parsed.confidence,
      metadata: { dimensionCode: code, questionAssetId: questionAsset.id }
    }))
  });
  await context.setResult({
    resultRef: saved.id,
    payload: { assetId: saved.id, essayContext }
  });
};

export const interviewReviewExecutor: BusinessAgentExecutor = async (task, context) => {
  const sessionId = asString(task.payload?.sessionId) || asString(task.payload?.sourceId);
  if (!sessionId) throw new Error('面试点评任务缺少 sessionId');
  await context.update(18, '读取面试记录');
  const sessionAsset = await context.findLatestLearningAsset({
    kind: LearningAssetKind.InterviewSession,
    businessKey: interviewBusinessKey(sessionId)
  });
  if (!sessionAsset) throw new Error('面试记录不存在');
  const session = sessionAsset.payload;
  const answersSource = Array.isArray(session.answers) ? session.answers : [];

  const answers = answersSource.map((rawAnswer, index) => {
    const answer = asRecord(rawAnswer);
    const question = asRecord(answer.question);
    const speechMetrics = asRecord(answer.speechMetrics);
    return [
    `第 ${index + 1} 题（${asString(question.type)}）：${asString(question.text)}`,
    `提示：${asString(question.hint)}`,
    `作答：${answer.skipped ? '已跳过' : asString(answer.answer) || asString(answer.transcript) || '未作答'}`,
    Object.keys(speechMetrics).length
      ? `语音指标：${Number(speechMetrics.durationSeconds || 0)} 秒，${Number(speechMetrics.wordsPerMinute || 0)} 字/分，口头语 ${Number(speechMetrics.fillerCount || 0)} 次`
      : '',
  ].filter(Boolean).join('\n');
  }).join('\n\n');

  await context.update(38, '生成深度点评');
  const prompt = context.compilePrompt(BusinessTutorPromptCode.InterviewReview, {
    interviewType: asString(session.interviewType),
    difficulty: asString(session.difficulty),
    questionTypes: Array.isArray(session.questionTypes) ? session.questionTypes.map(String) : [],
    answers
  });
  const rawFeedback = await context.complete([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], { temperature: 0.15, responseSchema: prompt.responseSchema });
  const review = parseInterviewReview(rawFeedback);

  await context.update(86, '写入面试点评');
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.InterviewSession,
    businessKey: interviewBusinessKey(sessionId),
    title: asString(session.title) || `面试训练 · ${asString(session.date)}`,
    payload: {
      ...session,
      aiFeedback: review.feedback,
      score: {
        total: review.score,
        confidence: review.confidence,
        rubricVersion: 'interview_rubric@1.0.0',
        dimensions: review.dimensions
      },
      aiSuggestions: review.suggestions,
      reviewStatus: 'completed',
      rubricVersion: 'interview_rubric@1.0.0',
      updatedAt: Date.now()
    }
  });
  const interviewDimensions = ['content', 'structure', 'expression', 'fluency'].map((code) => {
    const dimension = review.dimensions.find((item) => item.code === code);
    return {
      capabilityCode: `interview.${code}`,
      dimensionKey: code,
      score: normalizePercent(dimension?.score ?? review.score) / 100,
      confidence: dimension ? review.confidence : review.confidence * 0.7,
      metadata: {
        dimensionCode: code,
        comment: dimension?.comment ?? '',
        evidence: dimension?.evidence ?? '',
        sessionId
      }
    };
  });
  await context.recordSubjectiveAssessment({
    sourceAssetId: saved.id,
    rubricVersion: 'interview_rubric@1.0.0',
    dimensions: interviewDimensions
  });
  await context.setResult({ resultRef: saved.id, payload: { sessionId, assetId: saved.id } });
  await context.update(96, '面试点评已生成');
};

export const generatePracticeExecutor: BusinessAgentExecutor = async (task, context) => {
  const module = asString(task.payload?.module) || '专项练习';
  const questionCount = Number(task.payload?.questionCount || 5);
  const knowledgePoint = asString(task.payload?.knowledgePoint);
  const difficulty = asString(task.payload?.difficulty);
  const practicePurpose = asString(task.payload?.practicePurpose);
  await context.update(12, '读取结构化学习档案');
  const count = clampPracticeCount(questionCount);
  const range = difficultyRange(difficulty);
  await context.update(26, `准备${knowledgePoint || module}题组`);
  const result = await context.generatePractice({
    module,
    knowledgePoint,
    requestedCount: count,
    difficultyMin: range.min,
    difficultyMax: range.max,
    purpose: practicePurpose || `围绕${knowledgePoint || module}完成结构化练习`,
    review: task.type === 'redo',
    capabilityIndex: Number(task.payload?.capabilityIndex || 0)
  });
  await context.setResult({
    payload: {
      ...(task.payload || {}),
      questionSetId: result.questionSetId,
      learningThreadId: result.learningThreadId,
      capabilityNodeId: result.capabilityNodeId,
      capabilityCode: result.capabilityCode,
      structuredContent: true
    },
    resultRef: result.questionSetId
  });
  await context.update(92, `已写入 ${count} 道结构化题`);
};

function clampPracticeCount(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(25, Math.round(value)));
}

function difficultyRange(value: string): { min: number; max: number } {
  if (value === '基础') return { min: 0.2, max: 0.45 };
  if (value === '进阶') return { min: 0.58, max: 0.82 };
  return { min: 0.35, max: 0.65 };
}

function dimensionScore(
  dimensions: readonly { code: string; score?: number }[],
  codes: readonly string[],
  fallback: number
): number {
  const values = dimensions
    .filter((item) => codes.includes(item.code) && typeof item.score === 'number')
    .map((item) => normalizePercent(item.score!) / 100);
  if (!values.length) return clamp01(fallback);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percent));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export const mockExecutor: BusinessAgentExecutor = async (task, context) => {
  const subject = asString(task.payload?.subject) === '申论' ? '申论' : '行测';
  if (subject === '申论') {
    const essayTopic = asString(task.payload?.essayTopic) || '申论模考';
    const essayType = asString(task.payload?.essayType) === 'long' ? 'long' : 'short';
    const essayQuestionCount = Math.max(1, Math.min(3, Number(task.payload?.essayQuestionCount || 1)));
    const date = asString(task.payload?.date) || new Date().toISOString().slice(0, 10);
    const questionSetId = asString(task.payload?.questionSetId) || `EssayQuestionSetId:${task.id}`;
    const entryMode = normalizeEssayQuestionSetMode(task.payload?.entryMode);
    const purpose = normalizeEssayQuestionSetPurpose(task.payload?.purpose, entryMode);
    await context.update(20, '生成申论材料');
    const recentEssayAssets = await context.listLearningAssets({
      kinds: [LearningAssetKind.EssayQuestion],
      limit: 16
    });
    const text = await completeFreshGeneratedContent({
      context,
      promptCode: BusinessTutorPromptCode.EssayGeneration,
      payload: {
        topic: essayTopic,
        type: essayType,
        questionCount: essayType === 'long' ? 1 : essayQuestionCount
      },
      variationKind: GenerationVariationKind.EssayQuestion,
      seed: `${task.id}:${essayTopic}:${essayType}`,
      recentItems: learningAssetReferences(recentEssayAssets),
      options: { temperature: 0.42 },
      structured: true
    });
    await context.update(72, '解析申论题目');
    const question = await parseOrRepairEssayQuestion(text, context);
    const saved = await context.saveLearningAsset({
      kind: LearningAssetKind.EssayQuestion,
      businessKey: essayQuestionSetBusinessKey({ questionSetId, date, topic: essayTopic, type: essayType, entryMode, purpose }),
      title: question.title,
      purpose,
      payload: {
        question,
        essayContext: { questionSetId, date, topic: essayTopic, type: essayType, entryMode, purpose }
      }
    });
    await context.setResult({
      resultRef: saved.id,
      payload: {
        assetId: saved.id,
        essayContext: { questionSetId, date, topic: essayTopic, type: essayType, entryMode, purpose }
      }
    });
    await context.update(94, '申论模考题已写入');
    return;
  }

  const requestedCount = Math.max(5, Math.min(135, Math.round(Number(task.payload?.questionCount || 120))));
  const modules = Array.isArray(task.payload?.modules)
    ? task.payload.modules.map(String).filter(Boolean)
    : ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'];
  const focusTags = Array.isArray(task.payload?.focusTags) ? task.payload.focusTags.map(String).filter(Boolean) : ['高频考点'];
  const batches = buildMockBatches(modules, requestedCount);
  await context.update(18, `拆分 ${batches.length} 个稳定题组`);
  const sections = await mapWithAbortableConcurrency(batches, 3, context.signal, async (batch, batchIndex, signal) => {
    const result = await retryTransiently(() => context.generatePractice({
        module: batch.module,
        requestedCount: batch.count,
        difficultyMin: 0.38,
        difficultyMax: 0.78,
        purpose: `行测模考 · ${focusTags.join('、')} · ${batch.module}`,
        review: false,
        capabilityIndex: batch.moduleBatchIndex
      }),
      batchIndex,
      signal
    );
    await context.update(
      Math.min(88, 20 + Math.round(((batchIndex + 1) / batches.length) * 66)),
      `已完成 ${batchIndex + 1}/${batches.length} 个题组`
    );
    return { ...batch, ...result };
  });
  const date = asString(task.payload?.date) || new Date().toISOString().slice(0, 10);
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.MockManifest,
    businessKey: `mock:${date}:${task.id}`,
    title: `行测模考 · ${date}`,
    payload: {
      subject: '行测',
      date,
      durationMinutes: Number(task.payload?.durationMinutes || 120),
      requestedCount,
      actualCount: sections.reduce((sum, section) => sum + section.count, 0),
      focusTags,
      sections
    }
  });
  await context.setResult({
    resultRef: saved.id,
    payload: { assetId: saved.id, manifestId: saved.id, subject: '行测' }
  });
  await context.update(94, `已写入 ${sections.reduce((sum, section) => sum + section.count, 0)} 道模考题`);
};

interface MockBatch {
  readonly module: string;
  readonly count: number;
  readonly moduleBatchIndex: number;
}

function buildMockBatches(modules: readonly string[], total: number): MockBatch[] {
  const selected = modules.length ? modules : ['判断推理'];
  const base = Math.floor(total / selected.length);
  let remainder = total % selected.length;
  return selected.flatMap((module) => {
    const moduleCount = base + (remainder-- > 0 ? 1 : 0);
    const batches: MockBatch[] = [];
    let remaining = moduleCount;
    let moduleBatchIndex = 0;
    while (remaining > 0) {
      const count = Math.min(20, remaining);
      batches.push({ module, count, moduleBatchIndex });
      remaining -= count;
      moduleBatchIndex += 1;
    }
    return batches;
  });
}

async function retryTransiently<Output>(
  work: () => Promise<Output>,
  ordinal: number,
  signal: AbortSignal
): Promise<Output> {
  try {
    return await work();
  } catch (error) {
    signal.throwIfAborted();
    const message = error instanceof Error ? error.message : String(error);
    if (!/429|rate|limit|限流|timeout|network|transient|暂时|网络/i.test(message)) throw error;
    await abortableDelay(1200 + (ordinal % 3) * 700, signal);
    return work();
  }
}

export const digestExecutor: BusinessAgentExecutor = async (task, context) => {
  if (task.payload?.digestScope === 'monthly') {
    const year = Number(task.payload?.year || new Date().getFullYear());
    const month = Number(task.payload?.month || new Date().getMonth() + 1);
    const monthLabel = `${year}年${month}月`;
    await context.update(18, '读取月度热点');
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const assets = await context.listLearningAssets({
      kinds: [LearningAssetKind.DigestDaily, LearningAssetKind.DigestMonthly],
      limit: 120
    });
    const items = assets
      .map((asset) => asset.payload)
      .filter((payload) => asString(payload.tab) === 'news' && asString(payload.date).startsWith(monthPrefix));
    if (!items.length) throw new Error('本月暂无每日热点，无法生成月报');
    const briefing = items.slice(0, 80).map((item, index) => (
      `${index + 1}. [${asString(item.date)}] ${asString(item.content).slice(0, 800)}`
    )).join('\n');
    await context.update(42, '生成月度复盘');
    const result = await completeFreshGeneratedContent({
      context,
      promptCode: BusinessTutorPromptCode.MonthlyDigest,
      payload: {
        month: monthLabel,
        dailyDigestItems: briefing
      },
      variationKind: GenerationVariationKind.MonthlyDigest,
      seed: `${task.id}:${monthPrefix}`,
      recentItems: learningAssetReferences(
        assets.filter((asset) => asset.businessKey.startsWith('digest:monthly:')),
        6
      ),
      options: { temperature: 0.35 }
    });
    await context.update(82, '写入 AI 月报');
    const saved = await context.saveLearningAsset({
      kind: LearningAssetKind.DigestMonthly,
      businessKey: `digest:monthly:${monthPrefix}`,
      title: `${monthLabel}时政月报`,
      payload: { year, month, monthLabel, content: normalizeMarkdownSource(result), sourceCount: items.length }
    });
    await context.setResult({ resultRef: saved.id, payload: { assetId: saved.id, year, month } });
    await context.update(94, '月度复盘已生成');
    return;
  }
  const tab: DigestTab = task.payload?.digestTab === 'tips' ? 'tips' : 'news';
  const date = asString(task.payload?.digestDate) || new Date().toISOString().slice(0, 10);
  const learningLoad = asRecord(task.payload?.learningLoad);
  const [recentAssets, research] = await Promise.all([
    context.listLearningAssets({ kinds: [LearningAssetKind.DigestDaily], limit: 40 }),
    tab === 'news' ? collectDailyDigestResearch(date, context) : Promise.resolve(undefined)
  ]);
  const recentItems = learningAssetReferences(
    recentAssets.filter((asset) => asString(asset.payload.tab) === tab),
    12
  );
  await context.update(research ? 42 : 24, tab === 'news' ? '整理时政热点' : '生成知识点积累');
  const result = await completeFreshGeneratedContent({
    context,
    promptCode: BusinessTutorPromptCode.DailyDigest,
    payload: {
      date,
      type: tab,
      request: buildDailyDigestRequest(tab, task.detail, learningLoad),
      learningFocus: task.payload?.learningFocus ?? null,
      ...(research ? {
        webSearchQuery: research.query,
        webEvidence: research.evidence,
        evidenceRule: '只能使用 webEvidence 支持时效性事实；正文用 [来源1] 形式标注，并在末尾列出来源标题和 URL。'
      } : {})
    },
    variationKind: tab === 'news'
      ? GenerationVariationKind.DailyNews
      : GenerationVariationKind.DailyKnowledge,
    seed: `${task.id}:${tab}:${date}`,
    recentItems,
    options: { temperature: tab === 'news' ? 0.35 : 0.58 }
  });
  await context.update(82, '保存每日积累');
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.DigestDaily,
    businessKey: digestBusinessKey(tab, date),
    title: tab === 'news' ? `${date} 每日热点` : `${date} 知识积累`,
    payload: {
      tab,
      date,
      content: normalizeMarkdownSource(result),
      ...(Object.keys(learningLoad).length ? { learningLoad } : {}),
      ...(research ? {
        sourceMode: 'web_research',
        searchQuery: research.query,
        sources: research.sources.map((source) => ({
          title: source.title,
          url: source.url,
          domain: source.domain,
          excerpt: source.snippet.slice(0, 800),
          publishedAt: source.publishedAt ?? null,
          fetchedAt: source.fetchedAt
        }))
      } : { sourceMode: 'model_knowledge' })
    }
  });
  await context.setResult({ resultRef: saved.id, payload: { assetId: saved.id, tab, date } });
  await context.update(92, '每日积累已保存');
};

async function collectDailyDigestResearch(
  date: string,
  context: BusinessAgentExecutionContext
) {
  await context.update(12, '检索近期时政来源');
  const research = await webResearchService.collectDailyHotspots(date, context.signal);
  await context.log(`网络检索完成：${research.sources.length} 个来源`);
  return research;
}
export const studyExecutor: BusinessAgentExecutor = async (task, context) => {
  const topic = asString(task.payload?.topic) || task.detail || '公考考点';
  const module = asString(task.payload?.module) || '公考';
  const capabilityNodeId = asString(task.payload?.capabilityNodeId);
  const userRequest = asString(task.payload?.prompt) || `请系统讲解公考${module}考点「${topic}」。`;
  await context.update(18, '整理考点上下文');
  const recentAssets = await context.listLearningAssets({
    kinds: [LearningAssetKind.StudyLecture],
    limit: 24
  });
  const result = await completeFreshGeneratedContent({
    context,
    promptCode: BusinessTutorPromptCode.StudyLecture,
    payload: { module, topic, request: userRequest },
    variationKind: GenerationVariationKind.StudyLecture,
    seed: `${task.id}:${module}:${topic}`,
    recentItems: learningAssetReferences(recentAssets),
    options: { temperature: 0.55 }
  });
  await context.update(82, '生成精讲内容');
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.StudyLecture,
    businessKey: `study:${module}:${topic}`,
    title: `${module} · ${topic}`,
    payload: {
      module,
      topic,
      content: normalizeMarkdownSource(result),
      ...(capabilityNodeId ? { capabilityNodeId } : {})
    }
  });
  await context.setResult({
    resultRef: saved.id,
    payload: { assetId: saved.id, module, topic, ...(capabilityNodeId ? { capabilityNodeId } : {}) }
  });
  await context.update(94, '考点精讲已生成');
};
