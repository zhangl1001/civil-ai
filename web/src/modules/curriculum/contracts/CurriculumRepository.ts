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
  AssessmentPolicyStatus,
  CapabilityNodeType,
  CapabilityRelationType,
  CurriculumStatus,
  MetadataPackageStatus
} from '../domain/MetadataCodes';

export interface MetadataPackage {
  readonly id: MetadataPackageId;
  readonly packageType: string;
  readonly examType: string;
  readonly regionScope: string;
  readonly applicableYearFrom?: number;
  readonly applicableYearTo?: number;
  readonly version: string;
  readonly status: MetadataPackageStatus;
  readonly source: string;
  readonly contentHash: string;
  readonly schemaVersion: string;
  readonly releaseNotes?: string;
  readonly publishedAt?: InstantMs;
  readonly installedAt: InstantMs;
}

export interface CurriculumVersion {
  readonly id: CurriculumVersionId;
  readonly metadataPackageId: MetadataPackageId;
  readonly examType: string;
  readonly regionScope: string;
  readonly applicableYearFrom?: number;
  readonly applicableYearTo?: number;
  readonly version: string;
  readonly contentHash: string;
  readonly status: CurriculumStatus;
  readonly createdAt: InstantMs;
}

export interface CapabilityNode {
  readonly id: CapabilityNodeId;
  readonly curriculumVersionId: CurriculumVersionId;
  readonly parentId?: CapabilityNodeId;
  readonly code: string;
  readonly name: string;
  readonly nodeType: CapabilityNodeType;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly sequence: number;
  readonly scoreWeight: number;
  readonly defaultTargetAccuracy?: number;
  readonly defaultTargetSeconds?: number;
  readonly masteryPolicy: JsonObject;
  readonly status: 'active' | 'retired';
}

export interface CapabilityEdge {
  readonly fromNodeId: CapabilityNodeId;
  readonly toNodeId: CapabilityNodeId;
  readonly relationType: CapabilityRelationType;
  readonly weight: number;
}

export interface AssessmentPolicyVersion {
  readonly id: AssessmentPolicyVersionId;
  readonly metadataPackageId: MetadataPackageId;
  readonly subject: SubjectCode;
  readonly policyType: string;
  readonly version: string;
  readonly config: JsonObject;
  readonly contentHash: string;
  readonly status: AssessmentPolicyStatus;
  readonly createdAt: InstantMs;
}

export interface CurriculumBundle {
  readonly metadataPackage: MetadataPackage;
  readonly curriculum: CurriculumVersion;
  readonly capabilityNodes: readonly CapabilityNode[];
  readonly capabilityEdges: readonly CapabilityEdge[];
  readonly assessmentPolicies: readonly AssessmentPolicyVersion[];
}

export interface CurriculumRepository {
  installBundle(bundle: CurriculumBundle, context: TransactionContext): Promise<void>;
  findBundle(curriculumVersionId: CurriculumVersionId): Promise<CurriculumBundle | undefined>;
}
