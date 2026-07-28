import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId } from '@/kernel/public';
import type {
  AbilityCalibrationRepository,
  AbilityCalibrationSnapshot
} from '../contracts/AbilityCalibrationRepository';

export class IndexedDbAbilityCalibrationRepository implements AbilityCalibrationRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async findLatest(examCycleId: ExamCycleId): Promise<AbilityCalibrationSnapshot | undefined> {
    const values = await this.database.getAllByIndex<AbilityCalibrationSnapshot>(
      TutorIndexedDbStore.AbilityCalibrationSnapshots,
      'by_exam_cycle',
      examCycleId
    );
    return [...values].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0];
  }

  async findByFingerprint(inputFingerprint: string): Promise<AbilityCalibrationSnapshot | undefined> {
    return (await this.database.getAllByIndex<AbilityCalibrationSnapshot>(
      TutorIndexedDbStore.AbilityCalibrationSnapshots,
      'by_input_fingerprint',
      inputFingerprint
    ))[0];
  }

  async append(snapshot: AbilityCalibrationSnapshot, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.AbilityCalibrationSnapshots,
      value: snapshot
    });
  }
}
