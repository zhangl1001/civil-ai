import {
  holdsLearningRecords,
  LearningDataPresentError,
  LearningDataSnapshotError,
  TransactionWorkload
} from '@/capabilities/database/public';
import type { TutorDatabaseRuntime } from '@/composition-root/database/TutorDatabaseRuntime';
import type { CandidateCycleBundle } from '@/modules/candidate/public';
import { isMistakenAttempt } from '@/modules/evidence/public';
import {
  DATA_BACKUP_APP,
  DATA_BACKUP_VERSION,
  DataBackupError,
  parseDataBackup,
  type ConversationBackup,
  type DataBackup,
  type ImportableDataBackup
} from './DataBackupFormat';
import {
  collectLegacyLearningRecords,
  restoreLegacyLearningRecords,
  type LegacyLearningRuntime
} from './LegacyLearningBackup';

export type DataBackupRuntime = LegacyLearningRuntime & Pick<
  TutorDatabaseRuntime,
  'unitOfWork' | 'candidateRepository' | 'conversationStore' | 'activateExamPack'
>;

export interface DataSummary {
  projectName: string;
  storageText: string;
  files: number;
  questions: number;
  sessions: number;
  wrongItems: number;
  events: number;
  aiSessions: number;
}

interface RestoredLearning {
  readonly runtime: DataBackupRuntime;
  readonly current?: CandidateCycleBundle;
  readonly restored: number;
}

const anotherCycle = '备份属于另一个备考周期；当前版本不合并不同考生或考试周期';

const legacyBackupWouldDropData = '这是旧版（v2）备份，只包含题组、作答和计划等部分记录；当前备考周期已有学习数据，'
  + '直接导入会永久丢失错因确认、学习进度等旧备份没有的记录。请先导出一份新备份留存，'
  + '再在「数据管理」中清空学习数据后导入这份旧备份。';

/** Export, import and cleanup of the active cycle's local data. */
export class DataBackupService {
  constructor(private readonly loadRuntime: () => Promise<DataBackupRuntime>) {}

  async exportActiveProject(): Promise<DataBackup> {
    const runtime = await this.loadRuntime();
    const candidate = await requireCurrentCycle(runtime);
    const [learning, conversations] = await Promise.all([
      runtime.dataMaintenance.exportLearningData(candidate.examCycle.id),
      collectConversations(runtime, candidate.project.id)
    ]);
    return {
      app: DATA_BACKUP_APP,
      version: DATA_BACKUP_VERSION,
      exportedAt: Date.now(),
      project: { id: candidate.project.id, name: candidate.project.name },
      candidate,
      learning,
      conversations
    };
  }

  /**
   * Checks that can refuse the file run before any conversation log is touched;
   * then conversations are staged and roll back if the learning transaction,
   * which repeats those checks, cannot commit.
   */
  async importBackup(input: unknown): Promise<number> {
    // A backup is JSON by definition. Re-reading it as plain data drops any
    // wrapper the caller put around it (a Vue ref makes it a reactive Proxy),
    // which IndexedDB cannot structured-clone.
    const backup = parseDataBackup(plainJson(input));
    const runtime = await this.loadRuntime();
    await assertRestorable(runtime, backup).catch((error: unknown) => {
      throw importFailure(error);
    });
    let learning: RestoredLearning | undefined;
    let conversationCount: number;
    try {
      conversationCount = await runtime.conversationStore.replaceProjectConversations(
        backup.project.id, backup.conversations.sessions, backup.conversations.messages,
        async () => { learning = await this.restoreLearning(runtime, backup); }
      );
    } catch (error) {
      throw error instanceof AggregateError ? conversationRollbackFailure(error) : importFailure(error);
    }
    if (!learning) throw new DataBackupError('备份恢复未提交，请重新导入');
    const { current, restored } = learning;
    // A first import created the cycle, so point the runtime at its exam track as onboarding does.
    const activationError = current
      ? undefined
      : await runtime.activateExamPack().then(() => undefined, (error: unknown) => error);
    if (activationError) {
      throw new DataBackupError(
        `备份已导入，但未能切换到该备份的考试类型，请重启应用${technicalDetail(activationError)}`,
        { cause: activationError }
      );
    }
    return restored + conversationCount;
  }

  async getSummary(): Promise<DataSummary> {
    const runtime = await this.loadRuntime();
    const candidate = await requireCurrentCycle(runtime);
    const [learning, conversations] = await Promise.all([
      collectLegacyLearningRecords(runtime, candidate.examCycle.id),
      collectConversations(runtime, candidate.project.id)
    ]);
    const questions = learning.questionSets.reduce((sum, bundle) => sum + bundle.questions.length, 0);
    const wrongItems = learning.sessions.reduce((sum, facts) => (
      sum + facts.attempts.filter((attempt) => isMistakenAttempt(attempt.result)).length
    ), 0);
    return {
      projectName: candidate.project.name,
      storageText: bytesText(estimateBytes({ candidate, learning, conversations })),
      files: learning.assets.length,
      questions,
      sessions: learning.sessions.length,
      wrongItems,
      events: learning.sessions.length + learning.diagnoses.length + learning.evidence.length,
      aiSessions: conversations.sessions.length
    };
  }

  async clearLearningData(): Promise<number> {
    const runtime = await this.loadRuntime();
    const candidate = await runtime.candidateRepository.findCurrentCycle();
    if (!candidate) return 0;
    return runtime.dataMaintenance.clearLearningData(candidate.examCycle.id);
  }

  private async restoreLearning(runtime: DataBackupRuntime, backup: ImportableDataBackup): Promise<RestoredLearning> {
    // Read again: the cycle may have changed while conversations were staged.
    const current = await currentCycleFor(runtime, backup);
    const examCycleId = backup.candidate.examCycle.id;
    return runtime.unitOfWork.run(async (context) => {
      let restored = 0;
      if (current) {
        // Holds at commit, so learning data written since assertRestorable still refuses a v2 file.
        if (backup.version !== DATA_BACKUP_VERSION) await runtime.dataMaintenance.requireNoLearningData(examCycleId, context);
        await runtime.dataMaintenance.clearLearningData(examCycleId, context);
      } else {
        await runtime.candidateRepository.createCycleBundle(backup.candidate, context);
        restored += 1;
      }
      restored += backup.version === DATA_BACKUP_VERSION
        ? await runtime.dataMaintenance.restoreLearningData(examCycleId, backup.learning, context)
        : await restoreLegacyLearningRecords(runtime, examCycleId, backup.learning, context);
      return { runtime, current, restored };
    }, { workload: TransactionWorkload.Maintenance }).catch((error: unknown) => {
      throw error instanceof LearningDataPresentError ? new DataBackupError(legacyBackupWouldDropData, { cause: error }) : error;
    });
  }
}

/** Refusals that need no write: they must leave conversations and learning data untouched. */
async function assertRestorable(runtime: DataBackupRuntime, backup: ImportableDataBackup): Promise<void> {
  const current = await currentCycleFor(runtime, backup);
  if (!current || backup.version === DATA_BACKUP_VERSION) return;
  const learning = await runtime.dataMaintenance.exportLearningData(current.examCycle.id);
  if (holdsLearningRecords(Object.values(learning.records))) throw new DataBackupError(legacyBackupWouldDropData);
}

async function currentCycleFor(
  runtime: DataBackupRuntime,
  backup: ImportableDataBackup
): Promise<CandidateCycleBundle | undefined> {
  const current = await runtime.candidateRepository.findCurrentCycle();
  if (current && current.examCycle.id !== backup.candidate.examCycle.id) throw new DataBackupError(anotherCycle);
  return current;
}

async function requireCurrentCycle(runtime: DataBackupRuntime): Promise<CandidateCycleBundle> {
  const candidate = await runtime.candidateRepository.findCurrentCycle();
  if (!candidate) throw new DataBackupError('请先建立备考档案');
  return candidate;
}

async function collectConversations(runtime: DataBackupRuntime, projectId: string): Promise<ConversationBackup> {
  const sessions = await runtime.conversationStore.listSessions(projectId);
  const groups = await Promise.all(sessions.map((session) => runtime.conversationStore.listMessages(session.id)));
  return { sessions: [...sessions], messages: groups.flatMap((items) => [...items]) };
}

/** Internal invariant and storage errors are wrapped: the import rolled back, which is what the user needs to know. */
function importFailure(error: unknown): Error {
  if (error instanceof DataBackupError || error instanceof LearningDataSnapshotError) return error;
  return new DataBackupError(`导入失败，本地学习数据保持原样${technicalDetail(error)}`, { cause: error });
}

/** Learning data never committed, but the conversation logs could not be put back as they were. */
function conversationRollbackFailure(error: AggregateError): DataBackupError {
  return new DataBackupError(
    `导入失败，学习数据保持原样，但对话记录未能完整恢复到导入前的状态；请保留备份并重新启动应用${technicalDetail(error.errors[error.errors.length - 1] ?? error)}`,
    { cause: error }
  );
}

function technicalDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message ? `（原因：${message.slice(0, 160)}）` : '';
}

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function estimateBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return typeof Blob === 'undefined' ? json.length : new Blob([json]).size;
}

function plainJson(input: unknown): unknown {
  return input === undefined ? input : JSON.parse(JSON.stringify(input)) as unknown;
}
