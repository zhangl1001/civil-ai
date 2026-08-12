import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { ExamCycleId, JsonObject } from '@/kernel/public';
import {
  LearningAssetKind,
  LearningAssetStatus,
  type LearningAssetRecord
} from '@/modules/content/public';
import type { EssayContext } from './EssayFlowService';
import { essayQuestionSetBusinessKey, normalizeEssayQuestionSetMode } from '@/domain/essayQuestionSet';

export interface EssayQuestionRecord {
  id: string;
  title: string;
  material: string;
  requirement: string;
  lecture?: EssayLecture;
}

export interface EssayLecture {
  knowledgePoint: string;
  title: string;
  summary: string;
  clues: string[];
  methods: string[];
  structure: string[];
  warnings: string[];
  cases: string[];
  drills: string[];
}

export interface EssayHistoryRecord {
  id: string;
  questionId: string;
  title: string;
  content: string;
  feedback: string;
  score?: number;
  dimensions?: EssayFeedbackDimension[];
  suggestions?: string[];
  wordCount: number;
  createdAt: number;
}

export interface EssayFeedbackDimension {
  name: string;
  score?: number;
  comment: string;
}

export interface EssayLocalState {
  question: EssayQuestionRecord | null;
  draft: string;
  feedback: string | null;
  history: EssayHistoryRecord[];
  updatedAt: number;
}

export interface EssayStateHistoryItem {
  key: string;
  context: EssayContext;
  state: EssayLocalState;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeContext(context?: EssayContext): EssayContext {
  return context ?? { date: today(), topic: '申论', type: 'short' };
}

function businessKey(context: EssayContext): string {
  return essayQuestionSetBusinessKey(context);
}

function asQuestion(value: unknown): EssayQuestionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const question = value as Partial<EssayQuestionRecord>;
  if (!question.id || !question.title || !question.material || !question.requirement) return null;
  return question as EssayQuestionRecord;
}

function asDimensions(value: unknown): EssayFeedbackDimension[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is EssayFeedbackDimension => (
    Boolean(item)
    && typeof item === 'object'
    && typeof (item as EssayFeedbackDimension).name === 'string'
    && typeof (item as EssayFeedbackDimension).comment === 'string'
  ));
}

function historyFromAsset(asset: LearningAssetRecord): EssayHistoryRecord | undefined {
  const question = asQuestion(asset.payload.question);
  const content = typeof asset.payload.content === 'string' ? asset.payload.content : '';
  const feedback = typeof asset.payload.feedback === 'string' ? asset.payload.feedback : '';
  if (!question || !content || !feedback) return undefined;
  return {
    id: asset.id,
    questionId: question.id,
    title: question.title,
    content,
    feedback,
    score: typeof asset.payload.score === 'number' ? asset.payload.score : undefined,
    dimensions: asDimensions(asset.payload.dimensions),
    suggestions: Array.isArray(asset.payload.suggestions) ? asset.payload.suggestions.map(String) : undefined,
    wordCount: typeof asset.payload.wordCount === 'number' ? asset.payload.wordCount : content.length,
    createdAt: asset.createdAt
  };
}

export class EssayRepository {
  constructor(private readonly runtimeProvider: () => Promise<TutorDatabaseRuntime> = defaultRuntimeProvider) {}

  async getState(context?: EssayContext): Promise<EssayLocalState> {
    const normalized = normalizeContext(context);
    const key = businessKey(normalized);
    const { runtime, examCycleId } = await this.activeCycle();
    const [questionAsset, draftAsset, attemptAssets] = await Promise.all([
      runtime.learningAssetStore.findLatest(examCycleId, LearningAssetKind.EssayQuestion, key),
      runtime.learningAssetStore.findLatest(examCycleId, LearningAssetKind.EssayDraft, key),
      runtime.learningAssetStore.list({
        examCycleId,
        kinds: [LearningAssetKind.EssayAttempt],
        businessKey: key,
        status: LearningAssetStatus.Ready,
        limit: 20
      })
    ]);
    const question = asQuestion(questionAsset?.payload.question);
    const history = attemptAssets.map(historyFromAsset).filter((item): item is EssayHistoryRecord => Boolean(item));
    return {
      question,
      draft: typeof draftAsset?.payload.draft === 'string'
        ? draftAsset.payload.draft
        : history[0]?.content || '',
      feedback: history[0]?.feedback || null,
      history,
      updatedAt: Math.max(questionAsset?.updatedAt || 0, draftAsset?.updatedAt || 0, history[0]?.createdAt || 0)
    };
  }

  async saveDraft(draft: string, context?: EssayContext): Promise<EssayLocalState> {
    const normalized = normalizeContext(context);
    const { runtime, examCycleId } = await this.activeCycle();
    await runtime.learningAssetStore.saveDraft({
      examCycleId,
      kind: LearningAssetKind.EssayDraft,
      businessKey: businessKey(normalized),
      title: `${normalized.topic}草稿 · ${normalized.date}`,
      payload: { draft, essayContext: normalized } as unknown as JsonObject
    });
    return this.getState(normalized);
  }

  async saveQuestion(question: EssayQuestionRecord, context?: EssayContext): Promise<EssayLocalState> {
    const normalized = normalizeContext(context);
    const { runtime, examCycleId } = await this.activeCycle();
    await runtime.learningAssetStore.save({
      examCycleId,
      kind: LearningAssetKind.EssayQuestion,
      businessKey: businessKey(normalized),
      title: question.title,
      payload: { question, essayContext: normalized } as unknown as JsonObject
    });
    await runtime.learningAssetStore.retireBusinessKey(
      examCycleId,
      LearningAssetKind.EssayDraft,
      businessKey(normalized)
    );
    return this.getState(normalized);
  }

  async saveFeedback(
    content: string,
    feedback: string,
    structured?: {
      score?: number;
      dimensions?: EssayFeedbackDimension[];
      suggestions?: string[];
    },
    context?: EssayContext
  ): Promise<EssayLocalState> {
    const normalized = normalizeContext(context);
    const current = await this.getState(normalized);
    if (!current.question) throw new Error('当前没有申论题目，无法保存批改记录');
    const { runtime, examCycleId } = await this.activeCycle();
    await runtime.learningAssetStore.save({
      examCycleId,
      kind: LearningAssetKind.EssayAttempt,
      businessKey: businessKey(normalized),
      title: `${current.question.title} · 批改`,
      payload: {
        question: current.question,
        content,
        feedback,
        score: structured?.score,
        dimensions: structured?.dimensions,
        suggestions: structured?.suggestions,
        wordCount: content.length,
        essayContext: normalized
      } as unknown as JsonObject
    });
    await this.saveDraft(content, normalized);
    return this.getState(normalized);
  }

  async resetDraft(context?: EssayContext): Promise<EssayLocalState> {
    return this.saveDraft('', context);
  }

  async deleteState(context?: EssayContext): Promise<EssayLocalState> {
    const normalized = normalizeContext(context);
    const { runtime, examCycleId } = await this.activeCycle();
    await Promise.all([
      runtime.learningAssetStore.retireBusinessKey(examCycleId, LearningAssetKind.EssayQuestion, businessKey(normalized)),
      runtime.learningAssetStore.retireBusinessKey(examCycleId, LearningAssetKind.EssayDraft, businessKey(normalized)),
      runtime.learningAssetStore.retireBusinessKey(examCycleId, LearningAssetKind.EssayAttempt, businessKey(normalized))
    ]);
    return this.getState(normalized);
  }

  async listStates(): Promise<EssayStateHistoryItem[]> {
    const { runtime, examCycleId } = await this.activeCycle();
    const assets = await runtime.learningAssetStore.list({
      examCycleId,
      kinds: [LearningAssetKind.EssayQuestion],
      status: LearningAssetStatus.Ready,
      limit: 200
    });
    const latest = new Map<string, LearningAssetRecord>();
    assets.forEach((asset) => {
      if (!latest.has(asset.businessKey)) latest.set(asset.businessKey, asset);
    });
    const items = Array.from(latest.values()).map((asset) => {
      const rawContext = asset.payload.essayContext;
      const record = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
        ? rawContext as Record<string, unknown>
        : {};
      const itemContext: EssayContext = {
        questionSetId: asset.businessKey,
        date: typeof record.date === 'string' ? record.date : today(),
        topic: typeof record.topic === 'string' ? record.topic : '申论',
        type: record.type === 'long' ? 'long' : 'short',
        entryMode: normalizeEssayQuestionSetMode(record.entryMode)
      };
      return {
        key: asset.businessKey,
        context: itemContext,
        state: {
          question: asQuestion(asset.payload.question),
          draft: '',
          feedback: null,
          history: [],
          updatedAt: asset.updatedAt
        }
      };
    });
    return items.sort((left, right) => right.state.updatedAt - left.state.updatedAt);
  }

  private async activeCycle(): Promise<{ runtime: TutorDatabaseRuntime; examCycleId: ExamCycleId }> {
    const runtime = await this.runtimeProvider();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    return { runtime, examCycleId: cycle.examCycle.id };
  }
}

async function defaultRuntimeProvider(): Promise<TutorDatabaseRuntime> {
  const { initializeTutorRuntime } = await import('@/composition-root/public');
  return initializeTutorRuntime();
}

export const essayRepository = new EssayRepository();
