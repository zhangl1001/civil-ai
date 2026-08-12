import type { CapabilityNodeId } from '@/kernel/public';
import type { LearningProgressRecord } from '../contracts/LearningProgressRepository';
import { LearningResourceType } from './LearningProgressCodes';

export function latestLectureProgressByCapability(
  records: readonly LearningProgressRecord[]
): ReadonlyMap<CapabilityNodeId, LearningProgressRecord> {
  const latest = new Map<CapabilityNodeId, LearningProgressRecord>();
  records.forEach((record) => {
    if (record.resourceType !== LearningResourceType.Lecture || !record.capabilityNodeId) return;
    const capabilityNodeId = record.capabilityNodeId as CapabilityNodeId;
    const current = latest.get(capabilityNodeId);
    if (!current || Number(record.updatedAt) > Number(current.updatedAt)) latest.set(capabilityNodeId, record);
  });
  return latest;
}
