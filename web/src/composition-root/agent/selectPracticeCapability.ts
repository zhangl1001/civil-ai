import { practiceModuleCode } from '@/domain/labels';

/** The parts of a capability node this choice actually reads. */
export interface PracticeCapabilityNode {
  readonly code: string;
  readonly name: string;
  readonly module?: string;
  readonly nodeType: string;
}

export interface PracticeCapabilityRequest {
  readonly module: string;
  readonly knowledgePoint?: string;
  readonly capabilityIndex?: number;
}

/** Nodes small enough to be the subject of one practice set. */
const TRAINABLE_NODE_TYPES: readonly string[] = ['sub_point', 'knowledge_point'];

/**
 * Which capability node a requested practice run should train.
 *
 * A named knowledge point wins outright. Otherwise the caller's rotation index
 * picks among the trainable nodes, so repeated requests for the same module
 * spread across it instead of drilling whichever node happens to sort first.
 *
 * A module with nothing trainable falls back within that module rather than to
 * the first node overall: answering a 资料分析 request with a 判断推理 node is
 * worse than answering it with a coarser node from the module asked for.
 */
export function selectPracticeCapability<T extends PracticeCapabilityNode>(
  nodes: readonly T[],
  request: PracticeCapabilityRequest
): T | undefined {
  const moduleCode = practiceModuleCode(request.module);
  const candidates = moduleCode ? nodes.filter((node) => node.module === moduleCode) : nodes;
  const knowledgePoint = request.knowledgePoint;
  const named = knowledgePoint
    ? candidates.find((node) => (
      node.name.includes(knowledgePoint)
      || knowledgePoint.includes(node.name)
      || node.code.includes(knowledgePoint)
    ))
    : undefined;
  if (named) return named;
  const trainable = candidates.filter((node) => TRAINABLE_NODE_TYPES.includes(node.nodeType));
  if (!trainable.length) return candidates[0] ?? nodes[0];
  return trainable[Math.max(0, Math.floor(request.capabilityIndex ?? 0)) % trainable.length];
}
