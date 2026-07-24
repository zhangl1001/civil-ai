import type { SqlDatabase, SqlRow, SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CandidateProfileId,
  AssessmentPolicyVersionId,
  CurriculumVersionId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  LocalDate,
  ProjectId,
  ScoreMeasurementId,
  ScoreTargetId,
  SubjectCode,
  TimeZoneId
} from '@/kernel/public';
import type {
  CandidateCycleBundle,
  CandidateProfile,
  CandidateProject,
  CandidateRepository,
  ExamCycle,
  LearningPreferences,
  ExamCyclePolicyBinding,
  OnboardingDraft,
  ScoreMeasurement,
  ScoreTarget,
  StudyConstraints
} from '../contracts/CandidateRepository';
import type { ExamCycleStatus } from '../domain/ExamCycleStatus';
import type { ExamPhase } from '../domain/ExamPhase';
import type { ExplanationDepth, ProactiveLevel } from '../domain/LearningPreferenceCodes';
import type { ProjectStatus } from '../domain/ProjectStatus';
import type { ScoreMeasurementType } from '../domain/ScoreMeasurementType';
import type { ScoreTargetSource, ScoreTargetStatus } from '../domain/ScoreTargetStatus';

interface ProjectRow extends SqlRow {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: number;
  updated_at: number;
  version: number;
}

interface ProfileRow extends SqlRow {
  id: string;
  project_id: string;
  preferred_name: string | null;
  time_zone: string;
  preparation_experience: string | null;
  current_state_json: string;
  extension_json: string;
  created_at: number;
  updated_at: number;
  version: number;
}

interface CycleRow extends SqlRow {
  id: string;
  project_id: string;
  exam_type: string;
  exam_name: string | null;
  province: string | null;
  position: string | null;
  exam_date: string;
  time_zone: string;
  phase: ExamPhase;
  status: ExamCycleStatus;
  curriculum_version_id: string;
  created_at: number;
  updated_at: number;
  version: number;
}

interface ScoreTargetRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  subject: string;
  target_score: number;
  max_score: number;
  source: ScoreTargetSource;
  reason: string | null;
  status: ScoreTargetStatus;
  effective_from: number;
  supersedes_target_id: string | null;
  created_at: number;
}

interface ScoreMeasurementRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  subject: string;
  module: string | null;
  score: number;
  max_score: number;
  measurement_type: ScoreMeasurementType;
  source: string;
  measured_at: number;
  confidence: number;
  metadata_json: string;
  created_at: number;
}

interface StudyConstraintsRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  study_mode: string;
  weekly_study_days: number;
  weekday_minutes: number;
  weekend_minutes: number;
  max_focus_minutes: number | null;
  available_windows_json: string;
  interruption_risks_json: string;
  updated_at: number;
  version: number;
}

interface LearningPreferencesRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  teaching_order: string;
  explanation_depth: ExplanationDepth;
  proactive_level: ProactiveLevel;
  companion_tone: string;
  quiet_hours_json: string;
  accessibility_json: string;
  extension_json: string;
  updated_at: number;
  version: number;
}

interface PolicyBindingRow extends SqlRow {
  exam_cycle_id: string;
  subject: string;
  policy_type: string;
  assessment_policy_version_id: string;
  bound_at: number;
}

interface OnboardingDraftRow extends SqlRow {
  id: string;
  draft_json: string;
  step_code: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

function parseJsonObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must contain a JSON object`);
  }
  return value as JsonObject;
}

function parseJsonObjectArray(serialized: string, field: string): readonly JsonObject[] {
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new TypeError(`${field} must contain a JSON object array`);
  }
  return value as JsonObject[];
}

export class SqliteCandidateRepository implements CandidateRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async createCycleBundle(bundle: CandidateCycleBundle, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await this.insertProject(transaction, bundle.project);
    await this.insertProfile(transaction, bundle.profile);
    await this.insertCycle(transaction, bundle.examCycle);
    for (const target of bundle.scoreTargets) await this.insertScoreTarget(transaction, target);
    for (const measurement of bundle.scoreMeasurements) await this.insertScoreMeasurement(transaction, measurement);
    await this.insertStudyConstraints(transaction, bundle.studyConstraints);
    await this.insertLearningPreferences(transaction, bundle.learningPreferences);
    for (const binding of bundle.policyBindings) await this.insertPolicyBinding(transaction, binding);
  }

  async replaceActiveScoreTargets(targets: readonly ScoreTarget[], context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    for (const target of targets) {
      if (!target.supersedesTargetId) throw new Error('Replacement score target must reference its predecessor');
      const result = await transaction.run(
        `UPDATE score_targets
         SET status = 'superseded'
         WHERE id = ? AND exam_cycle_id = ? AND subject = ? AND status = 'active'`,
        [target.supersedesTargetId, target.examCycleId, target.subject]
      );
      if (result.changes !== 1) throw new Error(`Active score target conflict for ${target.subject}`);
      await this.insertScoreTarget(transaction, target);
    }
  }

  async findCurrentCycle(): Promise<CandidateCycleBundle | undefined> {
    const projects = await this.database.query<ProjectRow>(
      `SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`
    );
    const project = projects[0];
    return project ? this.findActiveCycle(project.id as ProjectId) : undefined;
  }

  async findCycle(examCycleId: ExamCycleId): Promise<CandidateCycleBundle | undefined> {
    const cycles = await this.database.query<CycleRow>('SELECT * FROM exam_cycles WHERE id = ? LIMIT 1', [examCycleId]);
    const cycle = cycles[0];
    return cycle ? this.loadBundle(cycle) : undefined;
  }

  async findActiveCycle(projectId: ProjectId): Promise<CandidateCycleBundle | undefined> {
    const cycles = await this.database.query<CycleRow>(
      `SELECT * FROM exam_cycles
       WHERE project_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
      [projectId]
    );
    const cycleRow = cycles[0];
    if (!cycleRow) return undefined;

    return this.loadBundle(cycleRow);
  }

  private async loadBundle(cycleRow: CycleRow): Promise<CandidateCycleBundle> {
    const projectId = cycleRow.project_id as ProjectId;
    const [projects, profiles, targets, measurements, constraints, preferences, bindings] = await Promise.all([
      this.database.query<ProjectRow>('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]),
      this.database.query<ProfileRow>('SELECT * FROM candidate_profiles WHERE project_id = ? LIMIT 1', [projectId]),
      this.database.query<ScoreTargetRow>(
        'SELECT * FROM score_targets WHERE exam_cycle_id = ? ORDER BY effective_from DESC',
        [cycleRow.id]
      ),
      this.database.query<ScoreMeasurementRow>(
        'SELECT * FROM score_measurements WHERE exam_cycle_id = ? ORDER BY measured_at DESC',
        [cycleRow.id]
      ),
      this.database.query<StudyConstraintsRow>('SELECT * FROM study_constraints WHERE exam_cycle_id = ? LIMIT 1', [cycleRow.id]),
      this.database.query<LearningPreferencesRow>('SELECT * FROM learning_preferences WHERE exam_cycle_id = ? LIMIT 1', [cycleRow.id]),
      this.database.query<PolicyBindingRow>(
        'SELECT * FROM exam_cycle_policy_bindings WHERE exam_cycle_id = ? ORDER BY subject, policy_type',
        [cycleRow.id]
      )
    ]);
    const projectRow = projects[0];
    const profileRow = profiles[0];
    const constraintsRow = constraints[0];
    const preferencesRow = preferences[0];
    if (!projectRow || !profileRow || !constraintsRow || !preferencesRow) {
      throw new Error(`Candidate cycle bundle ${cycleRow.id} is incomplete`);
    }

    return {
      project: this.mapProject(projectRow),
      profile: this.mapProfile(profileRow),
      examCycle: this.mapCycle(cycleRow),
      scoreTargets: targets.map((row) => this.mapScoreTarget(row)),
      scoreMeasurements: measurements.map((row) => this.mapScoreMeasurement(row)),
      studyConstraints: this.mapStudyConstraints(constraintsRow),
      learningPreferences: this.mapLearningPreferences(preferencesRow),
      policyBindings: bindings.map((row) => this.mapPolicyBinding(row))
    };
  }

  async saveOnboardingDraft(draft: OnboardingDraft): Promise<void> {
    await this.database.run(
      `INSERT INTO onboarding_drafts(id, draft_json, step_code, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         draft_json = excluded.draft_json,
         step_code = excluded.step_code,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
      [draft.id, JSON.stringify(draft.data), draft.stepCode, draft.createdAt, draft.updatedAt, draft.expiresAt ?? null]
    );
  }

  async findOnboardingDraft(draftId: string): Promise<OnboardingDraft | undefined> {
    const rows = await this.database.query<OnboardingDraftRow>(
      'SELECT * FROM onboarding_drafts WHERE id = ? LIMIT 1',
      [draftId]
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      stepCode: row.step_code,
      data: parseJsonObject(row.draft_json, 'onboarding_drafts.draft_json'),
      createdAt: row.created_at as InstantMs,
      updatedAt: row.updated_at as InstantMs,
      expiresAt: row.expires_at as InstantMs | null ?? undefined
    };
  }

  async deleteOnboardingDraft(draftId: string, context: TransactionContext): Promise<void> {
    await this.transactionScope.resolve(context).run('DELETE FROM onboarding_drafts WHERE id = ?', [draftId]);
  }

  private async insertProject(transaction: SqlTransaction, project: CandidateProject): Promise<void> {
    await transaction.run(
      `INSERT INTO projects(id, name, status, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [project.id, project.name, project.status, project.createdAt, project.updatedAt, project.version]
    );
  }

  private async insertProfile(transaction: SqlTransaction, profile: CandidateProfile): Promise<void> {
    await transaction.run(
      `INSERT INTO candidate_profiles(
        id, project_id, preferred_name, time_zone, preparation_experience,
        current_state_json, extension_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        profile.projectId,
        profile.preferredName ?? null,
        profile.timeZone,
        profile.preparationExperience ?? null,
        JSON.stringify(profile.currentState),
        JSON.stringify(profile.extension),
        profile.createdAt,
        profile.updatedAt,
        profile.version
      ]
    );
  }

  private async insertCycle(transaction: SqlTransaction, cycle: ExamCycle): Promise<void> {
    await transaction.run(
      `INSERT INTO exam_cycles(
        id, project_id, exam_type, exam_name, province, position, exam_date, time_zone,
        phase, status, curriculum_version_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cycle.id,
        cycle.projectId,
        cycle.examType,
        cycle.examName ?? null,
        cycle.province ?? null,
        cycle.position ?? null,
        cycle.examDate,
        cycle.timeZone,
        cycle.phase,
        cycle.status,
        cycle.curriculumVersionId,
        cycle.createdAt,
        cycle.updatedAt,
        cycle.version
      ]
    );
  }

  private async insertScoreTarget(transaction: SqlTransaction, target: ScoreTarget): Promise<void> {
    await transaction.run(
      `INSERT INTO score_targets(
        id, exam_cycle_id, subject, target_score, max_score, source, reason,
        status, effective_from, supersedes_target_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        target.id,
        target.examCycleId,
        target.subject,
        target.targetScore,
        target.maxScore,
        target.source,
        target.reason ?? null,
        target.status,
        target.effectiveFrom,
        target.supersedesTargetId ?? null,
        target.createdAt
      ]
    );
  }

  private async insertScoreMeasurement(transaction: SqlTransaction, measurement: ScoreMeasurement): Promise<void> {
    await transaction.run(
      `INSERT INTO score_measurements(
        id, exam_cycle_id, subject, module, score, max_score, measurement_type,
        source, measured_at, confidence, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        measurement.id,
        measurement.examCycleId,
        measurement.subject,
        measurement.module ?? null,
        measurement.score,
        measurement.maxScore,
        measurement.measurementType,
        measurement.source,
        measurement.measuredAt,
        measurement.confidence,
        JSON.stringify(measurement.metadata),
        measurement.createdAt
      ]
    );
  }

  private async insertStudyConstraints(transaction: SqlTransaction, constraints: StudyConstraints): Promise<void> {
    await transaction.run(
      `INSERT INTO study_constraints(
        id, exam_cycle_id, study_mode, weekly_study_days, weekday_minutes, weekend_minutes,
        max_focus_minutes, available_windows_json, interruption_risks_json, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        constraints.id,
        constraints.examCycleId,
        constraints.studyMode,
        constraints.weeklyStudyDays,
        constraints.weekdayMinutes,
        constraints.weekendMinutes,
        constraints.maxFocusMinutes ?? null,
        JSON.stringify(constraints.availableWindows),
        JSON.stringify(constraints.interruptionRisks),
        constraints.updatedAt,
        constraints.version
      ]
    );
  }

  private async insertLearningPreferences(transaction: SqlTransaction, preferences: LearningPreferences): Promise<void> {
    await transaction.run(
      `INSERT INTO learning_preferences(
        id, exam_cycle_id, teaching_order, explanation_depth, proactive_level,
        companion_tone, quiet_hours_json, accessibility_json, extension_json, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        preferences.id,
        preferences.examCycleId,
        preferences.teachingOrder,
        preferences.explanationDepth,
        preferences.proactiveLevel,
        preferences.companionTone,
        JSON.stringify(preferences.quietHours),
        JSON.stringify(preferences.accessibility),
        JSON.stringify(preferences.extension),
        preferences.updatedAt,
        preferences.version
      ]
    );
  }

  private async insertPolicyBinding(transaction: SqlTransaction, binding: ExamCyclePolicyBinding): Promise<void> {
    await transaction.run(
      `INSERT INTO exam_cycle_policy_bindings(
        exam_cycle_id, subject, policy_type, assessment_policy_version_id, bound_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [binding.examCycleId, binding.subject, binding.policyType, binding.assessmentPolicyVersionId, binding.boundAt]
    );
  }

  private mapProject(row: ProjectRow): CandidateProject {
    return {
      id: row.id as ProjectId,
      name: row.name,
      status: row.status,
      createdAt: row.created_at as InstantMs,
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapProfile(row: ProfileRow): CandidateProfile {
    return {
      id: row.id as CandidateProfileId,
      projectId: row.project_id as ProjectId,
      preferredName: row.preferred_name ?? undefined,
      timeZone: row.time_zone as TimeZoneId,
      preparationExperience: row.preparation_experience ?? undefined,
      currentState: parseJsonObject(row.current_state_json, 'candidate_profiles.current_state_json'),
      extension: parseJsonObject(row.extension_json, 'candidate_profiles.extension_json'),
      createdAt: row.created_at as InstantMs,
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapCycle(row: CycleRow): ExamCycle {
    return {
      id: row.id as ExamCycleId,
      projectId: row.project_id as ProjectId,
      examType: row.exam_type,
      examName: row.exam_name ?? undefined,
      province: row.province ?? undefined,
      position: row.position ?? undefined,
      examDate: row.exam_date as LocalDate,
      timeZone: row.time_zone as TimeZoneId,
      phase: row.phase,
      status: row.status,
      curriculumVersionId: row.curriculum_version_id as CurriculumVersionId,
      createdAt: row.created_at as InstantMs,
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapScoreTarget(row: ScoreTargetRow): ScoreTarget {
    return {
      id: row.id as ScoreTargetId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      subject: row.subject as SubjectCode,
      targetScore: row.target_score,
      maxScore: row.max_score,
      source: row.source,
      reason: row.reason ?? undefined,
      status: row.status,
      effectiveFrom: row.effective_from as InstantMs,
      supersedesTargetId: row.supersedes_target_id as ScoreTargetId | null ?? undefined,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapScoreMeasurement(row: ScoreMeasurementRow): ScoreMeasurement {
    return {
      id: row.id as ScoreMeasurementId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      subject: row.subject as SubjectCode,
      module: row.module ?? undefined,
      score: row.score,
      maxScore: row.max_score,
      measurementType: row.measurement_type,
      source: row.source,
      measuredAt: row.measured_at as InstantMs,
      confidence: row.confidence,
      metadata: parseJsonObject(row.metadata_json, 'score_measurements.metadata_json'),
      createdAt: row.created_at as InstantMs
    };
  }

  private mapStudyConstraints(row: StudyConstraintsRow): StudyConstraints {
    return {
      id: row.id,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      studyMode: row.study_mode,
      weeklyStudyDays: row.weekly_study_days,
      weekdayMinutes: row.weekday_minutes,
      weekendMinutes: row.weekend_minutes,
      maxFocusMinutes: row.max_focus_minutes ?? undefined,
      availableWindows: parseJsonObjectArray(row.available_windows_json, 'study_constraints.available_windows_json'),
      interruptionRisks: parseJsonObjectArray(row.interruption_risks_json, 'study_constraints.interruption_risks_json'),
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapLearningPreferences(row: LearningPreferencesRow): LearningPreferences {
    return {
      id: row.id,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      teachingOrder: row.teaching_order,
      explanationDepth: row.explanation_depth,
      proactiveLevel: row.proactive_level,
      companionTone: row.companion_tone,
      quietHours: parseJsonObjectArray(row.quiet_hours_json, 'learning_preferences.quiet_hours_json'),
      accessibility: parseJsonObject(row.accessibility_json, 'learning_preferences.accessibility_json'),
      extension: parseJsonObject(row.extension_json, 'learning_preferences.extension_json'),
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapPolicyBinding(row: PolicyBindingRow): ExamCyclePolicyBinding {
    return {
      examCycleId: row.exam_cycle_id as ExamCycleId,
      subject: row.subject as SubjectCode,
      policyType: row.policy_type,
      assessmentPolicyVersionId: row.assessment_policy_version_id as AssessmentPolicyVersionId,
      boundAt: row.bound_at as InstantMs
    };
  }
}
