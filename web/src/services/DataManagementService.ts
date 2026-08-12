import { initializeTutorRuntime, type TutorDatabaseRuntime } from '@/composition-root/public';
import { TransactionWorkload, type TransactionContext } from '@/capabilities/database/public';
import type { LearningThreadId } from '@/kernel/public';
import type { CandidateCycleBundle } from '@/modules/candidate/public';
import type { CommittedQuestionSetBundle, LearningAssetRecord } from '@/modules/content/public';
import { assertCommittedQuestionSetBundle } from '@/modules/content/domain/ContentBundlePolicy';
import type {
  ErrorDiagnosisRecord,
  LearningEvidenceRecord,
  ObjectiveSessionFacts
} from '@/modules/evidence/public';
import type { MasteryTrack, ReviewQueueItem } from '@/modules/mastery/public';
import type { DailyPlanAggregate } from '@/modules/planning/public';
import type { LearningThreadAggregate } from '@/modules/teaching/public';
import type { ConversationMessage, ConversationSession } from '@/modules/conversation/public';

export interface DataBackup {
  app: 'zhangl-agent';
  version: 2;
  exportedAt: number;
  project: { id: string; name: string };
  candidate: CandidateCycleBundle;
  learning: {
    threads: LearningThreadAggregate[];
    questionSets: CommittedQuestionSetBundle[];
    sessions: ObjectiveSessionFacts[];
    diagnoses: ErrorDiagnosisRecord[];
    evidence: LearningEvidenceRecord[];
    masteryTracks: MasteryTrack[];
    reviewQueue: ReviewQueueItem[];
    dailyPlans: DailyPlanAggregate[];
    assets: LearningAssetRecord[];
  };
  conversations: {
    sessions: ConversationSession[];
    messages: ConversationMessage[];
  };
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
}

export class DataManagementService {
  async exportActiveProject(): Promise<DataBackup> {
    const runtime = await initializeTutorRuntime();
    const candidate = await runtime.candidateRepository.findCurrentCycle();
    if (!candidate) throw new Error('请先建立备考档案');
    const examCycleId = candidate.examCycle.id;
    const [questionSets, sessions, masteryTracks, reviewQueue, assets, conversationSessions] = await Promise.all([
      runtime.contentRepository.listAllQuestionSets(examCycleId),
      runtime.learningSessionRepository.listAll(examCycleId),
      runtime.masteryRepository.listAllTracks(examCycleId),
      runtime.masteryRepository.listAllReviews(examCycleId),
      runtime.learningAssetRepository.listAll(examCycleId),
      runtime.conversationStore.listSessions(candidate.project.id)
    ]);
    const [threads, diagnoses, evidence, messages, dailyPlans] = await Promise.all([
      collectThreads(runtime, questionSets, sessions),
      collectDiagnoses(runtime, sessions),
      runtime.learningEvidenceRepository.listAllValid(examCycleId),
      collectMessages(runtime, conversationSessions),
      runtime.dailyPlanRepository.listAll(examCycleId)
    ]);
    return {
      app: 'zhangl-agent',
      version: 2,
      exportedAt: Date.now(),
      project: { id: candidate.project.id, name: candidate.project.name },
      candidate,
      learning: {
        threads,
        questionSets: [...questionSets],
        sessions: [...sessions],
        diagnoses,
        evidence: [...evidence],
        masteryTracks: [...masteryTracks],
        reviewQueue: [...reviewQueue],
        dailyPlans: [...dailyPlans],
        assets: [...assets]
      },
      conversations: {
        sessions: [...conversationSessions],
        messages
      }
    };
  }

  async importBackup(input: unknown): Promise<number> {
    const backup = assertBackup(input);
    const runtime = await initializeTutorRuntime();
    const current = await runtime.candidateRepository.findCurrentCycle();
    if (current && current.examCycle.id !== backup.candidate.examCycle.id) {
      throw new Error('备份属于另一个备考周期；当前版本不合并不同考生或考试周期');
    }
    const previous = current ? await this.exportActiveProject() : undefined;
    let count = 0;
    let learningCommitted = false;
    try {
      count += await restoreLearningSnapshot(runtime, backup, Boolean(current));
      learningCommitted = true;
      count += await runtime.conversationStore.replaceProjectConversations(
        backup.project.id,
        backup.conversations.sessions,
        backup.conversations.messages
      );
      return count;
    } catch (error) {
      if (learningCommitted && current && previous) {
        try {
          await restoreLearningSnapshot(runtime, previous, true);
          await runtime.conversationStore.replaceProjectConversations(
            previous.project.id,
            previous.conversations.sessions,
            previous.conversations.messages
          );
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            '数据导入失败，且自动恢复未能完整完成；请保留备份并重新启动应用'
          );
        }
      }
      throw error;
    }
  }

  async getSummary(): Promise<DataSummary> {
    const backup = await this.exportActiveProject();
    const questions = backup.learning.questionSets.reduce((sum, bundle) => sum + bundle.questions.length, 0);
    const wrongItems = backup.learning.sessions.reduce((sum, facts) => (
      sum + facts.attempts.filter((attempt) => attempt.result === 'incorrect').length
    ), 0);
    return {
      projectName: backup.project.name,
      storageText: bytesText(estimateBytes(backup)),
      files: backup.learning.assets.length,
      questions,
      sessions: backup.learning.sessions.length,
      wrongItems,
      events: backup.learning.sessions.length + backup.learning.diagnoses.length + backup.learning.evidence.length,
      aiSessions: backup.conversations.sessions.length
    };
  }

  async clearLearningData(): Promise<number> {
    const runtime = await initializeTutorRuntime();
    const candidate = await runtime.candidateRepository.findCurrentCycle();
    if (!candidate) return 0;
    return runtime.dataMaintenance.clearLearningData(candidate.examCycle.id);
  }
}

async function restoreLearningSnapshot(
  runtime: TutorDatabaseRuntime,
  backup: DataBackup,
  replaceExisting: boolean
): Promise<number> {
  return runtime.unitOfWork.run(async (context) => {
    let count = 0;
    if (replaceExisting) {
      count += await runtime.dataMaintenance.clearLearningData(backup.candidate.examCycle.id, context);
    } else {
      await runtime.candidateRepository.createCycleBundle(backup.candidate, context);
      count += 1;
    }
    count += await restoreLearningRecords(runtime, backup, context);
    return count;
  }, { workload: TransactionWorkload.Maintenance });
}

async function restoreLearningRecords(
  runtime: TutorDatabaseRuntime,
  backup: DataBackup,
  context: TransactionContext
): Promise<number> {
  let count = 0;
  for (const aggregate of backup.learning.threads) {
    if (!aggregate.events.length) continue;
    await runtime.learningThreadRepository.restore(aggregate, context);
    count += 1;
  }
  for (const bundle of backup.learning.questionSets) {
    await runtime.contentRepository.commitQuestionSet(bundle, context);
    count += bundle.questions.length + 1;
  }
  for (const facts of backup.learning.sessions) {
    await runtime.learningSessionRepository.commitObjectiveSession(facts, context);
    count += facts.attempts.length + 1;
  }
  if (backup.learning.diagnoses.length) {
    await runtime.errorDiagnosisRepository.append(backup.learning.diagnoses, context);
    count += backup.learning.diagnoses.length;
  }
  if (backup.learning.evidence.length) {
    await runtime.learningEvidenceRepository.append(
      backup.learning.evidence,
      backup.learning.evidence.map((item) => ({
        evidenceId: item.id,
        validityStatus: 'valid',
        updatedAt: item.occurredAt,
        version: 1
      })),
      context
    );
    count += backup.learning.evidence.length;
  }
  for (const track of backup.learning.masteryTracks) {
    await runtime.masteryRepository.upsertTrack(track, undefined, context);
    count += 1;
  }
  for (const item of backup.learning.reviewQueue) {
    await runtime.masteryRepository.scheduleReview(item, context);
    count += 1;
  }
  for (const plan of backup.learning.dailyPlans) {
    await runtime.dailyPlanRepository.replaceCurrent(plan, undefined, context);
    count += plan.items.length + 1;
  }
  for (const asset of backup.learning.assets) {
    await runtime.learningAssetRepository.save(asset, context);
    count += 1;
  }
  return count;
}

async function collectThreads(
  runtime: TutorDatabaseRuntime,
  questionSets: readonly CommittedQuestionSetBundle[],
  sessions: readonly ObjectiveSessionFacts[]
): Promise<LearningThreadAggregate[]> {
  const ids = new Set<string>();
  questionSets.forEach((bundle) => {
    if (bundle.questionSet.learningThreadId) ids.add(bundle.questionSet.learningThreadId);
  });
  sessions.forEach((facts) => ids.add(facts.session.learningThreadId));
  const values = await Promise.all([...ids].map((id) => runtime.learningThreadRepository.findById(id as LearningThreadId)));
  return values.filter((item): item is LearningThreadAggregate => Boolean(item));
}

async function collectDiagnoses(
  runtime: TutorDatabaseRuntime,
  sessions: readonly ObjectiveSessionFacts[]
): Promise<ErrorDiagnosisRecord[]> {
  const groups = await Promise.all(sessions.map((facts) => runtime.errorDiagnosisRepository.listBySession(facts.session.id)));
  return groups.flatMap((items) => [...items]);
}

async function collectMessages(
  runtime: TutorDatabaseRuntime,
  sessions: readonly ConversationSession[]
): Promise<ConversationMessage[]> {
  const groups = await Promise.all(sessions.map((session) => runtime.conversationStore.listMessages(session.id)));
  return groups.flatMap((items) => [...items]);
}

function assertBackup(input: unknown): DataBackup {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('备份文件格式不正确');
  const value = input as Partial<DataBackup>;
  if (value.app !== 'zhangl-agent' || value.version !== 2 || !value.candidate || !value.learning || !value.conversations) {
    throw new Error('仅支持新版 v2 业务快照，不兼容旧 Markdown/旧数据库备份');
  }
  const backup = value as DataBackup;
  const cycleId = requiredText(record(backup.candidate).examCycle, 'candidate.examCycle', 'id');
  const projectId = requiredText(record(backup.candidate).project, 'candidate.project', 'id');
  if (requiredText(backup.project, 'project', 'id') !== projectId) throw new Error('备份项目标识不一致');
  assertArrayFields(backup.learning, [
    'threads', 'questionSets', 'sessions', 'diagnoses', 'evidence',
    'masteryTracks', 'reviewQueue', 'dailyPlans', 'assets'
  ]);
  assertArrayFields(backup.conversations, ['sessions', 'messages']);
  backup.learning.threads.forEach((item) => assertCycle(record(item).thread, cycleId, 'learning.thread'));
  backup.learning.questionSets.forEach((item) => {
    assertCommittedQuestionSetBundle(item);
    assertCycle(item.questionSet, cycleId, 'learning.questionSet');
  });
  backup.learning.sessions.forEach((item) => assertCycle(item.session, cycleId, 'learning.session'));
  backup.learning.diagnoses.forEach((item) => assertCycle(item, cycleId, 'learning.diagnosis'));
  backup.learning.evidence.forEach((item) => assertCycle(item, cycleId, 'learning.evidence'));
  backup.learning.masteryTracks.forEach((item) => assertCycle(item, cycleId, 'learning.masteryTrack'));
  backup.learning.reviewQueue.forEach((item) => assertCycle(item, cycleId, 'learning.reviewQueue'));
  backup.learning.dailyPlans.forEach((item) => assertCycle(item.plan, cycleId, 'learning.dailyPlan'));
  backup.learning.assets.forEach((item) => assertCycle(item, cycleId, 'learning.asset'));
  const sessionIds = new Set(backup.conversations.sessions.map((session) => {
    if (session.projectId !== projectId || !session.id) throw new Error('备份会话不属于当前项目');
    return session.id;
  }));
  backup.conversations.messages.forEach((message) => {
    if (!message.id || !sessionIds.has(message.sessionId)) throw new Error('备份消息引用了不存在的会话');
  });
  return backup;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份对象结构不正确');
  return value as Record<string, unknown>;
}

function requiredText(parent: unknown, label: string, key: string): string {
  const value = record(parent)[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}.${key} 缺失`);
  return value;
}

function assertArrayFields(parent: unknown, fields: readonly string[]): void {
  const value = record(parent);
  fields.forEach((field) => {
    if (!Array.isArray(value[field])) throw new Error(`备份字段 ${field} 必须是数组`);
  });
}

function assertCycle(value: unknown, cycleId: string, label: string): void {
  if (requiredText(value, label, 'examCycleId') !== cycleId) throw new Error(`${label} 不属于当前备考周期`);
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

export const dataManagementService = new DataManagementService();
