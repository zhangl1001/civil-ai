import type { ModelMessage, ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import type {
  AgentRuntimeEvent,
  AgentToolExecutionContext,
  AgentToolExecutor
} from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import {
  AgentToolRisk,
  AgentToolRole,
  type AgentToolDefinition
} from '../domain/AgentToolRegistry';
import { createToolObservationMessage, limitToolResult } from './AgentLoopSupport';

export interface AgentExecutableToolCall {
  readonly definition: AgentToolDefinition;
  readonly call: ModelToolCall;
}

export interface AgentToolCallBatch {
  readonly messages: readonly ModelMessage[];
  readonly terminalText?: string;
  readonly activateToolNames: readonly string[];
  readonly activateSkills: readonly AgentSkillActivation[];
  readonly executedOperationalTool: boolean;
  readonly progressCount: number;
  readonly completedWriteToolNames: readonly string[];
  readonly completedAsyncWrite: boolean;
  readonly executedCompletionVerifier: boolean;
  readonly observations: readonly AgentToolCallObservation[];
}

export interface AgentToolCallObservation {
  readonly call: ModelToolCall;
  readonly status: 'succeeded' | 'no_progress' | 'failed';
  readonly retryable: boolean;
  readonly failureCode?: string;
}

interface ToolCallOutcome {
  readonly message: ModelMessage;
  readonly terminalText?: string;
  readonly activateToolNames?: readonly string[];
  readonly activateSkills?: readonly AgentSkillActivation[];
  readonly madeProgress: boolean;
  readonly resultRef?: string;
  readonly observation: Omit<AgentToolCallObservation, 'call'>;
}

export async function executeAgentToolCalls(
  executor: AgentToolExecutor,
  emit: (event: AgentRuntimeEvent) => Promise<void>,
  command: {
    readonly agentRunId: AgentRunId;
    readonly executionContext: AgentToolExecutionContext;
  },
  calls: readonly AgentExecutableToolCall[],
  maxParallelReads: number,
  maxResultChars: number,
  signal?: AbortSignal
): Promise<AgentToolCallBatch> {
  const messages: ModelMessage[] = [];
  let terminalText: string | undefined;
  const activateToolNames = new Set<string>();
  const activateSkills = new Map<string, AgentSkillActivation>();
  let executedOperationalTool = false;
  let progressCount = 0;
  const completedWriteToolNames = new Set<string>();
  let completedAsyncWrite = false;
  let executedCompletionVerifier = false;
  const observations: AgentToolCallObservation[] = [];
  let cursor = 0;
  const record = (entry: AgentExecutableToolCall, outcome: ToolCallOutcome) => {
    messages.push(outcome.message);
    observations.push({ call: entry.call, ...outcome.observation });
    terminalText ||= outcome.terminalText;
    outcome.activateToolNames?.forEach((name) => activateToolNames.add(name));
    outcome.activateSkills?.forEach((skill) => activateSkills.set(skill.name, skill));
    if (entry.definition.role !== AgentToolRole.SkillSelector && outcome.madeProgress) {
      executedOperationalTool = true;
    }
    if (outcome.madeProgress) progressCount += 1;
    if (entry.definition.risk !== AgentToolRisk.Read && outcome.madeProgress) {
      completedWriteToolNames.add(entry.definition.name);
      if (outcome.resultRef) completedAsyncWrite = true;
    }
    if (entry.definition.role === AgentToolRole.CompletionVerifier && outcome.madeProgress) {
      executedCompletionVerifier = true;
    }
  };

  while (cursor < calls.length) {
    signal?.throwIfAborted();
    const current = calls[cursor];
    if (current.definition.risk !== AgentToolRisk.Read) {
      record(current, await executeAgentToolCall(
        executor,
        emit,
        command,
        current,
        maxResultChars,
        signal
      ));
      cursor += 1;
      if (terminalText) break;
      continue;
    }
    const readBatch: AgentExecutableToolCall[] = [];
    while (
      cursor < calls.length
      && calls[cursor].definition.risk === AgentToolRisk.Read
      && readBatch.length < maxParallelReads
    ) {
      readBatch.push(calls[cursor]);
      cursor += 1;
    }
    const outcomes = await Promise.all(readBatch.map((entry) => executeAgentToolCall(
      executor,
      emit,
      command,
      entry,
      maxResultChars,
      signal
    )));
    outcomes.forEach((outcome, index) => record(readBatch[index], outcome));
  }

  return {
    messages,
    terminalText,
    activateToolNames: [...activateToolNames],
    activateSkills: [...activateSkills.values()],
    executedOperationalTool,
    progressCount,
    completedWriteToolNames: [...completedWriteToolNames],
    completedAsyncWrite,
    executedCompletionVerifier,
    observations
  };
}

async function executeAgentToolCall(
  executor: AgentToolExecutor,
  emit: (event: AgentRuntimeEvent) => Promise<void>,
  command: {
    readonly agentRunId: AgentRunId;
    readonly executionContext: AgentToolExecutionContext;
  },
  entry: AgentExecutableToolCall,
  maxResultChars: number,
  signal?: AbortSignal
): Promise<ToolCallOutcome> {
  const { definition, call } = entry;
  await emit({ type: 'tool_call_started', agentRunId: command.agentRunId, call });
  try {
    const result = await executor.execute(definition, call, {
      ...command.executionContext,
      signal
    });
    const madeProgress = !result.isError && (result.madeProgress ?? Boolean(
      result.content.trim()
      || result.resultRef
      || result.activateToolNames?.length
      || result.activateSkills?.length
    ));
    const status = result.isError
      ? 'failed'
      : madeProgress
        ? 'succeeded'
        : 'no_progress';
    const retryable = result.isError ? result.retryable !== false : status === 'no_progress';
    await emit(result.isError
      ? {
          type: 'tool_call_failed',
          agentRunId: command.agentRunId,
          call,
          reasonCode: 'agent.tool_execution_error'
        }
      : {
          type: 'tool_call_succeeded',
          agentRunId: command.agentRunId,
          call,
          resultRef: result.resultRef
        });
    return {
      message: createToolObservationMessage(call, {
        status,
        content: limitToolResult(result.content, maxResultChars),
        retryable,
        failureCode: result.failureCode
      }),
      terminalText: result.terminalText,
      activateToolNames: result.activateToolNames,
      activateSkills: result.activateSkills,
      resultRef: result.resultRef,
      madeProgress,
      observation: {
        status,
        retryable,
        failureCode: result.failureCode
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit({
      type: 'tool_call_failed',
      agentRunId: command.agentRunId,
      call,
      reasonCode: 'agent.tool_execution_failed'
    });
    return {
      message: createToolObservationMessage(call, {
        status: 'failed',
        content: limitToolResult(`工具执行失败：${message}`, maxResultChars),
        retryable: true,
        failureCode: 'agent.tool_execution_failed'
      }),
      madeProgress: false,
      observation: {
        status: 'failed',
        retryable: true,
        failureCode: 'agent.tool_execution_failed'
      }
    };
  }
}
