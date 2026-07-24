import { database, type DatabaseOperation } from '@/db/database';
import { STORES, type StoreName } from '@/db/schema';
import { projectRepository } from './ProjectRepository';
import { settingsService } from './SettingsService';

type DbRecord = Record<string, unknown>;

export interface DataBackup {
  app: 'zhangl-agent';
  version: number;
  exportedAt: number;
  project: {
    id: string;
    name: string;
  };
  stores: Partial<Record<StoreName, DbRecord[]>>;
}

export interface DataSummary {
  projectName: string;
  storageText: string;
  files: number;
  questions: number;
  sessions: number;
  wrongItems: number;
  events: number;
  aiSessions: number;
  tasks: number;
}

const PROJECT_SCOPED_STORES = [
  STORES.files,
  STORES.questions,
  STORES.practiceSessions,
  STORES.wrongItems,
  STORES.abilityProfiles,
  STORES.learningEvents,
  STORES.digestItems,
  STORES.interviewSessions,
  STORES.aiSessions,
  STORES.aiTasks
] as const;

const CLEAR_LEARNING_STORES = [
  STORES.questions,
  STORES.practiceSessions,
  STORES.wrongItems,
  STORES.abilityProfiles,
  STORES.learningEvents,
  STORES.digestItems,
  STORES.interviewSessions,
  STORES.aiTasks
] as const;

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function estimateBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return JSON.stringify(value ?? '').length;
  }
}

function deleteOps(storeName: StoreName, records: DbRecord[]): DatabaseOperation[] {
  return records
    .map((record) => record.id ?? record.key)
    .filter((key): key is string | number => typeof key === 'string' || typeof key === 'number')
    .map((key) => ({ type: 'delete', storeName, key }));
}

export class DataManagementService {
  async exportActiveProject(): Promise<DataBackup> {
    const project = await projectRepository.getActiveProject();
    const stores: Partial<Record<StoreName, DbRecord[]>> = {
      [STORES.projects]: [project as unknown as DbRecord]
    };

    for (const storeName of PROJECT_SCOPED_STORES) {
      stores[storeName] = await database.queryByIndex<DbRecord>(storeName, 'projectId', project.id);
    }

    const sessionIds = new Set((stores[STORES.practiceSessions] || []).map((item) => item.id).filter(Boolean));
    stores[STORES.answers] = (await database.list<DbRecord>(STORES.answers))
      .filter((answer) => sessionIds.has(answer.sessionId));

    const aiSessionIds = new Set((stores[STORES.aiSessions] || []).map((item) => item.id).filter(Boolean));
    stores[STORES.aiMessages] = (await database.list<DbRecord>(STORES.aiMessages))
      .filter((message) => aiSessionIds.has(message.sessionId));

    const taskIds = new Set((stores[STORES.aiTasks] || []).map((item) => item.id).filter(Boolean));
    stores[STORES.taskLogs] = (await database.list<DbRecord>(STORES.taskLogs))
      .filter((log) => taskIds.has(log.taskId));

    return {
      app: 'zhangl-agent',
      version: 1,
      exportedAt: Date.now(),
      project: {
        id: project.id,
        name: project.name
      },
      stores
    };
  }

  async importBackup(backup: DataBackup): Promise<number> {
    if (!backup || backup.app !== 'zhangl-agent' || !backup.project?.id || !backup.stores) {
      throw new Error('备份文件格式不正确');
    }

    const operations: DatabaseOperation[] = [];
    for (const storeName of Object.values(STORES)) {
      const rows = backup.stores[storeName];
      if (Array.isArray(rows) && rows.length) {
        operations.push({ type: 'putMany', storeName, values: rows });
      }
    }
    await database.transaction(operations);
    await settingsService.set('activeProjectId', backup.project.id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('zhangl-active-project', backup.project.name);
    }
    return operations.reduce((total, op) => total + (op.type === 'putMany' ? op.values.length : 1), 0);
  }

  async getSummary(): Promise<DataSummary> {
    const backup = await this.exportActiveProject();
    const stores = backup.stores;
    const bytes = estimateBytes(backup);
    return {
      projectName: backup.project.name,
      storageText: bytesText(bytes),
      files: stores[STORES.files]?.length || 0,
      questions: stores[STORES.questions]?.length || 0,
      sessions: stores[STORES.practiceSessions]?.length || 0,
      wrongItems: stores[STORES.wrongItems]?.length || 0,
      events: stores[STORES.learningEvents]?.length || 0,
      aiSessions: stores[STORES.aiSessions]?.length || 0,
      tasks: stores[STORES.aiTasks]?.length || 0
    };
  }

  async clearLearningData(): Promise<number> {
    const project = await projectRepository.getActiveProject();
    const operations: DatabaseOperation[] = [];

    const sessions = await database.queryByIndex<DbRecord>(STORES.practiceSessions, 'projectId', project.id);
    const sessionIds = new Set(sessions.map((session) => session.id).filter(Boolean));
    operations.push(...deleteOps(STORES.answers, (await database.list<DbRecord>(STORES.answers)).filter((answer) => sessionIds.has(answer.sessionId))));

    const aiTasks = await database.queryByIndex<DbRecord>(STORES.aiTasks, 'projectId', project.id);
    const taskIds = new Set(aiTasks.map((task) => task.id).filter(Boolean));
    operations.push(...deleteOps(STORES.taskLogs, (await database.list<DbRecord>(STORES.taskLogs)).filter((log) => taskIds.has(log.taskId))));

    for (const storeName of CLEAR_LEARNING_STORES) {
      const records = storeName === STORES.practiceSessions
        ? sessions
        : storeName === STORES.aiTasks
          ? aiTasks
          : await database.queryByIndex<DbRecord>(storeName, 'projectId', project.id);
      operations.push(...deleteOps(storeName, records));
    }

    await database.transaction(operations);
    return operations.length;
  }
}

export const dataManagementService = new DataManagementService();
