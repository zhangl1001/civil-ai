import { objectiveSubjectCodes } from '@/domain/subjectDelivery';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { MasteryTrack } from '@/modules/mastery/public';

export function trainableObjectiveNodes(nodes: readonly CapabilityNode[]): readonly CapabilityNode[] {
  const objective = objectiveSubjectCodes();
  return nodes
    .filter((node) => (
      node.status === 'active'
      && objective.has(node.subject)
      && (node.nodeType === 'knowledge_point' || node.nodeType === 'sub_point')
    ))
    .slice()
    .sort((left, right) => left.sequence - right.sequence || left.code.localeCompare(right.code));
}

export function selectPriorityOrCoverageCapability(
  nodes: readonly CapabilityNode[],
  tracks: readonly MasteryTrack[]
): CapabilityNode | undefined {
  const trainable = trainableObjectiveNodes(nodes);
  const byId = new Map(trainable.map((node) => [node.id, node]));
  const priority = tracks.find((track) => byId.has(track.capabilityNodeId));
  return (priority ? byId.get(priority.capabilityNodeId) : undefined)
    ?? selectCoverageGapCapability(trainable, tracks);
}

export function selectCoverageGapCapability(
  nodes: readonly CapabilityNode[],
  tracks: readonly MasteryTrack[]
): CapabilityNode | undefined {
  const trainable = trainableObjectiveNodes(nodes);
  if (!trainable.length) return undefined;
  const sampleByCapability = new Map(tracks.map((track) => [track.capabilityNodeId, track.effectiveSample]));
  const sampleByModule = new Map<string, number>();
  trainable.forEach((node) => {
    sampleByModule.set(
      node.module,
      (sampleByModule.get(node.module) ?? 0) + (sampleByCapability.get(node.id) ?? 0)
    );
  });
  return trainable.slice().sort((left, right) => (
    (sampleByModule.get(left.module) ?? 0) - (sampleByModule.get(right.module) ?? 0)
    || (sampleByCapability.get(left.id) ?? 0) - (sampleByCapability.get(right.id) ?? 0)
    || left.sequence - right.sequence
    || left.code.localeCompare(right.code)
  ))[0];
}
