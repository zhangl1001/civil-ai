import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { LearningEvent } from '@/domain/learning';

export class LearningEventRepository {
  async listByProject(projectId: string): Promise<LearningEvent[]> {
    return database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectId', projectId);
  }

  async listByDate(projectId: string, date: string): Promise<LearningEvent[]> {
    return database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectDate', [projectId, date]);
  }

  async save(event: LearningEvent): Promise<void> {
    await database.put<LearningEvent>(STORES.learningEvents, event);
  }
}

export const learningEventRepository = new LearningEventRepository();
