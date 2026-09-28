import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { AgentRunId } from '@/kernel/public';
import type { AgentRuntimeEvent, AgentRuntimeObserver } from '@/modules/agent/public';
import { agentToolActivityService } from './AgentToolActivityService';
import { chatTaskPresentation } from './ChatAgentTaskPresentation';
import type { ChatAgentTurnWriter } from './ChatAgentTurnWriter';
import {
  activityStatus,
  eventStatus,
  isToolActivityEvent,
  toolLabel
} from './ChatAgentRuntimeSupport';

/** Routes Agent loop events to the visible answer and to tool/task progress. */
export function createChatRunObserver(
  runtime: TutorDatabaseRuntime,
  sessionId: string,
  runId: AgentRunId,
  writer: ChatAgentTurnWriter
): AgentRuntimeObserver {
  return {
    onEvent: async (event: AgentRuntimeEvent) => {
      if (event.type === 'text_delta') {
        await writer.appendDelta(event.text);
        return;
      }
      if (!isToolActivityEvent(event)) return;
      const status = eventStatus(event);
      if (!status) return;
      agentToolActivityService.record({
        chatSessionId: sessionId,
        agentRunId: runId,
        call: event.call,
        label: toolLabel(event.call.name),
        status: activityStatus(event),
        ...('resultRef' in event && event.resultRef ? { resultRef: event.resultRef } : {}),
        ...('reasonCode' in event ? { reasonCode: event.reasonCode } : {})
      });
      const current = await runtime.agentRunRepository.findById(runId);
      if (current?.run.status !== 'running') return;
      const linkedTask = status.taskId
        ? (await runtime.getAgentRunViews.execute({ limit: 50 })).find((run) => run.id === status.taskId)
        : undefined;
      await runtime.updateAgentRunProgress.execute({
        agentRunId: runId,
        step: status.step,
        progress: status.progress,
        message: status.message,
        data: {
          ...(status.toolName ? { toolName: status.toolName } : {}),
          ...(status.taskId ? { taskId: status.taskId } : {}),
          ...chatTaskPresentation(status.toolName),
          ...(linkedTask?.actionRoute ? { actionRoute: linkedTask.actionRoute } : {}),
          ...(linkedTask?.actionParams ? { actionParams: linkedTask.actionParams } : {})
        }
      });
    }
  };
}
