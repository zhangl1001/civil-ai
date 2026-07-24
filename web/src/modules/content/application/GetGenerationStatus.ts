import type { WorkflowId } from '@/kernel/public';
import type { ContentRepository, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type { GenerationRepository } from '../contracts/GenerationRepository';
import { GenerationWorkflowStatus } from '../domain/ContentCodes';

export interface GenerationStatusView {
  readonly workflow: GenerationWorkflowRecord;
  readonly questionSetId?: string;
}

export class GetGenerationStatus {
  constructor(
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository
  ) {}

  async execute(workflowId: WorkflowId): Promise<GenerationStatusView | undefined> {
    const aggregate = await this.generationRepository.findByWorkflowId(workflowId);
    if (!aggregate) return undefined;
    if (aggregate.workflow.status !== GenerationWorkflowStatus.Committed) {
      return { workflow: aggregate.workflow };
    }
    const bundle = await this.contentRepository.findQuestionSetByGenerationSpec(aggregate.spec.id);
    if (!bundle) throw new Error(`Committed generation has no question set: ${workflowId}`);
    return { workflow: aggregate.workflow, questionSetId: bundle.questionSet.id };
  }
}
