import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  LearningAssetStatus,
  type LearningAssetRecord
} from '@/modules/content/public';
import {
  normalizeEssayQuestionSetMode,
  normalizeEssayQuestionSetPurpose,
  type EssayQuestionSetPurpose
} from '@/domain/essayQuestionSet';

export type EssayPracticeMode = 'tutor' | 'self' | 'true';

export interface EssayPracticeContext {
  readonly questionSetId?: string;
  readonly date: string;
  readonly topic: string;
  readonly type: 'short' | 'long';
  readonly entryMode?: EssayPracticeMode;
  readonly purpose?: EssayQuestionSetPurpose;
}

export interface EssayPracticeSet {
  readonly key: string;
  readonly updatedAt: number;
  readonly context: EssayPracticeContext;
  readonly question?: { readonly id: string; readonly title: string };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function contextFromAsset(asset: LearningAssetRecord): EssayPracticeContext {
  const raw = asset.payload.essayContext;
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    questionSetId: asset.businessKey,
    date: typeof record.date === 'string' ? record.date : today(),
    topic: typeof record.topic === 'string' ? record.topic : '申论',
    type: record.type === 'long' ? 'long' : 'short',
    entryMode: normalizeEssayQuestionSetMode(record.entryMode),
    purpose: normalizeEssayQuestionSetPurpose(record.purpose, record.entryMode)
  };
}

function questionFromAsset(asset: LearningAssetRecord): EssayPracticeSet['question'] {
  const raw = asset.payload.question;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const question = raw as Record<string, unknown>;
  return typeof question.id === 'string' && typeof question.title === 'string'
    ? { id: question.id, title: question.title }
    : undefined;
}

/** Read model for the practice-center entry list; generation commands live beside this boundary. */
export class EssayPracticeCenterFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async listSets(): Promise<readonly EssayPracticeSet[]> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return [];
    const assets = await this.runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.EssayQuestion],
      status: LearningAssetStatus.Ready,
      limit: 200
    });
    const latest = new Map<string, LearningAssetRecord>();
    for (const asset of assets) if (!latest.has(asset.businessKey)) latest.set(asset.businessKey, asset);
    return [...latest.values()]
      .filter((asset) => contextFromAsset(asset).purpose !== 'mock')
      .map((asset) => ({
        key: asset.businessKey,
        updatedAt: asset.updatedAt,
        context: contextFromAsset(asset),
        question: questionFromAsset(asset)
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt || right.key.localeCompare(left.key));
  }
}
