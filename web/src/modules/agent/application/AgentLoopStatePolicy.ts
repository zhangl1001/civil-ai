import type { AgentToolAttemptState } from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import { AgentToolRole } from '../domain/AgentToolRegistry';
import type { ActiveAgentToolSet } from './ActiveAgentToolSet';

const MAX_IDENTICAL_RECOVERABLE_ATTEMPTS = 2;

export function restoreToolAttempts(
  signatures: Readonly<Record<string, number>>,
  checkpointAttempts?: Readonly<Record<string, AgentToolAttemptState>>
): Record<string, AgentToolAttemptState> {
  const restored = { ...(checkpointAttempts ?? {}) };
  Object.entries(signatures).forEach(([signature, attempts]) => {
    if (restored[signature]) return;
    // Older checkpoints did not persist outcomes. Treat them as completed to avoid replaying writes.
    restored[signature] = {
      attempts,
      status: 'succeeded',
      retryable: false
    };
  });
  return restored;
}

export function blockedRepeatReason(
  previous?: AgentToolAttemptState
): { readonly message: string; readonly reasonCode: string } | undefined {
  if (!previous) return undefined;
  if (previous.status === 'succeeded') {
    return {
      message: '相同工具和参数已经成功执行过，请使用已有结果；若证据仍不足，请调整参数、范围或工具。',
      reasonCode: 'agent.tool_duplicate_success'
    };
  }
  if (!previous.retryable) {
    return {
      message: '上次观察表明相同调用不可重试。请根据失败原因调整参数、改用其他工具，或在缺少关键输入时询问用户。',
      reasonCode: 'agent.tool_not_retryable'
    };
  }
  if (previous.attempts >= MAX_IDENTICAL_RECOVERABLE_ATTEMPTS) {
    return {
      message: '相同工具和参数连续调用仍未产生进展。请停止机械重复，并根据观察结果改变参数、范围、工具或工作步骤。',
      reasonCode: 'agent.tool_retry_strategy_required'
    };
  }
  return undefined;
}

export function hasCompletionValidator(skills: ReadonlyMap<string, AgentSkillActivation>): boolean {
  return [...skills.values()].some((skill) => (
    skill.validatorNames.includes('agent.no-false-completion')
  ));
}

export function hasPendingRequiredWrite(
  skills: ReadonlyMap<string, AgentSkillActivation>,
  toolSet: ActiveAgentToolSet,
  completedToolNames: ReadonlySet<string>
): boolean {
  return [...skills.values()].some((skill) => {
    if (!skill.validatorNames.includes('agent.requires-write')) return false;
    return !skill.allowedTools.some((name) => (
      toolSet.byName(name)?.risk !== 'read' && completedToolNames.has(name)
    ));
  });
}

export function completionVerifierNames(toolSet: ActiveAgentToolSet): readonly string[] {
  return [...toolSet.names].filter((name) => (
    toolSet.byName(name)?.role === AgentToolRole.CompletionVerifier
  ));
}
