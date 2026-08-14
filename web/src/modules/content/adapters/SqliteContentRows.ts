import type { SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { AssessmentRole } from '@/kernel/public';
import type {
  GenerationSpecRecord,
  GenerationWorkflowRecord,
  LectureRecord,
  QuestionCapabilityLink
} from '../contracts/ContentRepository';
import type {
  ContentAssetStatus,
  ContentDocumentType,
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  PublishedAssetStatus,
  QuestionQualityStatus,
  QuestionSetEntryMode,
  QuestionSetPracticeStatus,
  QuestionSetPurpose,
  QuestionSetStatus,
  QuestionTemplateCode
} from '../domain/ContentCodes';
import type {
  QuestionCalibrationRole,
  QuestionGenerationIntent,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';

/**
 * Row shapes returned by the content tables.
 *
 * Separated from the repository so that file stays about behaviour — the
 * queries and the mapping — rather than about column lists.
 */
export interface ReleaseRow extends SqlRow { id: string; content_hash: string; }
export interface SchemaRow extends SqlRow {
  id: string; schema_code: string; document_type: ContentDocumentType; version: string;
  schema_json: string; content_hash: string; status: PublishedAssetStatus; created_at: number;
}
export interface TemplateRow extends SqlRow {
  id: string; template_code: QuestionTemplateCode; version: string; renderer_code: string;
  content_schema_version_id: string; config_json: string; content_hash: string;
  status: PublishedAssetStatus; created_at: number;
}
export interface SpecRow extends SqlRow {
  id: string; source_agent_run_id: string | null; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; content_kind: GenerationSpecRecord['contentKind'];
  assessment_role: AssessmentRole; question_template_version_id: string | null; content_schema_version_id: string;
  prompt_version_id: string;
  reference_pack_id: string | null; reference_policy_version: string | null;
  generation_intent: QuestionGenerationIntent | null; calibration_target: string | null;
  requested_count: number | null; difficulty_json: string; constraints_json: string; context_snapshot_json: string;
  content_hash: string; created_at: number;
}
export interface WorkflowRow extends SqlRow {
  id: string; exam_cycle_id: string; generation_spec_id: string; workflow_type: GenerationWorkflowRecord['workflowType'];
  status: GenerationWorkflowStatus; current_step: GenerationWorkflowStep; attempt_count: number;
  staged_result_json: string | null; validation_json: string; error_code: string | null; idempotency_key: string;
  started_at: number; completed_at: number | null; updated_at: number; version: number;
}
export interface DocumentRow extends SqlRow {
  id: string; exam_cycle_id: string; document_type: ContentDocumentType; schema_version_id: string;
  title: string | null; content_json: string; content_hash: string; status: ContentAssetStatus;
  content_version: number; supersedes_document_id: string | null; generator_workflow_id: string | null; created_at: number;
}
export interface LectureRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; content_document_id: string;
  objective: string; status: LectureRecord['status']; version: number; created_at: number;
}
export interface QuestionSetRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; generation_spec_id: string;
  purpose: QuestionSetPurpose; assessment_role: AssessmentRole; module: string; status: QuestionSetStatus;
  origin_type: QuestionOriginType; source_id: string | null; calibration_role: QuestionCalibrationRole;
  practice_status: QuestionSetPracticeStatus; entry_mode: QuestionSetEntryMode; question_count: number; content_hash: string | null; content_version: number;
  grading_policy_json: string | null; created_at: number;
}
export interface QuestionSetLibraryRow extends QuestionSetRow {
  constraints_json: string;
  source_type: QuestionOriginType | null;
  source_provider: string | null;
  source_exam_type: string | null;
  source_exam_year: number | null;
  source_province: string | null;
  source_exam_batch: string | null;
  source_paper_name: string | null;
  source_section_name: string | null;
}
export interface QuestionRow extends SqlRow {
  id: string; question_set_id: string; exam_cycle_id: string; capability_node_id: string;
  question_template_version_id: string; sequence: number; difficulty: number; cognitive_level: string;
  purpose: string; assessment_role: AssessmentRole; variant_group_id: string | null; content_json: string;
  origin_type: QuestionOriginType; source_id: string | null; source_sequence: number | null;
  lineage_id: string | null; calibration_role: QuestionCalibrationRole; is_official: number;
  correct_answer_json: string; quality_status: QuestionQualityStatus; content_hash: string;
  content_schema_version_id: string; content_version: number; generator_workflow_id: string; created_at: number;
}
export interface CapabilityLinkRow extends SqlRow {
  question_id: string; capability_node_id: string; relation_role: QuestionCapabilityLink['relationRole']; weight: number;
}
export interface LectureLinkRow extends SqlRow {
  lecture_id: string; question_set_id: string; relation_role: 'primary' | 'extension' | 'review';
}
