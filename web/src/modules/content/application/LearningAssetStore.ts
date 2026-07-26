import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ExamCycleId, IdGenerator, JsonObject } from '@/kernel/public';
import type {
  LearningAssetQuery,
  LearningAssetRecord,
  LearningAssetRepository
} from '../contracts/LearningAssetRepository';
import {
  LearningAssetKind,
  LearningAssetStatus
} from '../domain/LearningAssetCodes';

export interface SaveLearningAssetCommand {
  readonly examCycleId: ExamCycleId;
  readonly kind: LearningAssetKind;
  readonly businessKey: string;
  readonly title: string;
  readonly payload: JsonObject;
  readonly sourceAgentRunId?: string;
  readonly status?: LearningAssetStatus;
}

export class LearningAssetStore {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LearningAssetRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async save(command: SaveLearningAssetCommand): Promise<LearningAssetRecord> {
    const businessKey = command.businessKey.trim();
    if (!businessKey) throw new Error('Learning asset businessKey is required');
    // A generation retry can race with a previous completion between the
    // read and insert. Re-read the version once instead of failing the whole
    // Agent run on the expected UNIQUE(version) conflict.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const previous = await this.repository.findLatest(command.examCycleId, command.kind, businessKey);
      const now = this.clock.now();
      const asset: LearningAssetRecord = {
        id: this.ids.next('LearningAssetId'),
        examCycleId: command.examCycleId,
        kind: command.kind,
        businessKey,
        title: command.title.trim() || command.kind,
        status: command.status ?? LearningAssetStatus.Ready,
        payload: command.payload,
        sourceAgentRunId: command.sourceAgentRunId,
        version: (previous?.version ?? 0) + 1,
        createdAt: now,
        updatedAt: now
      };
      try {
        await this.unitOfWork.run(async (context) => {
          await this.repository.save(asset, context);
        });
        return asset;
      } catch (error) {
        if (!isVersionConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error('Learning asset save failed');
  }

  async saveDraft(command: SaveLearningAssetCommand): Promise<LearningAssetRecord> {
    const businessKey = command.businessKey.trim();
    if (!businessKey) throw new Error('Learning asset businessKey is required');
    const previous = await this.repository.findLatest(command.examCycleId, command.kind, businessKey);
    const now = this.clock.now();
    const asset: LearningAssetRecord = {
      id: previous?.id ?? `LearningAssetDraft:${command.kind}:${command.examCycleId}:${businessKey}`,
      examCycleId: command.examCycleId,
      kind: command.kind,
      businessKey,
      title: command.title.trim() || command.kind,
      status: LearningAssetStatus.Draft,
      payload: command.payload,
      sourceAgentRunId: command.sourceAgentRunId,
      version: previous?.version ?? 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    await this.unitOfWork.run(async (context) => {
      await this.repository.saveDraft(asset, context);
    });
    return asset;
  }

  find(id: string): Promise<LearningAssetRecord | undefined> {
    return this.repository.find(id);
  }

  findLatest(examCycleId: ExamCycleId, kind: LearningAssetKind, businessKey: string): Promise<LearningAssetRecord | undefined> {
    return this.repository.findLatest(examCycleId, kind, businessKey);
  }

  list(query: LearningAssetQuery): Promise<readonly LearningAssetRecord[]> {
    return this.repository.list(query);
  }

  async retire(id: string): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      await this.repository.retire(id, this.clock.now(), context);
    });
  }

  async retireBusinessKey(examCycleId: ExamCycleId, kind: LearningAssetKind, businessKey: string): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      await this.repository.retireBusinessKey(examCycleId, kind, businessKey, this.clock.now(), context);
    });
  }
}

function isVersionConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ConstraintError'
    || /Key already exists|UNIQUE constraint failed: learning_assets\.(exam_cycle_id|business_key|version)|learning_assets.*version/i.test(error.message);
}
