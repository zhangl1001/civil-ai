import type { Clock } from '@/kernel/public';
import type {
  AgentCheckpointStore,
  AgentModelInvoker,
  AgentRuntimeObserver,
  AgentToolExecutor,
  AgentToolPolicy
} from '../contracts/AgentRuntimePorts';
import type { AgentToolReceiptRepository } from '../contracts/AgentToolReceiptRepository';
import { DurableAgentToolExecutor } from './DurableAgentToolExecutor';
import { LazyPiAgentLoopRuntime } from './LazyPiAgentLoopRuntime';

export function createDurableAgentLoopFactory(dependencies: {
  readonly invoker: AgentModelInvoker;
  readonly policy: AgentToolPolicy;
  readonly receipts: AgentToolReceiptRepository;
  readonly checkpoints: AgentCheckpointStore;
  readonly clock: Clock;
}) {
  return (executor: AgentToolExecutor, observer?: AgentRuntimeObserver) => new LazyPiAgentLoopRuntime(
    dependencies.invoker,
    dependencies.policy,
    new DurableAgentToolExecutor(executor, dependencies.receipts, dependencies.clock),
    dependencies.checkpoints,
    observer
  );
}
