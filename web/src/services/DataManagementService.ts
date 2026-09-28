import { initializeTutorRuntime } from '@/composition-root/public';
import { DataBackupService } from './DataBackupService';

export type { DataBackup } from './DataBackupFormat';
export type { DataSummary } from './DataBackupService';

/** Binds backup and cleanup to the app's tutor runtime; the logic lives in DataBackupService. */
export class DataManagementService extends DataBackupService {
  constructor() {
    super(initializeTutorRuntime);
  }
}

export const dataManagementService = new DataManagementService();
