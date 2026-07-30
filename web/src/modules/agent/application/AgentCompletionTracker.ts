import type {
  AgentCompletionExpectation,
  AgentCompletionVerification
} from '../contracts/AgentRuntimePorts';

export interface AgentCompletionResolution {
  readonly expectation: AgentCompletionExpectation;
  readonly verification: AgentCompletionVerification;
  readonly kind: 'terminal' | 'delegated';
}

/** Matches completion evidence to the exact async resource created by a write Tool. */
export class AgentCompletionTracker {
  private readonly pending = new Map<string, AgentCompletionExpectation>();

  constructor(restored: readonly AgentCompletionExpectation[] = []) {
    this.expect(restored);
  }

  expect(expectations: readonly AgentCompletionExpectation[]): void {
    expectations.forEach((expectation) => {
      if (expectation.resourceType && expectation.resourceId) {
        this.pending.set(resourceKey(expectation), expectation);
      }
    });
  }

  resolve(verifications: readonly AgentCompletionVerification[]): AgentCompletionResolution | undefined {
    let resolution: AgentCompletionResolution | undefined;
    for (const verification of verifications) {
      const expectation = this.pending.get(resourceKey(verification));
      if (!expectation) continue;
      if (verification.terminal) this.pending.delete(resourceKey(verification));
      const current: AgentCompletionResolution = {
        expectation,
        verification,
        kind: verification.terminal ? 'terminal' : 'delegated'
      };
      if (!resolution || current.kind === 'delegated') resolution = current;
    }
    return resolution;
  }

  get requiresVerification(): boolean {
    return this.pending.size > 0;
  }

  list(): readonly AgentCompletionExpectation[] {
    return [...this.pending.values()];
  }
}

export function completionResolutionInstruction(resolution: AgentCompletionResolution): string {
  const { expectation, verification } = resolution;
  const identity = `${verification.resourceType}:${verification.resourceId}`;
  if (!verification.terminal) {
    return [
      `已核验同一资源 ${identity}，当前真实状态为 ${verification.state}，尚未达到 ${expectation.expectedTerminalState}。`,
      '请结束本轮并只说明任务已受理或仍在执行；不得声称内容已经生成或业务已经完成。'
    ].join('\n');
  }
  if (verification.state === expectation.expectedTerminalState) {
    return `已核验同一资源 ${identity}，真实状态为 ${verification.state}。请基于工具结果简洁说明最终结果。`;
  }
  return [
    `已核验同一资源 ${identity}，终态为 ${verification.state}，未达到期望状态 ${expectation.expectedTerminalState}。`,
    '请如实说明失败或取消，不得声称业务已经完成。'
  ].join('\n');
}

function resourceKey(value: { readonly resourceType: string; readonly resourceId: string }): string {
  return `${value.resourceType}:${value.resourceId}`;
}
