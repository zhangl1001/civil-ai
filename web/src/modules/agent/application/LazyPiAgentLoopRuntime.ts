import { ProviderGatewayError, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type {
  AgentCheckpointStore,
  AgentModelInvoker,
  AgentRuntimeObserver,
  AgentToolExecutor,
  AgentToolPolicy
} from '../contracts/AgentRuntimePorts';
import type { AgentLoopResult, AgentLoopRuntime, RunAgentLoopCommand } from './AgentLoopContracts';
import { RunAgentLoop } from './RunAgentLoop';

type PiAgentLoopRuntimeModule = typeof import('./PiAgentLoopRuntime');

let piRuntimeModule: Promise<PiAgentLoopRuntimeModule> | undefined;

/**
 * Pi and its provider, schema and diff dependencies load with the first Agent
 * turn instead of the app shell. A failed chunk load is forgotten so the next
 * turn fetches it again rather than replaying the same rejection.
 */
function loadPiAgentLoopRuntime(): Promise<PiAgentLoopRuntimeModule> {
  piRuntimeModule ??= import('./PiAgentLoopRuntime').catch((error: unknown) => {
    piRuntimeModule = undefined;
    throw error;
  });
  return piRuntimeModule;
}

/**
 * Runs Pi by default and falls back only before model invocation or tool effects.
 * Failing to load the Pi chunk is such a failure: nothing has run yet.
 */
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
    const activity = { emittedText: false, startedTool: false, startedModel: false };
    const invoker: AgentModelInvoker = {
      invoke: (...args) => {
        // Conservative boundary: an invoker can send a paid request before it
        // throws (including while recording a text-free tool response).
        activity.startedModel = true;
        return this.modelInvoker.invoke(...args);
      }
    };
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
    try {
      const { PiAgentLoopRuntime } = await loadPiAgentLoopRuntime();
      const runtime = new PiAgentLoopRuntime(
        invoker,
        this.policy,
        this.executor,
        this.checkpoints,
        observer
      );
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
  activity: { readonly emittedText: boolean; readonly startedTool: boolean; readonly startedModel: boolean }
): boolean {
  if (signal?.aborted || activity.emittedText || activity.startedTool || activity.startedModel) return false;
  if (error instanceof ProviderGatewayError) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const name = error instanceof Error ? error.name : '';
  return name !== 'AgentRunLeaseLostError';
}
