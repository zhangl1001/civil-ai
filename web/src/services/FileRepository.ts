import { initializeTutorRuntime } from '@/composition-root/public';
import { LearningAssetKind } from '@/modules/content/public';

export interface FileRecord {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly content: string;
  readonly contentType: 'json' | 'text';
  readonly createdAt: number;
  readonly updatedAt: number;
}

function contentTypeForPath(path: string): FileRecord['contentType'] {
  return /\.json$/i.test(path) ? 'json' : 'text';
}

export class FileRepository {
  async readText(projectId: string, path: string): Promise<string> {
    const { runtime, cycle } = await currentCycle(projectId);
    const asset = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.ChatAttachment,
      path
    );
    return typeof asset?.payload.content === 'string' ? asset.payload.content : '';
  }

  async readJson<T>(projectId: string, path: string, fallback: T): Promise<T> {
    const text = await this.readText(projectId, path);
    if (!text) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  async writeText(projectId: string, path: string, content: string): Promise<FileRecord> {
    const { runtime, cycle } = await currentCycle(projectId);
    const asset = await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.ChatAttachment,
      businessKey: path,
      title: path.split('/').at(-1) || '聊天附件',
      payload: {
        projectId,
        path,
        content,
        contentType: contentTypeForPath(path)
      }
    });
    return {
      id: asset.id,
      projectId,
      path,
      content,
      contentType: contentTypeForPath(path),
      createdAt: Number(asset.createdAt),
      updatedAt: Number(asset.updatedAt)
    };
  }

  async list(projectId: string): Promise<FileRecord[]> {
    const { runtime, cycle } = await currentCycle(projectId);
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.ChatAttachment],
      limit: 500
    });
    return assets.map((asset) => ({
      id: asset.id,
      projectId,
      path: String(asset.payload.path || asset.businessKey),
      content: String(asset.payload.content || ''),
      contentType: asset.payload.contentType === 'json' ? 'json' : 'text',
      createdAt: Number(asset.createdAt),
      updatedAt: Number(asset.updatedAt)
    }));
  }

  async delete(projectId: string, path: string): Promise<void> {
    const { runtime, cycle } = await currentCycle(projectId);
    await runtime.learningAssetStore.retireBusinessKey(
      cycle.examCycle.id,
      LearningAssetKind.ChatAttachment,
      path
    );
  }
}

async function currentCycle(projectId: string) {
  const runtime = await initializeTutorRuntime();
  const cycle = await runtime.candidateRepository.findCurrentCycle();
  if (!cycle || cycle.project.id !== projectId) throw new Error('当前备考档案不存在');
  return { runtime, cycle };
}

export const fileRepository = new FileRepository();
