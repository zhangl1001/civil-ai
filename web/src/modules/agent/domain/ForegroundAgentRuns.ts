import type { AgentRunRecord } from '../contracts/AgentRunRepository';
import { TaskTargetType } from './TaskCenterCodes';

/** The tool name the chat gives the durable run of one conversational Agent loop. */
export const CHAT_AGENT_LOOP_TOOL_NAME = 'agent_loop';

/**
 * Why recovery closed a foreground run: no live controller in any context of
 * the app owns it, so nothing would ever finish it.
 */
export const ORPHANED_FOREGROUND_RUN_REASON = 'chat_agent.orphaned';

/**
 * The chat's own Agent loop. Its live controller is the chat screen, which
 * creates the run queued and starts it a moment later without a lease; a worker
 * lane that claimed it in between would execute a tool that does not exist and
 * abort the live conversation. Workers therefore never claim it. Other
 * `chat_tool` runs stay worker-executable.
 */
export function isChatAgentLoopRun(run: Pick<AgentRunRecord, 'targetResourceType' | 'inputSnapshot'>): boolean {
  return run.targetResourceType === TaskTargetType.ChatTool
    && run.inputSnapshot.toolName === CHAT_AGENT_LOOP_TOOL_NAME;
}
