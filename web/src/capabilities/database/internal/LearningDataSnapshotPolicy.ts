import {
  LearningDataSnapshotError,
  LearningDataStorage,
  type LearningDataRecord,
  type LearningDataSnapshot
} from '../contracts/TutorDataMaintenance';

const storageLabels: Readonly<Record<LearningDataStorage, string>> = {
  [LearningDataStorage.Sqlite]: 'iOS 客户端',
  [LearningDataStorage.IndexedDb]: '网页版'
};

/** The tables or stores each snapshot section may hold; a group in the wrong section would never be written. */
export interface SnapshotGroups {
  readonly records: ReadonlySet<string>;
  readonly references: ReadonlySet<string>;
}

/** Rows keep their storage's own shape, so a snapshot only fits the storage kind and schema it came from. */
export function assertSnapshotFits(
  snapshot: LearningDataSnapshot,
  storage: LearningDataStorage,
  currentSchemaVersion: number,
  groups: SnapshotGroups
): void {
  if (snapshot.storage !== storage) {
    const source = storageLabels[snapshot.storage] ?? '未知来源';
    throw new LearningDataSnapshotError(
      `该备份来自${source}，${storageLabels[storage]}暂不支持跨平台恢复，请在导出它的设备上导入`
    );
  }
  if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
    throw new LearningDataSnapshotError('备份缺少数据版本信息，无法恢复');
  }
  if (snapshot.schemaVersion > currentSchemaVersion) {
    throw new LearningDataSnapshotError(
      `该备份来自更新版本的应用（数据版本 ${snapshot.schemaVersion}），请升级应用后再导入`
    );
  }
  for (const section of ['records', 'references'] as const) {
    for (const group of Object.keys(snapshot[section])) {
      if (!groups[section].has(group)) throw new LearningDataSnapshotError(`备份包含当前版本无法识别的数据（${group}）`);
    }
  }
}

export function sourceIdentityConflictError(label: string): LearningDataSnapshotError {
  return new LearningDataSnapshotError(
    `本机已导入过同一份题目来源（${label}），但编号与备份不同，无法恢复这份备份；请在导出它的设备上导入`
  );
}

export function snapshotRows(
  groups: LearningDataSnapshot['records'],
  group: string
): readonly LearningDataRecord[] {
  const rows = groups[group] ?? [];
  if (!Array.isArray(rows)) throw new LearningDataSnapshotError(`备份中的 ${group} 数据格式不正确`);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new LearningDataSnapshotError(`备份中的 ${group} 记录格式不正确`);
    }
  }
  return rows;
}

export function foreignRecordsError(group: string): LearningDataSnapshotError {
  return new LearningDataSnapshotError(`备份中的 ${group} 记录不属于当前备考周期，无法恢复`);
}
