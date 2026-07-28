import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  QuestionReferencePackId,
  QuestionSourceId
} from '@/kernel/public';
import type {
  QuestionReferencePackRepository,
  TrueQuestionReferenceExample,
  TrueQuestionReferencePack
} from '../contracts/QuestionReferencePackRepository';

interface ReferencePackRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  capability_node_id: string;
  module: string;
  exam_scope_json: string;
  source_question_count: number;
  source_set_count: number;
  source_ids_json: string;
  question_type_distribution_json: string;
  difficulty_distribution_json: string;
  structural_distribution_json: string;
  distractor_patterns_json: string;
  representative_questions_json: string;
  comparison_questions_json: string;
  policy_version: string;
  content_hash: string;
  created_at: number;
}

export class SqliteQuestionReferencePackRepository implements QuestionReferencePackRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async find(referencePackId: QuestionReferencePackId): Promise<TrueQuestionReferencePack | undefined> {
    return this.findOne('id = ?', referencePackId);
  }

  async findByContentHash(contentHash: string): Promise<TrueQuestionReferencePack | undefined> {
    return this.findOne('content_hash = ?', contentHash);
  }

  async save(referencePack: TrueQuestionReferencePack, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      `INSERT INTO question_reference_packs(
        id,exam_cycle_id,capability_node_id,module,exam_scope_json,source_question_count,
        source_set_count,source_ids_json,question_type_distribution_json,
        difficulty_distribution_json,structural_distribution_json,distractor_patterns_json,
        representative_questions_json,comparison_questions_json,policy_version,content_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        referencePack.id,
        referencePack.examCycleId,
        referencePack.capabilityNodeId,
        referencePack.module,
        JSON.stringify(referencePack.examScope),
        referencePack.sourceQuestionCount,
        referencePack.sourceSetCount,
        JSON.stringify(referencePack.sourceIds),
        JSON.stringify(referencePack.questionTypeDistribution),
        JSON.stringify(referencePack.difficultyDistribution),
        JSON.stringify(referencePack.structuralDistribution),
        JSON.stringify(referencePack.distractorPatterns),
        JSON.stringify(referencePack.representativeQuestions),
        JSON.stringify(referencePack.comparisonQuestions ?? []),
        referencePack.policyVersion,
        referencePack.contentHash,
        referencePack.createdAt
      ]
    );
  }

  private async findOne(where: string, value: string): Promise<TrueQuestionReferencePack | undefined> {
    const rows = await this.database.query<ReferencePackRow>(
      `SELECT * FROM question_reference_packs WHERE ${where} LIMIT 1`,
      [value]
    );
    return rows[0] ? mapReferencePack(rows[0]) : undefined;
  }
}

function mapReferencePack(row: ReferencePackRow): TrueQuestionReferencePack {
  return {
    id: row.id as QuestionReferencePackId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    capabilityNodeId: row.capability_node_id as CapabilityNodeId,
    module: row.module,
    examScope: parseObject(row.exam_scope_json, 'question_reference_packs.exam_scope_json'),
    sourceQuestionCount: row.source_question_count,
    sourceSetCount: row.source_set_count,
    sourceIds: parseArray<string>(
      row.source_ids_json,
      'question_reference_packs.source_ids_json'
    ) as QuestionSourceId[],
    questionTypeDistribution: parseObject(
      row.question_type_distribution_json,
      'question_reference_packs.question_type_distribution_json'
    ),
    difficultyDistribution: parseObject(
      row.difficulty_distribution_json,
      'question_reference_packs.difficulty_distribution_json'
    ),
    structuralDistribution: parseObject(
      row.structural_distribution_json,
      'question_reference_packs.structural_distribution_json'
    ),
    distractorPatterns: parseArray<string>(
      row.distractor_patterns_json,
      'question_reference_packs.distractor_patterns_json'
    ),
    representativeQuestions: parseArray<TrueQuestionReferenceExample>(
      row.representative_questions_json,
      'question_reference_packs.representative_questions_json'
    ),
    comparisonQuestions: parseArray<NonNullable<TrueQuestionReferencePack['comparisonQuestions']>[number]>(
      row.comparison_questions_json,
      'question_reference_packs.comparison_questions_json'
    ),
    policyVersion: row.policy_version,
    contentHash: row.content_hash,
    createdAt: row.created_at as InstantMs
  };
}

function parseObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as JsonObject;
}

function parseArray<T>(serialized: string, field: string): T[] {
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value as T[];
}
