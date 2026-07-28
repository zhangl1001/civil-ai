import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, QuestionSourceId } from '@/kernel/public';
import type { QuestionSourceRepository } from '../contracts/QuestionSourceRepository';

export class ArchiveQuestionSource {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: QuestionSourceRepository,
    private readonly clock: Clock
  ) {}

  async execute(sourceId: QuestionSourceId): Promise<void> {
    await this.unitOfWork.runAutocommit(async (context) => {
      await this.repository.archiveSource(sourceId, this.clock.now(), context);
    });
  }
}
