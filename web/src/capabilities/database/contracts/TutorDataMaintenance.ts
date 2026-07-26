import type { ExamCycleId } from '@/kernel/public';
import type { TransactionContext } from './UnitOfWork';

export interface TutorDataMaintenance {
  clearLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<number>;
}
