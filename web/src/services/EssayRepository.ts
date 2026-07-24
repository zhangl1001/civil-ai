import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { LearningEvent } from '@/domain/learning';
import { abilityDiagnosisService } from './AbilityDiagnosisService';
import { projectRepository } from '@/services/ProjectRepository';
import { settingsService } from '@/services/SettingsService';
import type { EssayContext } from './EssayFlowService';

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

function stateKey(projectId: string, context?: EssayContext): string {
  if (!context) return `essay:state:${projectId}`;
  return `essay:state:${projectId}:${context.topic}:${context.date}`;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeQuestion(question: EssayQuestionRecord): EssayQuestionRecord {
  return { ...question };
}

export class EssayRepository {
  async getState(context?: EssayContext): Promise<EssayLocalState> {
    const project = await projectRepository.getActiveProject();
    const existing = await settingsService.get<EssayLocalState | null>(stateKey(project.id, context), null);
    if (existing?.question) {
      const normalizedQuestion = normalizeQuestion(existing.question);
      return { ...existing, question: normalizedQuestion };
    }
    return {
      question: null,
      draft: '',
      feedback: null,
      history: [],
      updatedAt: Date.now()
    };
  }

  async saveDraft(draft: string, context?: EssayContext): Promise<EssayLocalState> {
    const project = await projectRepository.getActiveProject();
    const current = await this.getState(context);
    const next: EssayLocalState = {
      ...current,
      draft,
      updatedAt: Date.now()
    };
    await settingsService.set(stateKey(project.id, context), next);
    return next;
  }

  async saveQuestion(question: EssayQuestionRecord, context?: EssayContext): Promise<EssayLocalState> {
    const project = await projectRepository.getActiveProject();
    const current = await this.getState(context);
    const next: EssayLocalState = {
      ...current,
      question: normalizeQuestion(question),
      draft: '',
      feedback: null,
      updatedAt: Date.now()
    };
    await settingsService.set(stateKey(project.id, context), next);
    return next;
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
    const project = await projectRepository.getActiveProject();
    const current = await this.getState(context);
    if (!current.question) throw new Error('当前没有申论题目，无法保存批改记录');
    const now = Date.now();
    const historyItem: EssayHistoryRecord = {
      id: id('essay_history'),
      questionId: current.question.id,
      title: current.question.title,
      content,
      feedback,
      score: structured?.score,
      dimensions: structured?.dimensions,
      suggestions: structured?.suggestions,
      wordCount: content.length,
      createdAt: now
    };
    const next: EssayLocalState = {
      ...current,
      draft: content,
      feedback,
      history: [historyItem, ...current.history].slice(0, 10),
      updatedAt: now
    };
    await settingsService.set(stateKey(project.id, context), next);
    await database.put<LearningEvent>(STORES.learningEvents, {
      id: id('learning_event'),
      projectId: project.id,
      type: 'essay',
      module: '申论',
      date: context?.date || today(),
      total: 1,
      correct: 1,
      accuracy: 100,
      sourceRef: historyItem.id,
      createdAt: now
    });
    void abilityDiagnosisService.refreshProject(project.id).catch((error) => {
      console.warn('[ability diagnosis refresh]', error);
    });
    return next;
  }

  async resetDraft(context?: EssayContext): Promise<EssayLocalState> {
    return this.saveDraft('', context);
  }

  async deleteState(context?: EssayContext): Promise<EssayLocalState> {
    const project = await projectRepository.getActiveProject();
    await settingsService.delete(stateKey(project.id, context));
    return this.getState(context);
  }

  async listStates(): Promise<EssayStateHistoryItem[]> {
    const project = await projectRepository.getActiveProject();
    const prefix = `essay:state:${project.id}:`;
    const records = await database.list<{ key: string; value: unknown; updatedAt?: number }>(STORES.settings);
    return records
      .filter((record) => record.key.startsWith(prefix))
      .map((record) => {
        const rest = record.key.slice(prefix.length);
        const parts = rest.split(':');
        const topic = parts.slice(0, -1).join(':') || '申论';
        const date = parts.at(-1) || today();
        return {
          key: record.key,
          context: {
            topic,
            date,
            type: topic === '申发论述' ? 'long' as const : 'short' as const
          },
          state: record.value as EssayLocalState
        };
      })
      .filter((item) => item.state?.question)
      .sort((a, b) => (b.state.updatedAt || 0) - (a.state.updatedAt || 0));
  }
}

export const essayRepository = new EssayRepository();
