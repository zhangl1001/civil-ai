import { agentWorkerCoordinator } from '@/composition-root/agent/AgentWorkerCoordinator';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { AssessmentRole, type JsonObject } from '@/kernel/public';
import { correctAnswerLabel, LearningAssetKind } from '@/modules/content/public';
import { submittedAnswerLabel, type WrongBookEntry } from '@/modules/evidence/public';

let cachedEntries: readonly WrongBookEntry[] | undefined;
let pendingList: Promise<readonly WrongBookEntry[]> | undefined;
let sessionOffset = 0;
let moreEntriesAvailable = true;

export function peekWrongBookEntries(): readonly WrongBookEntry[] | undefined {
  return cachedEntries;
}

/** Page-facing wrong-book use cases. Vue owns presentation state; this adapter owns business orchestration. */
export class WrongBookFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async list(limit = 80, options: { readonly refresh?: boolean } = {}) {
    if (options.refresh) {
      cachedEntries = undefined;
      sessionOffset = 0;
      moreEntriesAvailable = true;
    }
    if (!options.refresh && cachedEntries !== undefined && cachedEntries.length >= limit) return cachedEntries.slice(0, limit);
    pendingList ??= this.loadUntil(limit).finally(() => { pendingList = undefined; });
    return (await pendingList).slice(0, limit);
  }

  hasMore(): boolean {
    return moreEntriesAvailable;
  }

  private async loadUntil(limit: number): Promise<readonly WrongBookEntry[]> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const loaded = new Map((cachedEntries ?? []).map((entry) => [entry.id, entry]));
    let attempts = 0;
    while (loaded.size < limit && moreEntriesAvailable && attempts < 20) {
      const page = await this.runtime.getWrongBookEntries.execute({
        examCycleId: cycle.examCycle.id,
        limit: Math.min(40, Math.max(20, limit - loaded.size)),
        sessionOffset,
        sessionLimit: 12
      });
      page.entries.forEach((entry) => loaded.set(entry.id, entry));
      moreEntriesAvailable = page.hasMore;
      if (page.nextSessionOffset === undefined || page.nextSessionOffset === sessionOffset) break;
      sessionOffset = page.nextSessionOffset;
      attempts += 1;
    }
    cachedEntries = [...loaded.values()];
    return cachedEntries;
  }

  async analyze(entry: WrongBookEntry): Promise<void> {
    const provisional = entry.diagnoses
      .map((item) => item.diagnosis)
      .find((item) => item.source === 'deterministic' && item.causeCode === 'unknown');
    if (!provisional) throw new Error('当前错题缺少可分析的批改事实，请先重做后再分析。');
    const run = await this.runtime.requestAiErrorDiagnosis.execute({
      idempotencyKey: `wrongbook:diagnosis:${provisional.id}:v1`,
      sessionId: provisional.sessionId,
      items: [{
        provisionalDiagnosisId: provisional.id,
        evidenceContext: asJson({
          question: {
            material: entry.question.content.material ?? null,
            prompt: entry.question.content.prompt,
            options: entry.question.content.options
          },
          standardAnswer: correctAnswerLabel(entry.question.content),
          userAnswer: submittedAnswerLabel(entry.attempt.answer) || null,
          deterministicResult: entry.grading.result,
          observations: {
            elapsedMs: entry.attempt.elapsedMs ?? null,
            answerChangeCount: entry.attempt.answerChangeCount
          }
        })
      }]
    });
    agentWorkerCoordinator.start(this.runtime);
    for (let poll = 0; poll < 90; poll += 1) {
      const current = await this.runtime.getAgentRunViews.findById(run.run.id);
      if (current && !current.isActive) return;
      await delay(800);
    }
  }

  async startReview(entries: readonly WrongBookEntry[]): Promise<string> {
    const uniqueEntries = [...new Map(entries.map((entry) => [String(entry.question.id), entry])).values()];
    if (!uniqueEntries.length) throw new Error('请至少选择一道历史错题。');
    if (uniqueEntries.length > 30) throw new Error('单次最多重做 30 道错题，请缩小筛选范围。');
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const sections = groupReviewSections(uniqueEntries);
    const createdAt = Date.now();
    const manifest = await this.runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.PracticeManifest,
      businessKey: `wrongbook-review:${createdAt}:${uniqueEntries[0].attempt.id}`,
      title: `错题重做 · ${uniqueEntries.length}题`,
      payload: {
        manifestType: 'wrongbook_review',
        capabilityName: '错题重做',
        assessmentRole: AssessmentRole.Retention,
        durationMinutes: Math.max(5, Math.ceil(uniqueEntries.length * 1.5)),
        questionCount: uniqueEntries.length,
        sections
      }
    });
    return manifest.id;
  }
}

function groupReviewSections(entries: readonly WrongBookEntry[]): JsonObject[] {
  const groups = new Map<string, {
    questionSetId: string;
    learningThreadId: string;
    module: string;
    questionIds: string[];
  }>();
  entries.forEach((entry) => {
    const key = `${entry.session.questionSetId}:${entry.session.learningThreadId}`;
    const group = groups.get(key) ?? {
      questionSetId: entry.session.questionSetId,
      learningThreadId: entry.session.learningThreadId,
      module: entry.module,
      questionIds: []
    };
    group.questionIds.push(entry.question.id);
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => asJson(group));
}

function asJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
