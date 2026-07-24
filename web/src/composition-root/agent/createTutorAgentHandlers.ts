import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import { AgentRunAction, AgentRunType, type AgentRunAggregate, type TutorAgentHandler, type TransitionAgentRun } from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { ErrorDiagnosisRepository, RunAiErrorDiagnosis } from '@/modules/evidence/public';
import { generationTaskService, type GenerationTaskInput } from '@/services/GenerationTaskService';
import { aiBusinessTools, type AIBusinessToolCall, type AIBusinessToolName, type AIBusinessToolResult } from '@/services/AIBusinessTools';

export function createTutorAgentHandlers(
  candidates: CandidateRepository,
  curriculums: CurriculumRepository,
  diagnoses: ErrorDiagnosisRepository,
  runErrorDiagnosis: RunAiErrorDiagnosis,
  transitionAgentRun: TransitionAgentRun
): readonly TutorAgentHandler[] {
  return [
    createGenerationHandler(AgentRunType.ContentGeneration, transitionAgentRun),
    createGenerationHandler(AgentRunType.TeachingPlan, transitionAgentRun),
    createGenerationHandler(AgentRunType.TutorTurn, transitionAgentRun),
    {
      runType: AgentRunType.ErrorDiagnosis,
      requiresGateway: true,
      execute: async (run, gateway, signal) => executeErrorDiagnosis(run, gateway, signal, candidates, curriculums, diagnoses, runErrorDiagnosis)
    }
  ];
}

async function executeErrorDiagnosis(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  candidates: CandidateRepository,
  curriculums: CurriculumRepository,
  diagnoses: ErrorDiagnosisRepository,
  runner: RunAiErrorDiagnosis
): Promise<void> {
  if (!gateway) throw new Error('Error diagnosis requires provider gateway');
  const provisionalDiagnosisId = text(run.run.inputSnapshot.provisionalDiagnosisId, 'provisionalDiagnosisId');
  const evidenceContext = object(run.run.inputSnapshot.evidence);
  if (!run.run.examCycleId) throw new Error('Error diagnosis run is missing its exam cycle');
  const cycle = await candidates.findCycle(run.run.examCycleId);
  if (!cycle) throw new Error(`Exam cycle does not exist: ${run.run.examCycleId}`);
  const curriculum = await curriculums.findBundle(cycle.examCycle.curriculumVersionId);
  if (!curriculum) throw new Error(`Curriculum does not exist: ${cycle.examCycle.curriculumVersionId}`);
  const diagnosis = await diagnoses.find(provisionalDiagnosisId as Parameters<ErrorDiagnosisRepository['find']>[0]);
  if (!diagnosis) throw new Error(`Provisional diagnosis does not exist: ${provisionalDiagnosisId}`);
  const capability = curriculum.capabilityNodes.find((node) => node.id === diagnosis.capabilityNodeId);
  await runner.execute({
    agentRunId: run.run.id,
    provisionalDiagnosisId: provisionalDiagnosisId as Parameters<RunAiErrorDiagnosis['execute']>[0]['provisionalDiagnosisId'],
    evidenceContext,
    subject: capability?.subject ?? '行测'
  }, gateway, signal);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Agent run input is missing ${field}`);
  return value.trim();
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function createGenerationHandler(runType: AgentRunType, transitionAgentRun: TransitionAgentRun): TutorAgentHandler {
  return {
    runType,
    execute: async (run, gateway, signal) => {
      void gateway;
      if (run.run.targetResourceType === 'chat_tool') {
        await executeChatTool(run, signal, transitionAgentRun);
        return;
      }
      if (run.run.targetResourceType === 'generation_task') {
        await executeGenerationTask(run, signal, transitionAgentRun);
        return;
      }
      throw new Error(`Unsupported agent run target: ${run.run.targetResourceType || 'unknown'}`);
    }
  };
}

async function executeChatTool(run: AgentRunAggregate, signal: AbortSignal | undefined, transitionAgentRun: TransitionAgentRun): Promise<void> {
  if (signal?.aborted) throw new Error('agent_run.worker_aborted');
  if (run.run.targetResourceType !== 'chat_tool') throw new Error('Agent run is not a chat tool run');
  const toolName = text(run.run.inputSnapshot.toolName, 'toolName') as AIBusinessToolName;
  const sessionId = text(run.run.inputSnapshot.chatSessionId, 'chatSessionId');
  const call: AIBusinessToolCall = {
    name: toolName,
    arguments: object(run.run.inputSnapshot.arguments)
  };
  const result: AIBusinessToolResult = await aiBusinessTools.execute(call, { sessionId });
  await transitionAgentRun.execute({
    idempotencyKey: `chat-tool:${run.run.id}:completed`,
    agentRunId: run.run.id,
    action: AgentRunAction.Complete,
    reasonCode: 'chat_tool.completed',
    checkpoint: { taskId: result.taskId || null, toolName, reply: result.reply },
    payload: { taskId: result.taskId || null, toolName, reply: result.reply }
  });
}

async function executeGenerationTask(run: AgentRunAggregate, signal: AbortSignal | undefined, transitionAgentRun: TransitionAgentRun): Promise<void> {
  if (signal?.aborted) throw new Error('agent_run.worker_aborted');
  if (run.run.targetResourceType !== 'generation_task') throw new Error('Agent run is not a generation task run');
  const input = generationInputFromRun(run);
  const projectId = text(run.run.inputSnapshot.projectId, 'projectId');
  const result = await generationTaskService.enqueueLegacy(projectId, input);
  await transitionAgentRun.execute({
    idempotencyKey: `generation:${run.run.id}:completed`,
    agentRunId: run.run.id,
    action: AgentRunAction.Complete,
    reasonCode: 'generation_task.completed',
    checkpoint: { taskId: result.task.id, intent: input.intent, title: input.title || result.task.title },
    payload: { taskId: result.task.id, intent: input.intent, title: input.title || result.task.title, reused: result.reused }
  });
}

function generationInputFromRun(run: AgentRunAggregate): GenerationTaskInput {
  const snapshot = object(run.run.inputSnapshot);
  const intent = snapshot.intent as GenerationTaskInput['intent'] | undefined;
  if (!intent) throw new Error('Generation task run is missing intent');
  return {
    intent,
    title: text(snapshot.title, 'title') || undefined,
    detail: text(snapshot.detail, 'detail') || undefined,
    module: text(snapshot.module, 'module') || undefined,
    sourceId: text(snapshot.sourceId, 'sourceId') || undefined,
    payload: isJsonObject(snapshot.payload) ? snapshot.payload : undefined
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
