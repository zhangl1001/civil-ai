import type { LearningDataSnapshot } from '@/capabilities/database/public';
import type { CandidateCycleBundle } from '@/modules/candidate/public';
import type { CommittedQuestionSetBundle, LearningAssetRecord } from '@/modules/content/public';
import { assertRestorableQuestionSetBundle } from '@/modules/content/domain/ContentBundlePolicy';
import type { ConversationMessage, ConversationSession } from '@/modules/conversation/public';
import type {
  ErrorDiagnosisRecord,
  LearningEvidenceRecord,
  ObjectiveSessionFacts
} from '@/modules/evidence/public';
import type { MasteryTrack, ReviewQueueItem } from '@/modules/mastery/public';
import type { DailyPlanAggregate } from '@/modules/planning/public';
import type { LearningThreadAggregate } from '@/modules/teaching/public';

export const DATA_BACKUP_APP = 'zhangl-agent';
export const DATA_BACKUP_VERSION = 3;

/** A failure worded for the person importing or exporting; shown as is. */
export class DataBackupError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'DataBackupError';
  }
}

/** The business records a v2 backup carried; everything else a cycle holds is missing from it. */
export interface LegacyLearningRecords {
  threads: LearningThreadAggregate[];
  questionSets: CommittedQuestionSetBundle[];
  sessions: ObjectiveSessionFacts[];
  diagnoses: ErrorDiagnosisRecord[];
  evidence: LearningEvidenceRecord[];
  masteryTracks: MasteryTrack[];
  reviewQueue: ReviewQueueItem[];
  dailyPlans: DailyPlanAggregate[];
  assets: LearningAssetRecord[];
}

export interface ConversationBackup {
  sessions: ConversationSession[];
  messages: ConversationMessage[];
}

interface DataBackupEnvelope {
  app: typeof DATA_BACKUP_APP;
  exportedAt: number;
  project: { id: string; name: string };
  candidate: CandidateCycleBundle;
  conversations: ConversationBackup;
}

/** Every record clearLearningData removes, exactly as the local database stores it. */
export interface DataBackup extends DataBackupEnvelope {
  version: typeof DATA_BACKUP_VERSION;
  learning: LearningDataSnapshot;
}

export interface LegacyDataBackup extends DataBackupEnvelope {
  version: 2;
  learning: LegacyLearningRecords;
}

export type ImportableDataBackup = DataBackup | LegacyDataBackup;

const legacyLearningFields = [
  'threads', 'questionSets', 'sessions', 'diagnoses', 'evidence',
  'masteryTracks', 'reviewQueue', 'dailyPlans', 'assets'
] as const;

export function parseDataBackup(input: unknown): ImportableDataBackup {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DataBackupError('备份文件格式不正确');
  const value = input as Partial<ImportableDataBackup>;
  if (value.app !== DATA_BACKUP_APP || (value.version !== DATA_BACKUP_VERSION && value.version !== 2)) {
    throw new DataBackupError('仅支持 v2、v3 业务快照，不兼容旧 Markdown/旧数据库备份');
  }
  if (!value.candidate || !value.learning || !value.conversations) throw new DataBackupError('备份文件缺少考生、学习或对话数据');
  const backup = value as ImportableDataBackup;
  const cycleId = requiredText(record(backup.candidate).examCycle, 'candidate.examCycle', 'id');
  const projectId = requiredText(record(backup.candidate).project, 'candidate.project', 'id');
  if (requiredText(backup.project, 'project', 'id') !== projectId) throw new DataBackupError('备份项目标识不一致');
  if (backup.version === DATA_BACKUP_VERSION) {
    assertSnapshotShape(backup.learning);
  } else {
    assertLegacyLearning(backup.learning, cycleId);
  }
  assertArrayFields(backup.conversations, ['sessions', 'messages']);
  const sessionIds = new Set(backup.conversations.sessions.map((session) => {
    if (session.projectId !== projectId || !session.id) throw new DataBackupError('备份会话不属于当前项目');
    return session.id;
  }));
  backup.conversations.messages.forEach((message) => {
    if (!message.id || !sessionIds.has(message.sessionId)) throw new DataBackupError('备份消息引用了不存在的会话');
  });
  return backup;
}

/** Record ownership is checked by the storage adapter, which knows how each table links to the cycle. */
function assertSnapshotShape(value: unknown): void {
  const snapshot = record(value);
  if (typeof snapshot.storage !== 'string' || !Number.isInteger(snapshot.schemaVersion)) {
    throw new DataBackupError('备份缺少学习数据的存储类型或数据版本');
  }
  for (const field of ['records', 'references']) {
    Object.entries(record(snapshot[field])).forEach(([group, rows]) => {
      if (!Array.isArray(rows)) throw new DataBackupError(`备份中的 ${group} 数据必须是数组`);
    });
  }
}

function assertLegacyLearning(value: LegacyLearningRecords, cycleId: string): void {
  assertArrayFields(value, legacyLearningFields);
  value.threads.forEach((item) => assertCycle(record(item).thread, cycleId, 'learning.thread'));
  value.questionSets.forEach((item) => {
    try {
      assertRestorableQuestionSetBundle(item);
    } catch (error) {
      throw new DataBackupError(`备份中的题组 ${String(record(item.questionSet).id ?? '')} 结构不完整，无法恢复`, { cause: error });
    }
    assertCycle(item.questionSet, cycleId, 'learning.questionSet');
  });
  value.sessions.forEach((item) => assertCycle(item.session, cycleId, 'learning.session'));
  value.diagnoses.forEach((item) => assertCycle(item, cycleId, 'learning.diagnosis'));
  value.evidence.forEach((item) => assertCycle(item, cycleId, 'learning.evidence'));
  value.masteryTracks.forEach((item) => assertCycle(item, cycleId, 'learning.masteryTrack'));
  value.reviewQueue.forEach((item) => assertCycle(item, cycleId, 'learning.reviewQueue'));
  value.dailyPlans.forEach((item) => assertCycle(item.plan, cycleId, 'learning.dailyPlan'));
  value.assets.forEach((item) => assertCycle(item, cycleId, 'learning.asset'));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataBackupError('备份对象结构不正确');
  return value as Record<string, unknown>;
}

function requiredText(parent: unknown, label: string, key: string): string {
  const value = record(parent)[key];
  if (typeof value !== 'string' || !value.trim()) throw new DataBackupError(`${label}.${key} 缺失`);
  return value;
}

function assertArrayFields(parent: unknown, fields: readonly string[]): void {
  const value = record(parent);
  fields.forEach((field) => {
    if (!Array.isArray(value[field])) throw new DataBackupError(`备份字段 ${field} 必须是数组`);
  });
}

function assertCycle(value: unknown, cycleId: string, label: string): void {
  if (requiredText(value, label, 'examCycleId') !== cycleId) throw new DataBackupError(`${label} 不属于当前备考周期`);
}
