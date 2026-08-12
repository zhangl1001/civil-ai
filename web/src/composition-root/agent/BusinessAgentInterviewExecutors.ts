import { BusinessTutorPromptCode, parseStructuredJson } from '@/capabilities/ai-runtime/public';
import { LearningAssetKind } from '@/modules/content/public';
import type { BusinessAgentExecutor } from './BusinessAgentContracts';

const INTERVIEW_QUESTION_TYPES = new Set(['综合分析', '计划组织', '人际沟通', '应急应变', '岗位匹配']);
const INTERVIEW_DIMENSION_CODES = ['content', 'structure', 'expression', 'fluency'] as const;
const INTERVIEW_RUBRIC_VERSION = 'interview_rubric@1.0.0';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizePercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function interviewBusinessKey(sessionId: string): string {
  return `interview:${sessionId}`;
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
  const dimensions = (parsed.dimensions || []).flatMap((item) => (
    item.code && INTERVIEW_DIMENSION_CODES.includes(item.code as typeof INTERVIEW_DIMENSION_CODES[number])
      && item.name && typeof item.score === 'number' && item.comment
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
  if (!feedback || INTERVIEW_DIMENSION_CODES.some((code) => !dimensionCodes.has(code)) || !Number.isFinite(parsed.score)) {
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

function parseInterviewQuestions(text: string, taskId: string): Array<{
  id: string;
  type: string;
  text: string;
  hint: string;
}> {
  const parsed = parseStructuredJson<{
    questions?: Array<{ type?: string; text?: string; hint?: string }>;
  }>(text);
  const seen = new Set<string>();
  const questions = (parsed.questions || []).flatMap((item, index) => {
    const type = asString(item.type).trim();
    const questionText = asString(item.text).trim();
    const hint = asString(item.hint).trim();
    const fingerprint = questionText.replace(/\s+/g, '');
    if (!INTERVIEW_QUESTION_TYPES.has(type) || !questionText || !hint || seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{ id: `interview_ai:${taskId}:${index + 1}`, type, text: questionText, hint }];
  });
  if (questions.length < 3) throw new Error('面试题库生成结果缺少可用题目');
  return questions;
}

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
  try {
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
          : ''
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
          rubricVersion: INTERVIEW_RUBRIC_VERSION,
          dimensions: review.dimensions
        },
        aiSuggestions: review.suggestions,
        reviewStatus: 'completed',
        rubricVersion: INTERVIEW_RUBRIC_VERSION,
        updatedAt: Date.now()
      }
    });
    await context.recordSubjectiveAssessment({
      sourceAssetId: saved.id,
      rubricVersion: INTERVIEW_RUBRIC_VERSION,
      dimensions: INTERVIEW_DIMENSION_CODES.map((code) => {
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
      })
    });
    await context.setResult({ resultRef: saved.id, payload: { sessionId, assetId: saved.id } });
    await context.update(96, '面试点评已生成');
  } catch (error) {
    await context.saveLearningAsset({
      kind: LearningAssetKind.InterviewSession,
      businessKey: interviewBusinessKey(sessionId),
      title: asString(session.title) || `面试训练 · ${asString(session.date)}`,
      payload: { ...session, reviewStatus: 'failed', updatedAt: Date.now() }
    }).catch(() => undefined);
    throw error;
  }
};

export const interviewQuestionsExecutor: BusinessAgentExecutor = async (task, context) => {
  const requestedCount = Math.max(6, Math.min(20, Number(task.payload?.questionCount || 15)));
  const requestedTypes = Array.isArray(task.payload?.questionTypes)
    ? task.payload.questionTypes.map(String).filter((item) => INTERVIEW_QUESTION_TYPES.has(item))
    : Array.from(INTERVIEW_QUESTION_TYPES);
  const recentQuestions = Array.isArray(task.payload?.recentQuestions)
    ? task.payload.recentQuestions.map(String).filter(Boolean).slice(0, 40)
    : [];
  await context.update(20, '准备面试命题范围');
  const prompt = context.compilePrompt(BusinessTutorPromptCode.InterviewQuestions, {
    questionTypes: requestedTypes.length ? requestedTypes : Array.from(INTERVIEW_QUESTION_TYPES),
    difficulty: asString(task.payload?.difficulty) || 'mixed',
    questionCount: requestedCount,
    recentQuestions
  });
  await context.update(45, '生成结构化面试题');
  const raw = await context.complete([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], { temperature: 0.7, responseSchema: prompt.responseSchema });
  const questions = parseInterviewQuestions(raw, task.id).slice(0, requestedCount);
  await context.update(82, '更新面试训练题池');
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.InterviewQuestionPool,
    businessKey: `interview-question-pool:${task.id}`,
    title: `面试训练题池 · ${questions.length} 题`,
    payload: {
      questions,
      generatedAt: Date.now(),
      difficulty: asString(task.payload?.difficulty) || 'mixed'
    }
  });
  await context.setResult({ resultRef: saved.id, payload: { assetId: saved.id, questionCount: questions.length } });
  await context.update(96, '面试训练题池已更新');
};
