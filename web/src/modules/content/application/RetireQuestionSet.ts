import type { UnitOfWork } from '@/capabilities/database/public';
import type { QuestionSetId } from '@/kernel/public';
import type { ContentRepository } from '../contracts/ContentRepository';
import { QuestionSetStatus } from '../domain/ContentCodes';

export class RetireQuestionSet {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ContentRepository
  ) {}

  async execute(questionSetId: QuestionSetId): Promise<boolean> {
    const bundle = await this.repository.findQuestionSet(questionSetId);
    if (!bundle || bundle.questionSet.status !== QuestionSetStatus.Ready) return false;
    await this.unitOfWork.run((context) => this.repository.retireQuestionSet(questionSetId, context));
    return true;
  }
}
