import foundationSql from './001_foundation.sql?raw';
import contentAiFoundationSql from './002_content_ai_foundation.sql?raw';
import learningEvidenceSql from './003_learning_evidence.sql?raw';
import errorDiagnosisConfirmationsSql from './004_error_diagnosis_confirmations.sql?raw';
import tutorAgentRuntimeSql from './005_tutor_agent_runtime.sql?raw';
import masteryPlanningSql from './006_mastery_planning_foundation.sql?raw';
import reviewExecutionLinkageSql from './007_review_execution_linkage.sql?raw';
import type { Migration } from './Migration';

export const tutorMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'foundation',
    checksum: 'sha256:04f3b3f394d516d40180e53c81f8b0346ce81eff8d8d662d48b9509b6c4c092d',
    sql: foundationSql
  },
  {
    version: 2,
    name: 'content_ai_foundation',
    checksum: 'sha256:a7375a7497a7e3b2b8a7636647befa35c8df768863425e0d0b8a86fbe70ece7f',
    sql: contentAiFoundationSql
  },
  {
    version: 3,
    name: 'learning_evidence',
    checksum: 'sha256:ffaf25d47ea107d08c9c1387279f6a288ac711f41e3510b277b4b90dbb26dcfa',
    sql: learningEvidenceSql
  },
  {
    version: 4,
    name: 'error_diagnosis_confirmations',
    checksum: 'sha256:9d5c9599b7a0ee51a4c6cfa80435efcb6c6c85d9d5eede84584405c3b3033ad8',
    sql: errorDiagnosisConfirmationsSql
  },
  {
    version: 5,
    name: 'tutor_agent_runtime',
    checksum: 'sha256:c00ce3966b3e6e43d1f7ad78aa68a026705d575ab79127a797362a5475ca6fff',
    sql: tutorAgentRuntimeSql
  },
  {
    version: 6,
    name: 'mastery_planning_foundation',
    checksum: 'sha256:680e76f273794cda8c8169ea58031257744229387e47b2da0cfd4ee547a745b9',
    sql: masteryPlanningSql
  },
  {
    version: 7,
    name: 'review_execution_linkage',
    checksum: 'sha256:e3cb4d1cd8002e0d68e67fb1020032a2f3bc5a227fdb4096bd0c4adf6a47a331',
    sql: reviewExecutionLinkageSql
  }
];
