// Learning data fixtures for backup round trips. Every table (SQLite) or store
// (IndexedDB) clearLearningData touches holds rows for the cycle under test and
// for a second, completed cycle that must come through untouched.

export const cycleA = 'cycle-a';
export const cycleB = 'cycle-b';

export function sqliteMetadataSql() {
  return [
    insert('metadata_packages', {
      id: 'metadata-1', package_type: 'curriculum', exam_type: 'civil_service', region_scope: 'national',
      version: '1.0.0', status: 'published', source: 'bundled', content_hash: '0123456789abcdef',
      schema_version: '1', published_at: 1000, installed_at: 1000
    }),
    insert('curriculum_versions', {
      id: 'curriculum-1', metadata_package_id: 'metadata-1', exam_type: 'civil_service', region_scope: 'national',
      version: '1.0.0', content_hash: '0123456789abcdef', status: 'published', created_at: 1000
    }),
    insert('capability_nodes', {
      id: 'capability-1', curriculum_version_id: 'curriculum-1', code: 'aptitude.judgment.weakening', name: '削弱论证',
      node_type: 'knowledge_point', subject: 'aptitude', module: '判断推理', sequence: 1, score_weight: 1,
      mastery_policy_json: '{}'
    }),
    insert('capability_nodes', {
      id: 'capability-2', curriculum_version_id: 'curriculum-1', code: 'aptitude.judgment.strengthening', name: '加强论证',
      node_type: 'knowledge_point', subject: 'aptitude', module: '判断推理', sequence: 2, score_weight: 1,
      mastery_policy_json: '{}'
    }),
    insert('content_metadata_releases', {
      id: 'content-release-v1', version: '1.0.0', content_hash: '0123456789abcdef', status: 'published', created_at: 1000
    }),
    insert('content_schema_versions', {
      id: 'schema-question-v1', release_id: 'content-release-v1', schema_code: 'question.single_choice',
      document_type: 'question', version: '1.0.0', schema_json: '{}', content_hash: '0123456789abcdef',
      status: 'published', created_at: 1000
    }),
    insert('content_schema_versions', {
      id: 'schema-lecture-v1', release_id: 'content-release-v1', schema_code: 'lecture.document',
      document_type: 'lecture', version: '1.0.0', schema_json: '{}', content_hash: '1123456789abcdef',
      status: 'published', created_at: 1000
    }),
    insert('question_template_versions', {
      id: 'template-single-v1', release_id: 'content-release-v1', template_code: 'single_choice', version: '1.0.0',
      renderer_code: 'single_choice', content_schema_version_id: 'schema-question-v1', config_json: '{}',
      content_hash: '0123456789abcdef', status: 'published', created_at: 1000
    }),
    insert('prompt_definitions', {
      id: 'prompt-question', prompt_code: 'question.generate.weakening', task_type: 'content_generation',
      description: '生成削弱论证题', status: 'active', created_at: 1000
    }),
    insert('prompt_versions', {
      id: 'prompt-question-v1', prompt_definition_id: 'prompt-question', version: '1.0.0', manifest_json: '{}',
      sections_json: '[]', compatible_schema_versions_json: '["question.single_choice.v1"]',
      content_hash: '0123456789abcdef', status: 'published', created_at: 1000
    }),
    insert('command_receipts', {
      idempotency_key: 'create-cycle:1', command_type: 'candidate.create_cycle', result_resource_type: 'exam_cycle',
      result_resource_id: cycleA, completed_at: 1000
    })
  ].join('\n');
}

/** The shared official source both cycles imported true questions from. */
export function sqliteQuestionSourceSql() {
  return insert('question_sources', {
    id: 'source-official', identity_hash: 'source-identity-0123456789abcdef', source_type: 'official',
    provider: '测试考试局', exam_type: 'civil_service', exam_year: 2025, province: '江苏', paper_name: '测试真题',
    provenance_json: '{}', import_method: 'structured_file', content_hash: 'source-content-0123456789abcdef',
    source_version: '1', status: 'active', created_at: 1000, updated_at: 1000
  });
}

export function sqliteCandidateSql() {
  return [
    insert('projects', { id: 'project-1', name: '测试考生', status: 'active', created_at: 1000, updated_at: 1000 }),
    insert('candidate_profiles', {
      id: 'profile-1', project_id: 'project-1', preferred_name: '小张', time_zone: 'Asia/Shanghai',
      current_state_json: '{}', extension_json: '{}', created_at: 1000, updated_at: 1000
    }),
    ...[[cycleA, 'active', 1000], [cycleB, 'completed', 900]].flatMap(([cycle, status, createdAt]) => [
      insert('exam_cycles', {
        id: cycle, project_id: 'project-1', exam_type: 'civil_service', exam_date: '2027-01-01',
        time_zone: 'Asia/Shanghai', phase: 'foundation', status, curriculum_version_id: 'curriculum-1',
        created_at: createdAt, updated_at: createdAt
      }),
      insert('study_constraints', {
        id: `${cycle}-constraints`, exam_cycle_id: cycle, study_mode: 'part_time', weekly_study_days: 5,
        weekday_minutes: 90, weekend_minutes: 180, max_focus_minutes: 45, updated_at: createdAt
      }),
      insert('learning_preferences', {
        id: `${cycle}-preferences`, exam_cycle_id: cycle, teaching_order: 'lecture_first',
        explanation_depth: 'balanced', proactive_level: 'balanced', companion_tone: 'warm', updated_at: createdAt
      }),
      insert('score_targets', {
        id: `${cycle}-target`, exam_cycle_id: cycle, subject: 'aptitude', target_score: 80, max_score: 100,
        source: 'candidate', status: 'active', effective_from: createdAt, created_at: createdAt
      })
    ])
  ].join('\n');
}

/**
 * One cycle's learning rows across all 47 tables clearLearningData reaches:
 * a practised, a retired and an official question set, corrected diagnoses
 * and superseded evidence, a tutor conclusion, calibration, plan-linked
 * progress, agent runs with a cascading child, outbox events and messages.
 */
export function sqliteLearningSql(cycle, p, sourceSequence) {
  const id = (name) => `${p}-${name}`;
  const key = (name) => `${p}:${name}`;
  const thread = id('thread');
  const blueprint = id('blueprint');
  const runRoot = id('run-root');
  const setPractised = id('set-practised');
  const setRetired = id('set-retired');
  const setOfficial = id('set-official');
  const questions = { q1: id('q1'), q2: id('q2'), q3: id('q3'), q4: id('q4') };
  const workflow = (name) => id(`workflow-${name}`);
  const run = (name, values) => ({
    id: id(name), run_type: 'content_generation', status: 'queued', exam_cycle_id: cycle, input_snapshot_json: '{}',
    checkpoint_json: '{}', attempt_count: 0, idempotency_key: key(name), created_at: 1200, updated_at: 1200,
    version: 1, work_pool: 'content_generation', execution_class: 'general', lease_epoch: 0, ...values
  });
  const spec = (name, values) => ({
    id: id(`spec-${name}`), exam_cycle_id: cycle, capability_node_id: 'capability-1', content_kind: 'question_set',
    assessment_role: 'practice', question_template_version_id: 'template-single-v1',
    content_schema_version_id: 'schema-question-v1', prompt_version_id: 'prompt-question-v1', requested_count: 1,
    difficulty_json: '{"min":0.3,"max":0.6}', constraints_json: '{"entryMode":"self"}', context_snapshot_json: '{}',
    content_hash: `0123456789abcdef-${p}-spec-${name}`, created_at: 1200, ...values
  });
  const questionSet = (values) => ({
    exam_cycle_id: cycle, capability_node_id: 'capability-1', purpose: 'practice', assessment_role: 'practice',
    module: '判断推理', status: 'ready', question_count: 1, content_version: 1, practice_status: 'not_started',
    origin_type: 'ai_generated', calibration_role: 'none', entry_mode: 'self', ...values
  });
  const question = (name, setId, sequence, generator, values = {}) => ({
    id: questions[name], question_set_id: setId, exam_cycle_id: cycle, capability_node_id: 'capability-1',
    question_template_version_id: 'template-single-v1', sequence, difficulty: 0.5, cognitive_level: 'application',
    purpose: 'practice', assessment_role: 'practice', content_json: questionContent(`${p}:${name}`),
    correct_answer_json: '{"optionId":"A"}', quality_status: 'published',
    content_hash: `0123456789abcdef-${p}-${name}`, content_schema_version_id: 'schema-question-v1',
    content_version: 1, generator_workflow_id: generator, created_at: 1250, ...values
  });
  const attempt = (name, questionId, result, score) => ({
    id: id(name), session_id: id('session-1'), question_id: questionId, exam_cycle_id: cycle,
    capability_node_id: 'capability-1', learning_thread_id: thread, assessment_role: 'practice',
    question_content_version: 1, answer_json: `{"optionId":"${result === 'correct' ? 'A' : 'B'}"}`, result, score,
    elapsed_ms: 50_000, confidence: 0.6, answer_change_count: 1, submitted_at: 1500, idempotency_key: key(name)
  });
  const evidence = (name, attemptId, values) => ({
    id: id(name), exam_cycle_id: cycle, capability_node_id: 'capability-1', attempt_id: attemptId,
    assessment_role: 'practice', evidence_type: 'correctness', weight: 0.6, quality: 1,
    source: 'deterministic_grader', validation_policy_version: 'aptitude-objective:v1', occurred_at: 1500,
    idempotency_key: key(name), ...values
  });

  return [
    insert('learning_threads', {
      id: thread, exam_cycle_id: cycle, primary_capability_node_id: 'capability-1', origin_type: 'diagnosis',
      goal: '掌握削弱论证的结构识别', gap_snapshot_json: '{}', stage: 'independent', status: 'active',
      exit_criteria_json: '{"minimumIndependentAttempts":3}', started_at: 1100, created_at: 1100, updated_at: 1150,
      version: 2
    }),
    insert('learning_thread_events', {
      id: id('thread-created'), learning_thread_id: thread, exam_cycle_id: cycle, event_type: 'created',
      to_stage: 'diagnose', reason_code: 'diagnosis.weakness_found', occurred_at: 1100, idempotency_key: key('thread-created')
    }),
    insert('learning_thread_events', {
      id: id('thread-advanced'), learning_thread_id: thread, exam_cycle_id: cycle, event_type: 'stage_advanced',
      from_stage: 'diagnose', to_stage: 'independent', reason_code: 'mastery.ready', occurred_at: 1150,
      idempotency_key: key('thread-advanced')
    }),
    insert('teaching_blueprints', {
      id: blueprint, exam_cycle_id: cycle, learning_thread_id: thread, capability_node_id: 'capability-1',
      objective: '识别论证链并比较削弱力度', prerequisite_snapshot_json: '{}', teaching_strategy: 'explain_then_independent',
      difficulty_path_json: '[0.3,0.5]', version: 1, status: 'active', created_by: 'system', created_at: 1100
    }),
    insert('tutor_agent_runs', run('run-root', {
      status: 'completed', learning_thread_id: thread, target_resource_type: 'question_set',
      target_resource_id: setPractised, attempt_count: 1, updated_at: 1300, completed_at: 1300, version: 2, lease_epoch: 1
    })),
    // A child run carries no cycle of its own; clearing its root still removes it by cascade.
    insert('tutor_agent_runs', run('run-child', {
      run_type: 'review', exam_cycle_id: null, work_pool: 'background', parent_agent_run_id: runRoot,
      root_agent_run_id: runRoot
    })),
    insert('tutor_agent_runs', run('run-running', {
      run_type: 'error_diagnosis', status: 'running', work_pool: 'assessment', attempt_count: 1,
      lease_owner: 'agent-worker:1', lease_expires_at: 99_999, lease_epoch: 3
    })),
    insert('tutor_agent_run_events', {
      id: id('run-event-created'), agent_run_id: runRoot, event_type: 'created', to_status: 'queued',
      reason_code: 'agent_run.created', occurred_at: 1200, idempotency_key: key('run-event-created')
    }),
    insert('tutor_agent_run_events', {
      id: id('run-event-completed'), agent_run_id: runRoot, event_type: 'completed', from_status: 'running',
      to_status: 'completed', reason_code: 'agent_run.completed', payload_json: '{"questionSetId":"x"}',
      occurred_at: 1300, idempotency_key: key('run-event-completed')
    }),
    insert('tutor_agent_invocations', {
      id: id('agent-invocation'), agent_run_id: runRoot, provider: 'anthropic', model: 'test-model',
      model_role: 'tutor', prompt_version_id: 'prompt-question-v1', request_hash: `0123456789abcdef-${p}-agent`,
      input_tokens: 10, output_tokens: 20, latency_ms: 300, finish_reason: 'end_turn', validation_status: 'valid',
      created_at: 1250
    }),
    insert('agent_tool_receipts', {
      agent_run_id: runRoot, tool_call_id: 'call-1', tool_name: 'commit_question_set', arguments_hash: 'arguments-hash',
      business_idempotency_key: key('tool-call-1'), status: 'succeeded', result_json: '{"ok":true}', retryable: 0,
      attempt_count: 1, lease_epoch: 1, created_at: 1260, updated_at: 1270, completed_at: 1270, version: 1
    }),
    insert('generation_specs', spec('practised', {
      content_kind: 'lecture_with_questions', requested_count: 2, constraints_json: '{"entryMode":"tutor"}',
      learning_thread_id: thread, teaching_blueprint_id: blueprint, generation_intent: 'targeted_training',
      source_agent_run_id: runRoot
    })),
    insert('generation_specs', spec('retired', { created_at: 1210 })),
    insert('generation_specs', spec('official', {
      constraints_json: '{"entryMode":"self","source":"真题导入"}', generation_intent: 'true_question_calibration',
      created_at: 1220
    })),
    ...['practised', 'retired', 'official'].map((name) => insert('generation_workflows', {
      id: workflow(name), exam_cycle_id: cycle, generation_spec_id: id(`spec-${name}`),
      workflow_type: name === 'practised' ? 'lecture_with_questions' : 'question_set', status: 'committed',
      current_step: 'complete', attempt_count: 1, validation_json: '{}', idempotency_key: key(`workflow-${name}`),
      started_at: 1200, completed_at: 1250, updated_at: 1250, version: 3
    })),
    insert('ai_invocations', {
      id: id('ai-invocation'), workflow_id: workflow('practised'), provider: 'anthropic', model: 'test-model',
      model_role: 'content_generation', prompt_version_id: 'prompt-question-v1',
      content_schema_version_id: 'schema-question-v1', request_hash: `0123456789abcdef-${p}-ai`,
      provider_request_id: 'request-1', input_tokens: 100, output_tokens: 200, latency_ms: 1000,
      finish_reason: 'end_turn', validation_status: 'valid', created_at: 1220
    }),
    insert('content_documents', {
      id: id('lecture-doc-v1'), exam_cycle_id: cycle, document_type: 'lecture', schema_version_id: 'schema-lecture-v1',
      title: '削弱论证讲义', content_json: JSON.stringify(textDocument(`${p}:lecture:v1`, '削弱论证先识别论点和论据。')),
      content_hash: `0123456789abcdef-${p}-doc-1`, status: 'retired', content_version: 1,
      generator_workflow_id: workflow('practised'), created_at: 1230
    }),
    insert('content_documents', {
      id: id('lecture-doc-v2'), exam_cycle_id: cycle, document_type: 'lecture', schema_version_id: 'schema-lecture-v1',
      title: '削弱论证讲义（修订）', content_json: JSON.stringify(textDocument(`${p}:lecture:v2`, '再比较削弱的力度。')),
      content_hash: `0123456789abcdef-${p}-doc-2`, status: 'published', content_version: 2,
      supersedes_document_id: id('lecture-doc-v1'), generator_workflow_id: workflow('practised'), created_at: 1240
    }),
    insert('lectures', {
      id: id('lecture'), exam_cycle_id: cycle, capability_node_id: 'capability-1', content_document_id: id('lecture-doc-v2'),
      objective: '识别论证链', status: 'ready', version: 1, created_at: 1240, learning_thread_id: thread,
      teaching_blueprint_id: blueprint
    }),
    insert('question_sets', questionSet({
      id: setPractised, generation_spec_id: id('spec-practised'), question_count: 2,
      content_hash: `0123456789abcdef-${p}-set-1`, created_at: 1250, learning_thread_id: thread,
      teaching_blueprint_id: blueprint, practice_status: 'completed', entry_mode: 'tutor'
    })),
    insert('question_sets', questionSet({
      id: setRetired, generation_spec_id: id('spec-retired'), status: 'retired', practice_status: 'in_progress',
      created_at: 1260
    })),
    insert('question_sets', questionSet({
      id: setOfficial, generation_spec_id: id('spec-official'), origin_type: 'official', source_id: 'source-official',
      calibration_role: 'anchor', created_at: 1270
    })),
    insert('lecture_question_sets', { lecture_id: id('lecture'), question_set_id: setPractised, relation_role: 'primary' }),
    insert('questions', question('q1', setPractised, 1, workflow('practised'))),
    insert('questions', question('q2', setPractised, 2, workflow('practised'))),
    insert('questions', question('q3', setRetired, 1, workflow('retired'))),
    insert('questions', question('q4', setOfficial, 1, workflow('official'), {
      origin_type: 'official', source_id: 'source-official', source_sequence: sourceSequence,
      calibration_role: 'anchor', is_official: 1
    })),
    insert('question_capabilities', {
      question_id: questions.q1, capability_node_id: 'capability-2', relation_role: 'secondary', weight: 0.5
    }),
    insert('question_lineage', {
      id: id('lineage'), question_id: questions.q2, parent_question_id: questions.q1, derivation_type: 'variant',
      generation_workflow_id: workflow('practised'), reference_snapshot_json: '{}', created_at: 1255
    }),
    insert('question_source_links', {
      id: id('source-link'), question_id: questions.q4, source_id: 'source-official', source_sequence: sourceSequence,
      relation_role: 'original', calibration_role: 'anchor', created_at: 1270
    }),
    insert('question_import_drafts', {
      id: id('import-draft'), exam_cycle_id: cycle, capability_node_id: 'capability-1',
      capability_code: 'aptitude.judgment.weakening', module: '判断推理', owner_session_id: 'chat-session-1',
      source_type: 'official', import_method: 'structured_file', source_metadata_json: '{}',
      raw_payload_hash: `0123456789abcdef-${p}-draft`, status: 'published', issues_json: '[]',
      idempotency_key: key('import-draft'), published_question_set_id: setOfficial, version: 2, created_at: 1265,
      updated_at: 1270
    }),
    insert('question_import_candidates', {
      id: id('import-candidate'), draft_id: id('import-draft'), sequence: 1, raw_json: '{}', content_json: '{}',
      content_hash: `0123456789abcdef-${p}-candidate`, difficulty: 0.5, status: 'published', issues_json: '[]',
      published_question_id: questions.q4, created_at: 1265, updated_at: 1270
    }),
    insert('question_import_publish_receipts', {
      id: id('publish-receipt'), draft_id: id('import-draft'), idempotency_key: key('publish-receipt'),
      payload_hash: `0123456789abcdef-${p}-publish`, question_set_id: setOfficial, source_id: 'source-official',
      published_question_count: 1, created_at: 1270
    }),
    insert('question_source_import_receipts', {
      id: id('source-receipt'), idempotency_key: key('source-receipt'), source_id: 'source-official',
      payload_hash: `0123456789abcdef-${p}-source`, imported_question_count: 1, created_at: 1270
    }),
    insert('question_reference_packs', {
      id: id('reference-pack'), exam_cycle_id: cycle, capability_node_id: 'capability-1', module: '判断推理',
      exam_scope_json: '{}', source_question_count: 1, source_set_count: 1, source_ids_json: '["source-official"]',
      question_type_distribution_json: '{}', difficulty_distribution_json: '{}', structural_distribution_json: '{}',
      distractor_patterns_json: '[]', representative_questions_json: '[]', policy_version: 'true-question-reference.v1',
      content_hash: `0123456789abcdef-${p}-pack`, created_at: 1280
    }),
    insert('mastery_tracks', {
      id: id('track'), exam_cycle_id: cycle, capability_node_id: 'capability-1', state: 'practicing', concept: 0.5,
      recognition: 0.5, method: 0.5, accuracy: 0.5, speed: 0.5, retention: 0.5, transfer: 0.5, stability: 0.4,
      confidence: 0.6, effective_sample: 2.5, last_evidence_at: 1500, last_state_change_at: 1500,
      algorithm_version: 'mastery.v1', version: 2, created_at: 1400, updated_at: 1500
    }),
    insert('mastery_snapshots', {
      id: id('mastery-snapshot'), mastery_track_id: id('track'), exam_cycle_id: cycle, snapshot_json: '{"state":"practicing"}',
      algorithm_version: 'mastery.v1', evidence_cutoff_at: 1500, created_at: 1500
    }),
    // Points at evidence the correction later superseded: a cycle through nullable foreign keys.
    insert('review_queue', {
      id: id('review'), exam_cycle_id: cycle, capability_node_id: 'capability-1', mastery_track_id: id('track'),
      review_type: 'retention', due_at: 5000, priority: 1, interval_days: 2, stability_before: 0.4,
      status: 'scheduled', reason: '巩固削弱论证', source_evidence_id: id('evidence-wrong'), updated_at: 1500
    }),
    insert('learning_sessions', {
      id: id('session-1'), exam_cycle_id: cycle, learning_thread_id: thread, question_set_id: setPractised,
      session_type: 'practice', assessment_role: 'practice', status: 'completed', started_at: 1400, completed_at: 1500,
      elapsed_ms: 100_000, question_count: 2, answered_count: 2, correct_count: 1, idempotency_key: key('session-1'),
      created_at: 1400, updated_at: 1500, review_queue_item_id: id('review')
    }),
    insert('learning_sessions', {
      id: id('session-2'), exam_cycle_id: cycle, question_set_id: setRetired, session_type: 'practice',
      assessment_role: 'practice', status: 'in_progress', started_at: 1600, question_count: 1,
      idempotency_key: key('session-2'), created_at: 1600, updated_at: 1600
    }),
    insert('question_exposures', {
      id: id('exposure'), exam_cycle_id: cycle, learning_thread_id: thread, session_id: id('session-1'),
      question_id: questions.q1, exposure_type: 'practice', occurred_at: 1400, idempotency_key: key('exposure')
    }),
    insert('attempts', attempt('attempt-wrong', questions.q1, 'incorrect', 0)),
    insert('attempts', attempt('attempt-right', questions.q2, 'correct', 1)),
    insert('decision_observations', {
      id: id('observation'), attempt_id: id('attempt-wrong'), observation_type: 'confidence_report',
      value_code: 'unsure', source: 'user', confidence: 0.6, occurred_at: 1500
    }),
    ...[['attempt-wrong', 'incorrect', 0], ['attempt-right', 'correct', 1]].map(([name, result, score]) => insert('grading_results', {
      id: id(`grading-${name}`), attempt_id: id(name), grading_method: 'deterministic',
      grader_version: 'objective-single-choice:v1', result, score, confidence: 1, confirmation_status: 'not_required',
      created_at: 1500, idempotency_key: key(`grading-${name}`)
    })),
    insert('error_diagnoses', {
      id: id('diagnosis'), grading_result_id: id('grading-attempt-wrong'), attempt_id: id('attempt-wrong'),
      exam_cycle_id: cycle, capability_node_id: 'capability-1', cause_code: 'reasoning_error', detail: '混淆了论据与结论',
      confidence: 0.4, confirmation_status: 'corrected', recommended_action_code: 'review_argument_structure',
      source: 'tutor_ai', created_at: 1510, idempotency_key: key('diagnosis'), dimensions_json: '["structure"]'
    }),
    insert('error_diagnosis_confirmations', {
      id: id('confirmation'), error_diagnosis_id: id('diagnosis'), attempt_id: id('attempt-wrong'), exam_cycle_id: cycle,
      action: 'correct', corrected_cause_code: 'trap_misjudgment', corrected_detail: '被无关选项吸引',
      actor_type: 'user', created_at: 1520, idempotency_key: key('confirmation')
    }),
    insert('error_diagnosis_current_projection', {
      error_diagnosis_id: id('diagnosis'), latest_confirmation_id: id('confirmation'), confirmation_status: 'corrected',
      effective_cause_code: 'trap_misjudgment', effective_detail: '被无关选项吸引', updated_at: 1520, version: 2
    }),
    insert('learning_evidence', evidence('evidence-wrong', id('attempt-wrong'), { value: 0 })),
    insert('learning_evidence', evidence('evidence-right', id('attempt-right'), { value: 1 })),
    insert('learning_evidence', evidence('evidence-confirmed', id('attempt-wrong'), {
      evidence_type: 'user_confirmation', value: 0.5, source: 'user_confirmation', occurred_at: 1530,
      metadata_json: '{"reason":"user_correction"}'
    })),
    insert('evidence_corrections', {
      id: id('correction'), exam_cycle_id: cycle, evidence_id: id('evidence-wrong'), action: 'supersede',
      reason_code: 'user_corrected_diagnosis', reason_detail: '用户更正错因', replacement_evidence_id: id('evidence-confirmed'),
      actor_type: 'user', created_at: 1530, idempotency_key: key('correction')
    }),
    insert('evidence_validity_projection', {
      evidence_id: id('evidence-wrong'), validity_status: 'superseded', latest_correction_id: id('correction'),
      updated_at: 1530, version: 2
    }),
    insert('evidence_validity_projection', { evidence_id: id('evidence-right'), validity_status: 'valid', updated_at: 1500, version: 1 }),
    insert('evidence_validity_projection', { evidence_id: id('evidence-confirmed'), validity_status: 'valid', updated_at: 1530, version: 1 }),
    insert('tutor_cycle_conclusions', {
      id: id('conclusion'), exam_cycle_id: cycle, learning_thread_id: thread, learning_session_id: id('session-1'),
      question_set_id: setPractised, capability_node_ids_json: '["capability-1"]', conclusion_type: 'objective_session',
      decision_scope: 'single_capability', observation_json: '{"accuracy":0.5}', diagnosis_json: '{}',
      proposal_json: '{}', execution_json: '{}', assessment_json: '{}', schedule_json: '{}',
      policy_version: 'tutor-cycle.v1', idempotency_key: key('conclusion'), created_at: 1540
    }),
    insert('ability_calibration_snapshots', {
      id: id('calibration'), exam_cycle_id: cycle, algorithm_version: 'calibration.v1', evidence_cutoff_at: 1540,
      input_fingerprint: key('calibration'), snapshot_json: '{"estimatedScore":62.5}', created_at: 1540
    }),
    insert('daily_plans', {
      id: id('plan-1'), exam_cycle_id: cycle, plan_date: '2026-09-01', version: 1, status: 'superseded',
      phase: 'foundation', available_minutes: 60, decision_summary: '先巩固削弱论证', decision_factors_json: '{}',
      created_by: 'system', created_at: 1300
    }),
    insert('daily_plans', {
      id: id('plan-2'), exam_cycle_id: cycle, plan_date: '2026-09-01', version: 2, status: 'active',
      phase: 'foundation', available_minutes: 60, decision_summary: '讲义后复习', decision_factors_json: '{}',
      created_by: 'tutor_ai', created_at: 1310, supersedes_plan_id: id('plan-1')
    }),
    insert('daily_plan_blocks', {
      id: id('plan-block'), daily_plan_id: id('plan-2'), capability_node_id: 'capability-1', subject: 'aptitude',
      module: '判断推理', teaching_goal_code: 'consolidate', sequence: 1, priority: 60, required: 1
    }),
    insert('daily_plan_items', {
      id: id('plan-item'), daily_plan_id: id('plan-2'), learning_thread_id: thread, capability_node_id: 'capability-1',
      item_type: 'lecture', sequence: 1, target_minutes: 20, exit_criteria_json: '{}', reason: '先读讲义',
      status: 'completed', actual_minutes: 18, review_queue_item_id: id('review'), finished_at: 1550,
      daily_plan_block_id: id('plan-block'), item_category: 'learn', priority: 60, required: 1, dependency_ids_json: '[]'
    }),
    insert('learning_progress', {
      id: id('progress'), exam_cycle_id: cycle, resource_type: 'lecture', resource_key: id('lecture'),
      capability_node_id: 'capability-1', daily_plan_item_id: id('plan-item'), status: 'completed', started_at: 1545,
      completed_at: 1550, updated_at: 1550
    }),
    insert('proactive_signals', {
      id: id('signal'), exam_cycle_id: cycle, signal_type: 'review_due', status: 'pending', priority: 50,
      title: '该复习了', content: '削弱论证需要复习', action_route: '/practice', dedup_key: key('signal'),
      available_at: 1600, expires_at: 9000, created_at: 1600
    }),
    insert('learning_assets', {
      id: id('asset-insight'), exam_cycle_id: cycle, kind: 'profile_insight', business_key: 'profile:latest',
      title: '能力洞察', status: 'ready', payload_json: '{"summary":"论证题需要加强"}', source_agent_run_id: runRoot,
      version: 1, created_at: 1600, updated_at: 1600
    }),
    insert('learning_assets', {
      id: id('asset-draft'), exam_cycle_id: cycle, kind: 'practice_session_draft', business_key: `question-set:${setRetired}`,
      title: '答题进度', status: 'draft', payload_json: '{"version":1,"answers":{}}', version: 1, created_at: 1610,
      updated_at: 1610
    }),
    insert('domain_outbox', {
      id: id('outbox-session'), aggregate_type: 'learning_session', aggregate_id: id('session-1'),
      event_type: 'learning_session.objective_submitted', payload_json: '{}', occurred_at: 1500, published_at: 1501,
      attempt_count: 1, idempotency_key: key('outbox-session')
    }),
    insert('domain_outbox', {
      id: id('outbox-set'), aggregate_type: 'question_set', aggregate_id: setPractised, event_type: 'question_set.committed',
      payload_json: '{}', occurred_at: 1250, idempotency_key: key('outbox-set')
    }),
    insert('system_messages', {
      id: id('message-plan'), business_line: 'planning', category: 'reminder', event_code: 'daily_plan.ready',
      severity: 'info', status: 'unread', title: '今日计划', content: '今日计划已生成', source_type: 'daily_plan',
      source_id: id('plan-2'), dedup_key: key('message-plan'), created_at: 1310
    }),
    insert('system_messages', {
      id: id('message-cycle'), business_line: 'system', category: 'system', event_code: 'exam_cycle.created',
      severity: 'success', status: 'read', title: '备考档案已建立', content: '开始学习吧', source_type: 'exam_cycle',
      source_id: cycle, dedup_key: key('message-cycle'), created_at: 1000, read_at: 1001
    })
  ].join('\n');
}

/** Rows outside every cycle's cleanup scope; a restore must leave them exactly as they were. */
export function sqliteUnscopedSql() {
  return insert('domain_outbox', {
    id: 'outbox-cycle-created', aggregate_type: 'exam_cycle', aggregate_id: cycleA, event_type: 'exam_cycle.created',
    payload_json: '{}', occurred_at: 1000, published_at: 1001, attempt_count: 1, idempotency_key: 'cycle-a:created'
  });
}

/**
 * IndexedDB records for one cycle in every store clearLearningData deletes
 * from, shaped only as far as cycle ownership and keys need.
 */
export function indexedDbLearningRecords(Store, cycle, p) {
  const id = (name) => `${p}-${name}`;
  const questionIds = [id('q1'), id('q2')];
  return {
    [Store.ContentQuestionSetBundles]: [{
      questionSetId: id('set'), examCycleId: cycle, createdAt: 1250,
      bundle: {
        questionSet: { id: id('set'), examCycleId: cycle, practiceStatus: 'completed', status: 'ready', sourceId: 'source-official' },
        questions: questionIds.map((questionId, index) => ({ id: questionId, sequence: index + 1, sourceId: 'source-official' }))
      }
    }],
    [Store.GenerationAggregates]: [{
      workflowId: id('workflow'), idempotencyKey: id('workflow'),
      aggregate: { spec: { id: id('spec'), examCycleId: cycle }, workflow: { id: id('workflow'), examCycleId: cycle } }
    }],
    [Store.LearningThreadAggregates]: [{ threadId: id('thread'), examCycleKey: cycle, thread: { id: id('thread') }, events: [{ id: id('event') }] }],
    [Store.LearningSessionFacts]: [{
      sessionId: id('session'), idempotencyKey: id('session'), examCycleKey: cycle,
      session: { id: id('session'), examCycleId: cycle, questionSetId: id('set') }, attempts: [{ id: id('attempt') }]
    }],
    [Store.ErrorDiagnoses]: [{ id: id('diagnosis'), examCycleId: cycle, sessionKey: id('session'), idempotencyKey: id('diagnosis') }],
    [Store.ErrorDiagnosisConfirmations]: [{ id: id('confirmation'), examCycleId: cycle, errorDiagnosisId: id('diagnosis'), action: 'correct' }],
    [Store.ErrorDiagnosisProjections]: [{ diagnosisId: id('diagnosis'), confirmationStatus: 'corrected' }],
    [Store.AgentRunAggregates]: [{
      runId: id('run'), idempotencyKey: id('run-key'), run: { id: id('run'), examCycleId: cycle, status: 'completed' },
      events: [{ id: id('run-event') }], invocations: []
    }],
    [Store.AgentRunIdempotency]: [{ idempotencyKey: id('run-key'), runId: id('run') }],
    [Store.AgentToolReceipts]: [{ agentRunId: id('run'), toolCallId: 'call-1', status: 'succeeded' }],
    [Store.MasteryTracks]: [{ id: id('track'), key: id('track'), examCycleId: cycle, state: 'practicing' }],
    [Store.MasterySnapshots]: [{ id: id('mastery-snapshot'), masteryTrackId: id('track'), examCycleId: cycle }],
    [Store.ReviewQueue]: [{ id: id('review'), examCycleId: cycle, status: 'scheduled' }],
    [Store.DailyPlanAggregates]: [{ plan: { id: id('plan'), examCycleId: cycle }, blocks: [], items: [{ id: id('plan-item') }] }],
    [Store.LearningEvidenceAggregates]: [{
      evidenceId: id('evidence'), idempotencyKey: id('evidence'), examCycleKey: cycle,
      evidence: { id: id('evidence') }, validity: { validityStatus: 'superseded' }, corrections: [{ id: id('correction') }]
    }],
    [Store.ProactiveSignals]: [{ id: id('signal'), examCycleId: cycle, status: 'pending' }],
    [Store.LearningProgress]: [{
      id: id('progress'), examCycleId: cycle, resourceType: 'lecture', resourceKey: id('lecture'),
      dailyPlanItemId: id('plan-item'), status: 'completed'
    }],
    [Store.LearningAssets]: [{ id: id('asset'), examCycleId: cycle, kind: 'profile_insight', status: 'ready' }],
    [Store.QuestionImportDrafts]: [{ id: id('draft'), examCycleId: cycle, status: 'published', idempotencyKey: id('draft') }],
    [Store.QuestionImportCandidates]: [{ id: id('candidate'), draftId: id('draft'), sequence: 1 }],
    [Store.QuestionImportPublishReceipts]: [{ id: id('publish'), draftId: id('draft'), sourceId: 'source-official', idempotencyKey: id('publish') }],
    [Store.QuestionSourceLinks]: [{ id: id('link'), questionId: questionIds[0], sourceId: 'source-official' }],
    [Store.QuestionLineages]: [{ id: id('lineage'), questionId: questionIds[1], parentQuestionId: questionIds[0] }],
    [Store.QuestionSourceImportReceipts]: [{ id: id('source-receipt'), sourceId: 'source-official', idempotencyKey: id('source-receipt') }],
    [Store.QuestionReferencePacks]: [{ id: id('pack'), examCycleId: cycle, capabilityNodeId: 'capability-1', contentHash: id('pack') }],
    [Store.TutorCycleConclusions]: [{ id: id('conclusion'), examCycleId: cycle, learningThreadId: id('thread'), idempotencyKey: id('conclusion') }],
    [Store.AbilityCalibrationSnapshots]: [{ id: id('calibration'), examCycleId: cycle, inputFingerprint: id('calibration') }],
    [Store.AIInvocations]: [{ id: id('ai-invocation'), workflowId: id('workflow') }],
    [Store.DomainOutbox]: [
      { id: id('outbox-session'), aggregateType: 'learning_session', aggregateId: id('session'), idempotencyKey: id('outbox-session') },
      { id: id('outbox-set'), aggregateType: 'question_set', aggregateId: id('set'), idempotencyKey: id('outbox-set') }
    ],
    [Store.SystemMessages]: [
      { id: id('message-plan'), sourceType: 'daily_plan', sourceId: id('plan'), dedupKey: id('message-plan') },
      { id: id('message-cycle'), sourceType: 'exam_cycle', sourceId: cycle, dedupKey: id('message-cycle') }
    ]
  };
}

export function questionContent(stem) {
  return JSON.stringify({
    templateCode: 'single_choice',
    schemaVersion: 'question.single_choice.v2',
    capabilityCode: 'aptitude.judgment.weakening',
    prompt: textDocument(`${stem}:prompt`, '以下哪项如果为真，最能削弱上述论证？'),
    options: ['A', 'B', 'C', 'D'].map((optionId) => ({
      id: optionId,
      content: textDocument(`${stem}:option:${optionId}`, `选项 ${optionId}`)
    })),
    correctOptionId: 'A',
    explanation: textDocument(`${stem}:explanation`, '选项 A 切断了论证的因果链条。')
  });
}

function textDocument(id, source) {
  return { schemaVersion: 'content.v1', blocks: [{ id, type: 'text', source }] };
}

function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT INTO ${table}(${columns.join(', ')}) VALUES (${columns.map((column) => literal(row[column])).join(', ')});`;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
