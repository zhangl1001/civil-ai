import type { SqlDatabase, SqlRow, SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  AssessmentPolicyVersionId,
  CapabilityNodeId,
  CurriculumVersionId,
  InstantMs,
  JsonObject,
  MetadataPackageId,
  SubjectCode
} from '@/kernel/public';
import type {
  AssessmentPolicyVersion,
  CapabilityEdge,
  CapabilityNode,
  CurriculumBundle,
  CurriculumRepository,
  CurriculumVersion,
  MetadataPackage
} from '../contracts/CurriculumRepository';
import type {
  AssessmentPolicyStatus,
  CapabilityNodeType,
  CapabilityRelationType,
  CurriculumStatus,
  MetadataPackageStatus
} from '../domain/MetadataCodes';

interface MetadataPackageRow extends SqlRow {
  id: string;
  package_type: string;
  exam_type: string;
  region_scope: string;
  applicable_year_from: number | null;
  applicable_year_to: number | null;
  version: string;
  status: MetadataPackageStatus;
  source: string;
  content_hash: string;
  schema_version: string;
  release_notes: string | null;
  published_at: number | null;
  installed_at: number;
}

interface CurriculumRow extends SqlRow {
  id: string;
  metadata_package_id: string;
  exam_type: string;
  region_scope: string;
  applicable_year_from: number | null;
  applicable_year_to: number | null;
  version: string;
  content_hash: string;
  status: CurriculumStatus;
  created_at: number;
}

interface CapabilityNodeRow extends SqlRow {
  id: string;
  curriculum_version_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  short_name: string | null;
  node_type: CapabilityNodeType;
  subject: string;
  module: string;
  sequence: number;
  score_weight: number;
  default_target_accuracy: number | null;
  default_target_seconds: number | null;
  mastery_policy_json: string;
  status: 'active' | 'retired';
}

interface CapabilityEdgeRow extends SqlRow {
  from_node_id: string;
  to_node_id: string;
  relation_type: CapabilityRelationType;
  weight: number;
}

interface PolicyRow extends SqlRow {
  id: string;
  metadata_package_id: string;
  subject: string;
  policy_type: string;
  version: string;
  config_json: string;
  content_hash: string;
  status: AssessmentPolicyStatus;
  created_at: number;
}

function parseJsonObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must contain a JSON object`);
  }
  return value as JsonObject;
}

export class SqliteCurriculumRepository implements CurriculumRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async installBundle(bundle: CurriculumBundle, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await this.insertMetadataPackage(transaction, bundle.metadataPackage);
    await this.insertCurriculum(transaction, bundle.curriculum);
    for (const node of bundle.capabilityNodes) await this.insertNode(transaction, node);
    for (const edge of bundle.capabilityEdges) await this.insertEdge(transaction, edge);
    for (const policy of bundle.assessmentPolicies) await this.insertPolicy(transaction, policy);
  }

  async synchronizeBundle(bundle: CurriculumBundle, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await transaction.run(
      `UPDATE metadata_packages
       SET version = ?, content_hash = ?, release_notes = ?, installed_at = ?
       WHERE id = ?`,
      [
        bundle.metadataPackage.version,
        bundle.metadataPackage.contentHash,
        bundle.metadataPackage.releaseNotes ?? null,
        bundle.metadataPackage.installedAt,
        bundle.metadataPackage.id
      ]
    );
    await transaction.run(
      `UPDATE curriculum_versions
       SET version = ?, content_hash = ?, status = ?
       WHERE id = ?`,
      [
        bundle.curriculum.version,
        bundle.curriculum.contentHash,
        bundle.curriculum.status,
        bundle.curriculum.id
      ]
    );
    for (const node of bundle.capabilityNodes) {
      await transaction.run(
        `INSERT INTO capability_nodes(
          id, curriculum_version_id, parent_id, code, name, short_name, node_type, subject, module, sequence,
          score_weight, default_target_accuracy, default_target_seconds, mastery_policy_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_id = excluded.parent_id,
          code = excluded.code,
          name = excluded.name,
          short_name = excluded.short_name,
          node_type = excluded.node_type,
          subject = excluded.subject,
          module = excluded.module,
          sequence = excluded.sequence,
          score_weight = excluded.score_weight,
          default_target_accuracy = excluded.default_target_accuracy,
          default_target_seconds = excluded.default_target_seconds,
          mastery_policy_json = excluded.mastery_policy_json,
          status = excluded.status`,
        [
          node.id,
          node.curriculumVersionId,
          node.parentId ?? null,
          node.code,
          node.name,
          node.shortName ?? null,
          node.nodeType,
          node.subject,
          node.module,
          node.sequence,
          node.scoreWeight,
          node.defaultTargetAccuracy ?? null,
          node.defaultTargetSeconds ?? null,
          JSON.stringify(node.masteryPolicy),
          node.status
        ]
      );
    }
    for (const edge of bundle.capabilityEdges) {
      await transaction.run(
        `INSERT INTO capability_edges(from_node_id, to_node_id, relation_type, weight)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(from_node_id, to_node_id, relation_type) DO UPDATE SET weight = excluded.weight`,
        [edge.fromNodeId, edge.toNodeId, edge.relationType, edge.weight]
      );
    }
    for (const policy of bundle.assessmentPolicies) {
      await transaction.run(
        `INSERT INTO assessment_policy_versions(
          id, metadata_package_id, subject, policy_type, version, config_json, content_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          config_json = excluded.config_json,
          content_hash = excluded.content_hash,
          status = excluded.status`,
        [
          policy.id,
          policy.metadataPackageId,
          policy.subject,
          policy.policyType,
          policy.version,
          JSON.stringify(policy.config),
          policy.contentHash,
          policy.status,
          policy.createdAt
        ]
      );
    }
  }

  async findBundle(curriculumVersionId: CurriculumVersionId): Promise<CurriculumBundle | undefined> {
    const curriculumRows = await this.database.query<CurriculumRow>(
      'SELECT * FROM curriculum_versions WHERE id = ? LIMIT 1',
      [curriculumVersionId]
    );
    const curriculumRow = curriculumRows[0];
    if (!curriculumRow) return undefined;
    const [packageRows, nodeRows, edgeRows, policyRows] = await Promise.all([
      this.database.query<MetadataPackageRow>('SELECT * FROM metadata_packages WHERE id = ? LIMIT 1', [curriculumRow.metadata_package_id]),
      this.database.query<CapabilityNodeRow>(
        'SELECT * FROM capability_nodes WHERE curriculum_version_id = ? ORDER BY sequence ASC',
        [curriculumVersionId]
      ),
      this.database.query<CapabilityEdgeRow>(
        `SELECT edge.* FROM capability_edges edge
         JOIN capability_nodes node ON node.id = edge.from_node_id
         WHERE node.curriculum_version_id = ?`,
        [curriculumVersionId]
      ),
      this.database.query<PolicyRow>('SELECT * FROM assessment_policy_versions WHERE metadata_package_id = ?', [curriculumRow.metadata_package_id])
    ]);
    const packageRow = packageRows[0];
    if (!packageRow) throw new Error(`Curriculum ${curriculumVersionId} has no metadata package`);
    return {
      metadataPackage: this.mapPackage(packageRow),
      curriculum: this.mapCurriculum(curriculumRow),
      capabilityNodes: nodeRows.map((row) => this.mapNode(row)),
      capabilityEdges: edgeRows.map((row) => this.mapEdge(row)),
      assessmentPolicies: policyRows.map((row) => this.mapPolicy(row))
    };
  }

  private insertMetadataPackage(transaction: SqlTransaction, value: MetadataPackage): Promise<unknown> {
    return transaction.run(
      `INSERT INTO metadata_packages(
        id, package_type, exam_type, region_scope, applicable_year_from, applicable_year_to,
        version, status, source, content_hash, schema_version, release_notes, published_at, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.packageType, value.examType, value.regionScope, value.applicableYearFrom ?? null,
        value.applicableYearTo ?? null, value.version, value.status, value.source, value.contentHash,
        value.schemaVersion, value.releaseNotes ?? null, value.publishedAt ?? null, value.installedAt]
    );
  }

  private insertCurriculum(transaction: SqlTransaction, value: CurriculumVersion): Promise<unknown> {
    return transaction.run(
      `INSERT INTO curriculum_versions(
        id, metadata_package_id, exam_type, region_scope, applicable_year_from, applicable_year_to,
        version, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.metadataPackageId, value.examType, value.regionScope, value.applicableYearFrom ?? null,
        value.applicableYearTo ?? null, value.version, value.contentHash, value.status, value.createdAt]
    );
  }

  private insertNode(transaction: SqlTransaction, value: CapabilityNode): Promise<unknown> {
    return transaction.run(
      `INSERT INTO capability_nodes(
        id, curriculum_version_id, parent_id, code, name, short_name, node_type, subject, module, sequence,
        score_weight, default_target_accuracy, default_target_seconds, mastery_policy_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.curriculumVersionId, value.parentId ?? null, value.code, value.name,
        value.shortName ?? null, value.nodeType,
        value.subject, value.module, value.sequence, value.scoreWeight, value.defaultTargetAccuracy ?? null,
        value.defaultTargetSeconds ?? null, JSON.stringify(value.masteryPolicy), value.status]
    );
  }

  private insertEdge(transaction: SqlTransaction, value: CapabilityEdge): Promise<unknown> {
    return transaction.run(
      'INSERT INTO capability_edges(from_node_id, to_node_id, relation_type, weight) VALUES (?, ?, ?, ?)',
      [value.fromNodeId, value.toNodeId, value.relationType, value.weight]
    );
  }

  private insertPolicy(transaction: SqlTransaction, value: AssessmentPolicyVersion): Promise<unknown> {
    return transaction.run(
      `INSERT INTO assessment_policy_versions(
        id, metadata_package_id, subject, policy_type, version, config_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.metadataPackageId, value.subject, value.policyType, value.version,
        JSON.stringify(value.config), value.contentHash, value.status, value.createdAt]
    );
  }

  private mapPackage(row: MetadataPackageRow): MetadataPackage {
    return {
      id: row.id as MetadataPackageId,
      packageType: row.package_type,
      examType: row.exam_type,
      regionScope: row.region_scope,
      applicableYearFrom: row.applicable_year_from ?? undefined,
      applicableYearTo: row.applicable_year_to ?? undefined,
      version: row.version,
      status: row.status,
      source: row.source,
      contentHash: row.content_hash,
      schemaVersion: row.schema_version,
      releaseNotes: row.release_notes ?? undefined,
      publishedAt: row.published_at as InstantMs | null ?? undefined,
      installedAt: row.installed_at as InstantMs
    };
  }

  private mapCurriculum(row: CurriculumRow): CurriculumVersion {
    return {
      id: row.id as CurriculumVersionId,
      metadataPackageId: row.metadata_package_id as MetadataPackageId,
      examType: row.exam_type,
      regionScope: row.region_scope,
      applicableYearFrom: row.applicable_year_from ?? undefined,
      applicableYearTo: row.applicable_year_to ?? undefined,
      version: row.version,
      contentHash: row.content_hash,
      status: row.status,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapNode(row: CapabilityNodeRow): CapabilityNode {
    return {
      id: row.id as CapabilityNodeId,
      curriculumVersionId: row.curriculum_version_id as CurriculumVersionId,
      parentId: row.parent_id as CapabilityNodeId | null ?? undefined,
      code: row.code,
      name: row.name,
      shortName: row.short_name ?? undefined,
      nodeType: row.node_type,
      subject: row.subject as SubjectCode,
      module: row.module,
      sequence: row.sequence,
      scoreWeight: row.score_weight,
      defaultTargetAccuracy: row.default_target_accuracy ?? undefined,
      defaultTargetSeconds: row.default_target_seconds ?? undefined,
      masteryPolicy: parseJsonObject(row.mastery_policy_json, 'capability_nodes.mastery_policy_json'),
      status: row.status
    };
  }

  private mapEdge(row: CapabilityEdgeRow): CapabilityEdge {
    return {
      fromNodeId: row.from_node_id as CapabilityNodeId,
      toNodeId: row.to_node_id as CapabilityNodeId,
      relationType: row.relation_type,
      weight: row.weight
    };
  }

  private mapPolicy(row: PolicyRow): AssessmentPolicyVersion {
    return {
      id: row.id as AssessmentPolicyVersionId,
      metadataPackageId: row.metadata_package_id as MetadataPackageId,
      subject: row.subject as SubjectCode,
      policyType: row.policy_type,
      version: row.version,
      config: parseJsonObject(row.config_json, 'assessment_policy_versions.config_json'),
      contentHash: row.content_hash,
      status: row.status,
      createdAt: row.created_at as InstantMs
    };
  }
}
