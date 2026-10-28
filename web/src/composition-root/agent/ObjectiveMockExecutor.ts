import { abortableDelay, mapWithAbortableConcurrency } from '@/kernel/public';
import { LearningAssetKind } from '@/modules/content/public';
import { ExamDeliveryKind, parseExamDeliveryKind } from '@/modules/curriculum/public';
import type { BusinessAgentExecutor } from './BusinessAgentContracts';

const MOCK_BATCH_CONCURRENCY = 3;
const MOCK_BATCH_MAX_QUESTIONS = 20;
const DEFAULT_MOCK_MODULES = ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'];

interface MockBatch {
  readonly module: string;
  readonly count: number;
  readonly moduleBatchIndex: number;
}

/**
 * The question-set (行测) mock exam: one structured question set per module
 * batch, generated in parallel and assembled into a single mock manifest.
 */
export const objectiveMockExecutor: BusinessAgentExecutor = async (task, context) => {
  const deliveryKind = parseExamDeliveryKind(task.payload?.deliveryKind) ?? ExamDeliveryKind.Objective;
  const subjectName = asString(task.payload?.subjectName) || '模考';
  const requestedCount = Math.max(5, Math.min(135, Math.round(Number(task.payload?.questionCount || 120))));
  const modules = Array.isArray(task.payload?.modules)
    ? task.payload.modules.map(String).filter(Boolean)
    : DEFAULT_MOCK_MODULES;
  const focusTags = Array.isArray(task.payload?.focusTags) ? task.payload.focusTags.map(String).filter(Boolean) : ['高频考点'];
  const batches = buildMockBatches(modules, requestedCount);
  await context.update(18, `拆分 ${batches.length} 个稳定题组`);
  // Batches finish out of order; the bar follows how many are done, not which.
  let completedBatches = 0;
  const sections = await mapWithAbortableConcurrency(batches, MOCK_BATCH_CONCURRENCY, context.signal, async (batch, batchIndex, signal) => {
    const result = await retryBatch(() => context.generatePractice({
        module: batch.module,
        requestedCount: batch.count,
        difficultyMin: 0.38,
        difficultyMax: 0.78,
        purpose: `行测模考 · ${focusTags.join('、')} · ${batch.module}`,
        review: false,
        capabilityIndex: batch.moduleBatchIndex,
        batchKey: mockBatchKey(batch, batchIndex)
      }, signal),
      batchIndex,
      signal
    );
    signal.throwIfAborted();
    completedBatches += 1;
    await context.update(
      Math.min(88, 20 + Math.round((completedBatches / batches.length) * 66)),
      `已完成 ${completedBatches}/${batches.length} 个题组`
    );
    return { ...batch, ...result };
  });
  const date = asString(task.payload?.date) || new Date().toISOString().slice(0, 10);
  const actualCount = sections.reduce((sum, section) => sum + section.count, 0);
  context.signal.throwIfAborted();
  const saved = await context.saveLearningAsset({
    kind: LearningAssetKind.MockManifest,
    businessKey: `mock:${date}:${task.id}`,
    title: `${subjectName} · ${date}`,
    payload: {
      subjectName,
      deliveryKind,
      date,
      durationMinutes: Number(task.payload?.durationMinutes || 120),
      requestedCount,
      actualCount,
      focusTags,
      sections
    }
  });
  context.signal.throwIfAborted();
  await context.setResult({
    resultRef: saved.id,
    payload: { assetId: saved.id, manifestId: saved.id, deliveryKind }
  });
  await context.update(94, `已写入 ${actualCount} 道模考题`);
};

/**
 * Deterministic per batch: the batch list is rebuilt from the persisted input
 * on every attempt, so a retried batch lands on its own generation while two
 * batches (even of a module listed twice) never share one.
 */
function mockBatchKey(batch: MockBatch, batchIndex: number): string {
  return `mock:${batchIndex + 1}:${batch.module}:${batch.moduleBatchIndex}`;
}

function buildMockBatches(modules: readonly string[], total: number): MockBatch[] {
  const selected = modules.length ? modules : ['判断推理'];
  const base = Math.floor(total / selected.length);
  let remainder = total % selected.length;
  return selected.flatMap((module) => {
    const moduleCount = base + (remainder-- > 0 ? 1 : 0);
    const batches: MockBatch[] = [];
    let remaining = moduleCount;
    let moduleBatchIndex = 0;
    while (remaining > 0) {
      const count = Math.min(MOCK_BATCH_MAX_QUESTIONS, remaining);
      batches.push({ module, count, moduleBatchIndex });
      remaining -= count;
      moduleBatchIndex += 1;
    }
    return batches;
  });
}

/**
 * One batch gets one more attempt when it failed transiently or when the model's
 * output for it failed validation (a lecture that broke the schema, too few
 * usable questions). The retry reuses the batch key, so the failed generation
 * is retried in place while batches that already committed are untouched;
 * without it, one bad batch discarded every question the mock had paid for.
 */
async function retryBatch<Output>(
  work: () => Promise<Output>,
  ordinal: number,
  signal: AbortSignal
): Promise<Output> {
  try {
    return await work();
  } catch (error) {
    signal.throwIfAborted();
    if (!isTransientFailure(error) && !isGeneratedContentFailure(error)) throw error;
    await abortableDelay(1200 + (ordinal % 3) * 700, signal);
    return work();
  }
}

function isTransientFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate|limit|限流|timeout|network|transient|暂时|网络/i.test(message);
}

/** Validation failures of the model's output (`generation.*`), which a fresh attempt can pass. */
function isGeneratedContentFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code.startsWith('generation.');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
