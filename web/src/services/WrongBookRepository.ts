import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { WrongItem, WrongStatus } from '@/domain/wrongbook';
import { projectRepository } from '@/services/ProjectRepository';
import { questionRepository, type PracticeQuestion } from '@/services/QuestionRepository';
import { practiceFlowService } from './PracticeFlowService';

export interface WrongBookEntry {
  item: WrongItem;
  question?: PracticeQuestion;
}

interface ListWrongOptions {
  module?: string;
  status?: WrongStatus;
  reason?: string;
  scope?: 'all' | 'due' | 'highFrequency';
  sort?: 'recent' | 'wrongCount' | 'due';
  limit?: number;
}

export class WrongBookRepository {
  async modules(): Promise<string[]> {
    const project = await projectRepository.getActiveProject();
    const rows = await database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id);
    return Array.from(new Set(rows.map((item) => item.module).filter(Boolean) as string[])).sort();
  }

  async reasons(): Promise<string[]> {
    const project = await projectRepository.getActiveProject();
    const rows = await database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id);
    return Array.from(new Set(rows.map((item) => item.reason || '未分类错因').filter(Boolean))).sort();
  }

  async list(options: ListWrongOptions = {}): Promise<WrongBookEntry[]> {
    const project = await projectRepository.getActiveProject();
    const now = Date.now();
    const rows = await database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id);
    const filtered = rows
      .filter((item) => !options.module || item.module === options.module)
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.reason || (item.reason || '未分类错因') === options.reason)
      .filter((item) => options.scope !== 'due' || item.status !== 'mastered' && (!item.nextReviewAt || item.nextReviewAt <= now))
      .filter((item) => options.scope !== 'highFrequency' || item.wrongCount >= 2)
      .sort((a, b) => {
        if (options.sort === 'wrongCount') return b.wrongCount - a.wrongCount || b.updatedAt - a.updatedAt;
        if (options.sort === 'due') return (a.nextReviewAt || 0) - (b.nextReviewAt || 0) || b.wrongCount - a.wrongCount;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, options.limit || 100);

    return Promise.all(filtered.map(async (item) => ({
      item,
      question: await questionRepository.getById(item.questionId)
    })));
  }

  async markReviewing(itemId: string): Promise<void> {
    const current = await database.get<WrongItem>(STORES.wrongItems, itemId);
    if (!current) return;
    await database.put<WrongItem>(STORES.wrongItems, {
      ...current,
      status: 'reviewing',
      updatedAt: Date.now()
    });
  }

  async updateStatus(itemId: string, status: WrongStatus): Promise<void> {
    const current = await database.get<WrongItem>(STORES.wrongItems, itemId);
    if (!current) return;
    await database.put<WrongItem>(STORES.wrongItems, {
      ...current,
      status,
      nextReviewAt: status === 'mastered' ? undefined : current.nextReviewAt,
      updatedAt: Date.now()
    });
  }

  async updateReason(itemId: string, reason: string): Promise<void> {
    const current = await database.get<WrongItem>(STORES.wrongItems, itemId);
    if (!current) return;
    await database.put<WrongItem>(STORES.wrongItems, {
      ...current,
      reason: reason.trim() || '未分类错因',
      updatedAt: Date.now()
    });
  }

  async scheduleReview(itemId: string, delayDays: number): Promise<void> {
    const current = await database.get<WrongItem>(STORES.wrongItems, itemId);
    if (!current) return;
    const now = Date.now();
    await database.put<WrongItem>(STORES.wrongItems, {
      ...current,
      status: delayDays <= 0 ? 'open' : 'reviewing',
      nextReviewAt: now + Math.max(0, delayDays) * 86400000,
      updatedAt: now
    });
  }

  async deleteMany(itemIds: string[]): Promise<void> {
    await Promise.all(itemIds.map((id) => database.delete(STORES.wrongItems, id)));
  }

  async startReview(itemId: string): Promise<WrongBookEntry | null> {
    const current = await database.get<WrongItem>(STORES.wrongItems, itemId);
    if (!current) return null;
    await this.markReviewing(itemId);
    const question = await questionRepository.getById(current.questionId);
    practiceFlowService.writeStartContext({
      module: current.module || question?.module || '资料分析',
      mode: 'review',
      source: 'practice-center',
      questionCount: 10
    });
    return { item: { ...current, status: 'reviewing', updatedAt: Date.now() }, question };
  }
}

export const wrongBookRepository = new WrongBookRepository();
