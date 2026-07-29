import type {
  AgentTaskEnqueueResult,
  GenerationTaskInput
} from '@/services/GenerationTaskService';

/** UI-facing composition boundary for dispatching durable business Agent work. */
export async function enqueueBusinessAgentTask(
  input: GenerationTaskInput
): Promise<AgentTaskEnqueueResult> {
  const { generationTaskService } = await import('@/services/GenerationTaskService');
  return generationTaskService.enqueue(input);
}
