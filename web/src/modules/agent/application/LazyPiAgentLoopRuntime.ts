import { ProviderGatewayError, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type {
  AgentCheckpointStore,
  AgentModelInvoker,
  AgentRuntimeObserver,
  AgentToolExecutor,
  AgentToolPolicy
} from '../contracts/AgentRuntimePorts';
import type { AgentLoopResult, AgentLoopRuntime, RunAgentLoopCommand } from './AgentLoopContracts';
import { PiAgentLoopRuntime } from './PiAgentLoopRuntime';
import { RunAgentLoop } from './RunAgentLoop';

/** Runs Pi by default and falls back only before any externally visible effect. */
export class LazyPiAgentLoopRuntime implements AgentLoopRuntime {
  constructor(
    private readonly modelInvoker: AgentModelInvoker,
    private readonly policy: AgentToolPolicy,
    private readonly executor: AgentToolExecutor,
    private readonly checkpoints: AgentCheckpointStore,
    private readonly observer?: AgentRuntimeObserver
  ) {}

  async execute(
    command: RunAgentLoopCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<AgentLoopResult> {
    const activity = { emittedText: false, startedTool: false };
    const observer: AgentRuntimeObserver = {
      onEvent: async (event) => {
        if (event.type === 'text_delta' && event.text) activity.emittedText = true;
        if (
          event.type === 'tool_call_started'
          || event.type === 'tool_call_succeeded'
          || event.type === 'confirmation_required'
        ) activity.startedTool = true;
        await this.observer?.onEvent(event);
      }
    };
    const runtime = new PiAgentLoopRuntime(
      this.modelInvoker,
      this.policy,
      this.executor,
      this.checkpoints,
      observer
    );
    try {
      return await runtime.execute(command, gateway, signal);
    } catch (error) {
      if (!canFallbackToStableLoop(error, signal, activity)) throw error;
      console.warn('[AgentLoop] Pi runtime failed before external effects; retrying with the stable loop.', {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error)
      });
      return new RunAgentLoop(
        this.modelInvoker,
        this.policy,
        this.executor,
        this.checkpoints,
        this.observer
      ).execute(command, gateway, signal);
    }
  }
}

function canFallbackToStableLoop(
  error: unknown,
  signal: AbortSignal | undefined,
  activity: { readonly emittedText: boolean; readonly startedTool: boolean }
): boolean {
  if (signal?.aborted || activity.emittedText || activity.startedTool) return false;
  if (error instanceof ProviderGatewayError) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const name = error instanceof Error ? error.name : '';
  return name !== 'AgentRunLeaseLostError';
}
