import {
  AgentExecutionClass,
  AgentWorkPool,
  type AgentWorkPool as AgentWorkPoolValue
} from './AgentRunCodes';

/**
 * Gives each lane a preferred business pool while allowing idle lanes to steal work.
 * The configured limit therefore remains the real global concurrency ceiling instead
 * of silently becoming a per-pool limit of one.
 *
 * External research is allowed on one dedicated lane. The other lanes do not
 * claim it, so a long true-question search cannot occupy all configured slots.
 */
export function agentWorkPoolsForLane(
  laneIndex: number,
  activeLimit: number,
  schedulingCycle = 0
): readonly AgentWorkPoolValue[] {
  if (activeLimit >= 3) {
    if (laneIndex === 0) {
      return [
        AgentWorkPool.Interactive,
        AgentWorkPool.Assessment,
        AgentWorkPool.ContentGeneration,
        AgentWorkPool.Background
      ];
    }
    if (laneIndex === 1) {
      return [
        AgentWorkPool.Assessment,
        AgentWorkPool.Interactive,
        AgentWorkPool.ContentGeneration,
        AgentWorkPool.Background
      ];
    }
    return [
      AgentWorkPool.ContentGeneration,
      AgentWorkPool.Interactive,
      AgentWorkPool.Assessment,
      AgentWorkPool.Background
    ];
  }
  if (activeLimit === 2) {
    return laneIndex === 0
      ? [
          AgentWorkPool.Assessment,
          AgentWorkPool.Interactive,
          AgentWorkPool.ContentGeneration,
          AgentWorkPool.Background
        ]
      : [
          AgentWorkPool.ContentGeneration,
          AgentWorkPool.Interactive,
          AgentWorkPool.Assessment,
          AgentWorkPool.Background
        ];
  }
  const foreground = [
    AgentWorkPool.Interactive,
    AgentWorkPool.Assessment,
    AgentWorkPool.ContentGeneration
  ];
  const offset = Math.abs(schedulingCycle) % foreground.length;
  return [...foreground.slice(offset), ...foreground.slice(0, offset), AgentWorkPool.Background];
}

export function agentExecutionClassesForLane(
  laneIndex: number,
  activeLimit: number
): readonly AgentExecutionClass[] {
  if (activeLimit >= 3) {
    return laneIndex === 2
      ? [AgentExecutionClass.ExternalResearch, AgentExecutionClass.General]
      : [AgentExecutionClass.General];
  }
  if (activeLimit === 2) {
    return laneIndex === 1
      ? [AgentExecutionClass.ExternalResearch, AgentExecutionClass.General]
      : [AgentExecutionClass.General];
  }
  return [AgentExecutionClass.General, AgentExecutionClass.ExternalResearch];
}
