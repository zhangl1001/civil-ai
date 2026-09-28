import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import { AssessmentRole, type CapabilityNodeId } from '@/kernel/public';
import type { AgentRunAggregate } from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import {
  GenerationWorkflowStatus,
  type RunStructuredObjectiveGenerationWorkflow
} from '@/modules/content/public';
import { ExamDeliveryKind, projectExamSubjects, type CurriculumRepository } from '@/modules/curriculum/public';
import type { RequestStructuredPractice } from '@/modules/teaching/public';
import type { BusinessAgentExecutionContext } from './BusinessAgentContracts';
import type { EnsureQuestionSetEnrichment } from './EnsureQuestionSetEnrichment';
import { selectPracticeCapability } from './selectPracticeCapability';

export interface BusinessPracticeGenerationDependencies {
  readonly candidates: Pick<CandidateRepository, 'findCurrentCycle'>;
  readonly curriculums: Pick<CurriculumRepository, 'findBundle'>;
  readonly requestStructuredPractice: Pick<RequestStructuredPractice, 'execute'>;
  readonly runStructuredObjectiveGenerationWorkflow: Pick<RunStructuredObjectiveGenerationWorkflow, 'execute' | 'retry'>;
  readonly ensureQuestionSetEnrichment: Pick<EnsureQuestionSetEnrichment, 'execute'>;
}

type GeneratePractice = BusinessAgentExecutionContext['generatePractice'];

/**
 * The generation idempotency key of one structured-practice request of a run.
 * A single practice keeps the key it always had, so a run created before this
 * change still finds its generation; each batch of a multi-batch run (a mock
 * exam) is scoped by its batch key, so a retried batch replays its own
 * generation and two batches never receive the same question set.
 */
export function structuredPracticeIdempotencyKey(agentRunId: string, batchKey?: string): string {
  const base = `agent-run:${agentRunId}:structured-practice`;
  const batch = batchKey?.trim();
  return batch ? `${base}:${batch}` : base;
}

export function createBusinessPracticeGenerator(input: {
  readonly run: AgentRunAggregate;
  readonly gateway: ProviderGateway;
  readonly signal: AbortSignal;
  readonly update: BusinessAgentExecutionContext['update'];
  readonly dependencies: BusinessPracticeGenerationDependencies;
}): GeneratePractice {
  const { run, gateway, signal, update, dependencies } = input;
  return async (request) => {
    signal.throwIfAborted();
    const cycle = await dependencies.candidates.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const curriculum = await dependencies.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
    // Objective practice targets whichever subjects this package answers with
    // questions, rather than the civil-service subject code: a track whose
    // subjects are named differently still generates.
    const objectiveSubjects = new Set(
      (curriculum ? projectExamSubjects(curriculum) : [])
        .filter((subject) => subject.deliveryKind === ExamDeliveryKind.Objective)
        .map((subject) => subject.code as string)
    );
    const nodes = curriculum?.capabilityNodes
      .filter((node) => node.status === 'active' && objectiveSubjects.has(node.subject)) ?? [];
    const capability = selectPracticeCapability(nodes, request);
    if (!capability) throw new Error('当前大纲没有可用的客观题能力节点。');
    await update(42, '调用 AI 生成结构化讲义和题目');
    const aggregate = await dependencies.requestStructuredPractice.execute({
      idempotencyKey: structuredPracticeIdempotencyKey(run.run.id, request.batchKey),
      sourceAgentRunId: run.run.rootAgentRunId,
      capabilityNodeId: capability.id as CapabilityNodeId,
      assessmentRole: AssessmentRole.Practice,
      requestedCount: request.requestedCount,
      difficultyMin: request.difficultyMin,
      difficultyMax: request.difficultyMax,
      goal: request.purpose,
      constraints: {
        source: 'agent_business_operation',
        module: request.module,
        knowledgePoint: request.knowledgePoint ?? capability.name,
        requestedBy: request.review ? 'wrongbook_review' : 'ai_or_practice_entry'
      }
    });
    if (aggregate.workflow.status === GenerationWorkflowStatus.Failed) {
      await dependencies.runStructuredObjectiveGenerationWorkflow.retry(aggregate.workflow.id);
    }
    const result = await dependencies.runStructuredObjectiveGenerationWorkflow.execute(
      aggregate.workflow.id,
      gateway,
      signal
    );
    signal.throwIfAborted();
    if (!result.questionSetId || !aggregate.spec.learningThreadId) {
      throw new Error('结构化题组生成失败：缺少题组或学习主线');
    }
    await dependencies.ensureQuestionSetEnrichment.execute({
      questionSetId: result.questionSetId,
      parentAgentRunId: run.run.id
    }).catch((error: unknown) => {
      console.warn('[TutorAgent] failed to schedule question-set enrichment', error);
    });
    return {
      questionSetId: result.questionSetId,
      learningThreadId: aggregate.spec.learningThreadId,
      capabilityNodeId: capability.id,
      capabilityCode: capability.code
    };
  };
}
