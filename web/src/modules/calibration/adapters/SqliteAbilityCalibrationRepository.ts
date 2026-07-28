import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId } from '@/kernel/public';
import type {
  AbilityCalibrationRepository,
  AbilityCalibrationSnapshot
} from '../contracts/AbilityCalibrationRepository';

interface CalibrationRow extends SqlRow {
  snapshot_json: string;
}

export class SqliteAbilityCalibrationRepository implements AbilityCalibrationRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async findLatest(examCycleId: ExamCycleId): Promise<AbilityCalibrationSnapshot | undefined> {
    const rows = await this.database.query<CalibrationRow>(
      `SELECT snapshot_json FROM ability_calibration_snapshots
       WHERE exam_cycle_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [examCycleId]
    );
    return rows[0] ? parseSnapshot(rows[0].snapshot_json) : undefined;
  }

  async findByFingerprint(inputFingerprint: string): Promise<AbilityCalibrationSnapshot | undefined> {
    const rows = await this.database.query<CalibrationRow>(
      'SELECT snapshot_json FROM ability_calibration_snapshots WHERE input_fingerprint = ? LIMIT 1',
      [inputFingerprint]
    );
    return rows[0] ? parseSnapshot(rows[0].snapshot_json) : undefined;
  }

  async append(snapshot: AbilityCalibrationSnapshot, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      `INSERT INTO ability_calibration_snapshots(
        id, exam_cycle_id, algorithm_version, evidence_cutoff_at,
        input_fingerprint, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.examCycleId,
        snapshot.algorithmVersion,
        snapshot.evidenceCutoffAt,
        snapshot.inputFingerprint,
        JSON.stringify(snapshot),
        snapshot.createdAt
      ]
    );
  }
}

function parseSnapshot(value: string): AbilityCalibrationSnapshot {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Ability calibration snapshot must be an object');
  }
  return parsed as AbilityCalibrationSnapshot;
}
