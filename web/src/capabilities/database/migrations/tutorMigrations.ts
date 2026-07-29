import foundationSql from './001_foundation.sql?raw';
import contentAiFoundationSql from './002_content_ai_foundation.sql?raw';
import learningEvidenceSql from './003_learning_evidence.sql?raw';
import errorDiagnosisConfirmationsSql from './004_error_diagnosis_confirmations.sql?raw';
import tutorAgentRuntimeSql from './005_tutor_agent_runtime.sql?raw';
import masteryPlanningSql from './006_mastery_planning_foundation.sql?raw';
import reviewExecutionLinkageSql from './007_review_execution_linkage.sql?raw';
import taskMessageCenterSql from './008_task_message_center.sql?raw';
import planFeedbackProactiveSignalsSql from './009_plan_feedback_proactive_signals.sql?raw';
import learningAssetsSql from './010_learning_assets.sql?raw';
import conversationsSql from './011_conversations.sql?raw';
import learningAssetAndSessionIndexesSql from './012_learning_asset_and_session_indexes.sql?raw';
import agentRunTargetIndexSql from './013_agent_run_target_index.sql?raw';
import conversationMessageLogsSql from './014_conversation_message_logs.sql?raw';
import conversationSessionIndexSql from './015_conversation_session_index.sql?raw';
import agentWorkspaceSessionsSql from './016_agent_workspace_sessions.sql?raw';
import practiceSessionDraftsSql from './017_practice_session_drafts.sql?raw';
import agentWorkPoolsSql from './018_agent_work_pools.sql?raw';
import practiceManifestsSql from './019_practice_manifests.sql?raw';
import errorDiagnosisGuidanceSql from './020_error_diagnosis_guidance.sql?raw';
import questionSetPracticeStatusSql from './021_question_set_practice_status.sql?raw';
import questionSourceFoundationSql from './022_question_source_foundation.sql?raw';
import questionImportDraftsSql from './023_question_import_drafts.sql?raw';
import trueQuestionReferencePacksSql from './024_true_question_reference_packs.sql?raw';
import tutorCycleConclusionsSql from './025_tutor_cycle_conclusions.sql?raw';
import abilityCalibrationSnapshotsSql from './026_ability_calibration_snapshots.sql?raw';
import webResearchImportMethodSql from './027_web_research_import_method.sql?raw';
import referencePackComparisonQuestionsSql from './028_reference_pack_comparison_questions.sql?raw';
import questionSetLibraryPaginationSql from './029_question_set_library_pagination.sql?raw';
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
  },
  {
    version: 8,
    name: 'task_message_center',
    checksum: 'sha256:2b95e0e5e034a9d124f7e00c93903e7b7c533f40880ab007b7412383f9a4d91e',
    sql: taskMessageCenterSql
  },
  {
    version: 9,
    name: 'plan_feedback_proactive_signals',
    checksum: 'sha256:bba68fdc2818b4fabc7b98387a4968545af204593e4a578f31e022c9c0353ccd',
    sql: planFeedbackProactiveSignalsSql
  },
  {
    version: 10,
    name: 'learning_assets',
    checksum: 'sha256:fbf5f0c0050719e34f13ee65ad66a6a226d90adbe6867fdbe320d2674950fc05',
    sql: learningAssetsSql
  },
  {
    version: 11,
    name: 'conversations',
    checksum: 'sha256:c4c115cdfda63d57e9d5024671b13577b682acd538ab6cd34821c8c165480261',
    sql: conversationsSql
  },
  {
    version: 12,
    name: 'learning_asset_and_session_indexes',
    checksum: 'sha256:68077786280e5d48fb86d57f12f23c4352aec9900c38cfb5275fd7dd819c9c8e',
    sql: learningAssetAndSessionIndexesSql
  },
  {
    version: 13,
    name: 'agent_run_target_index',
    checksum: 'sha256:061941d8b30ca3e3befa0d32c445e1bfd76b4376647b1c655019a65dd48d0e6b',
    sql: agentRunTargetIndexSql
  },
  {
    version: 14,
    name: 'conversation_message_logs',
    checksum: 'sha256:d695c89eb93458eb7e04bb4a7dd89fb45643a0cd62f906f6a8fa8adb15b6096d',
    sql: conversationMessageLogsSql
  },
  {
    version: 15,
    name: 'conversation_session_index',
    checksum: 'sha256:60296081e434ce20e0391e5073afe5a11e04bb705aa207ee6ee1cb4abeabf6d3',
    sql: conversationSessionIndexSql
  },
  {
    version: 16,
    name: 'agent_workspace_sessions',
    checksum: 'sha256:dfd6259c8d4c13c84f5071a02e852c7d6348cc67390f567f0fe3e410ab04b35f',
    sql: agentWorkspaceSessionsSql
  },
  {
    version: 17,
    name: 'practice_session_drafts',
    checksum: 'sha256:82f897e92fd79d083834d8b83fd334a1bb04cbb7a7442220f37df826d601cf72',
    sql: practiceSessionDraftsSql
  },
  {
    version: 18,
    name: 'agent_work_pools',
    checksum: 'sha256:b9641dcca8b3e4202b5e76f1e46791375fb0ecf8933be98edf4a47b4d79d2645',
    sql: agentWorkPoolsSql
  },
  {
    version: 19,
    name: 'practice_manifests',
    checksum: 'sha256:182d88817157adbce377fd06859c4e7de96a6100985b829ffee778ae1c2a6132',
    sql: practiceManifestsSql
  },
  {
    version: 20,
    name: 'error_diagnosis_guidance',
    checksum: 'sha256:c598bd4a7c36953919699afab328cb3ecd2133388cdc1c0731de77d89d5781ef',
    sql: errorDiagnosisGuidanceSql
  },
  {
    version: 21,
    name: 'question_set_practice_status',
    checksum: 'sha256:7f6356296ef751d6fb75f0e6354c0d488363c63c5214b977586719bffd91c680',
    sql: questionSetPracticeStatusSql
  },
  {
    version: 22,
    name: 'question_source_foundation',
    checksum: 'sha256:e5c5c690679ebaaafab7d883195474d32121891d8a2350ed9e5a8ec35974abe8',
    sql: questionSourceFoundationSql
  },
  {
    version: 23,
    name: 'question_import_drafts',
    checksum: 'sha256:10bb3b08c49122a6925f0b726c0268401fc28e30e696930964b320d8fa47a19f',
    sql: questionImportDraftsSql
  },
  {
    version: 24,
    name: 'true_question_reference_packs',
    checksum: 'sha256:07f58b1b6649f5123a7424399207fffe23455aaf8446c651f433e95dc1b75a67',
    sql: trueQuestionReferencePacksSql
  },
  {
    version: 25,
    name: 'tutor_cycle_conclusions',
    checksum: 'sha256:7a517c7b0d44b0047e0a15535287f3106a1eec0086814d3fd39f742b741c0adc',
    sql: tutorCycleConclusionsSql
  },
  {
    version: 26,
    name: 'ability_calibration_snapshots',
    checksum: 'sha256:c82cea65fba4fdaea2dec113b286278531f1ee59ab133a69c163b1b9d0abea36',
    sql: abilityCalibrationSnapshotsSql
  },
  {
    version: 27,
    name: 'web_research_import_method',
    checksum: 'sha256:8e2283e75dee1a44cbb34810787ab65f24d7f569d7ef56813034bfb5cf58b4bd',
    sql: webResearchImportMethodSql
  },
  {
    version: 28,
    name: 'reference_pack_comparison_questions',
    checksum: 'sha256:46325ab71bb7b86eaddc68460f9040d1fbeb1a802aff1c0b75a073abe8c6b76b',
    sql: referencePackComparisonQuestionsSql
  },
  {
    version: 29,
    name: 'question_set_library_pagination',
    checksum: 'sha256:00377836edcb6a7c44e65f2779eb5c19c41b73cc32b15194120ce8b91ff7a28c',
    sql: questionSetLibraryPaginationSql
  }
];
