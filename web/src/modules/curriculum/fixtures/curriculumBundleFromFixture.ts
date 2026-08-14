import type {
  AssessmentPolicyVersionId,
  CapabilityNodeId,
  CurriculumVersionId,
  InstantMs,
  JsonObject,
  MetadataPackageId,
  SubjectCode
} from '@/kernel/public';
import type { CurriculumBundle } from '../contracts/CurriculumRepository';
import type {
  AssessmentPolicyStatus,
  CapabilityNodeType,
  CapabilityRelationType,
  CurriculumStatus,
  MetadataPackageStatus
} from '../domain/MetadataCodes';

/**
 * The JSON shape a bundled exam package ships as.
 *
 * Written out rather than inferred from one fixture so a second track's file is
 * checked against the same contract instead of against the first track's exact
 * optional fields.
 */
export interface CurriculumFixture {
  readonly manifest: {
    readonly id: string;
    readonly packageType: string;
    readonly examType: string;
    readonly regionScope: string;
    readonly version: string;
    readonly status: string;
    readonly source: string;
    readonly contentHash: string;
    readonly schemaVersion: string;
    readonly releaseNotes: string;
    readonly publishedAt: number;
    readonly installedAt: number;
  };
  readonly payload: {
    readonly curriculum: {
      readonly id: string;
      readonly examType: string;
      readonly regionScope: string;
      readonly version: string;
      readonly status: string;
      readonly createdAt: number;
    };
    readonly capabilityNodes: readonly {
      readonly id: string;
      readonly parentId?: string;
      readonly code: string;
      readonly name: string;
      readonly shortName?: string;
      readonly nodeType: string;
      readonly subject: string;
      readonly module: string;
      readonly sequence: number;
      readonly scoreWeight: number;
      readonly defaultTargetAccuracy?: number;
      readonly defaultTargetSeconds?: number;
      readonly masteryPolicy: unknown;
      readonly status: string;
    }[];
    readonly capabilityEdges: readonly {
      readonly fromNodeId: string;
      readonly toNodeId: string;
      readonly relationType: string;
      readonly weight: number;
    }[];
    readonly assessmentPolicies: readonly {
      readonly id: string;
      readonly subject: string;
      readonly policyType: string;
      readonly version: string;
      readonly config: unknown;
      readonly status: string;
      readonly createdAt: number;
    }[];
  };
}

function normalizeJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/**
 * Reads a bundled curriculum package into the shape the repository stores.
 *
 * Shared by every track: a package is data, so adding one is a fixture file plus
 * a registry entry, never another copy of this projection.
 */
export function curriculumBundleFromFixture(fixture: CurriculumFixture): CurriculumBundle {
  const { manifest, payload } = fixture;
  const metadataPackageId = manifest.id as MetadataPackageId;
  const curriculumVersionId = payload.curriculum.id as CurriculumVersionId;
  return {
    metadataPackage: {
      id: metadataPackageId,
      packageType: manifest.packageType,
      examType: manifest.examType,
      regionScope: manifest.regionScope,
      version: manifest.version,
      status: manifest.status as MetadataPackageStatus,
      source: manifest.source,
      contentHash: manifest.contentHash,
      schemaVersion: manifest.schemaVersion,
      releaseNotes: manifest.releaseNotes,
      publishedAt: manifest.publishedAt as InstantMs,
      installedAt: manifest.installedAt as InstantMs
    },
    curriculum: {
      id: curriculumVersionId,
      metadataPackageId,
      examType: payload.curriculum.examType,
      regionScope: payload.curriculum.regionScope,
      version: payload.curriculum.version,
      contentHash: manifest.contentHash,
      status: payload.curriculum.status as CurriculumStatus,
      createdAt: payload.curriculum.createdAt as InstantMs
    },
    capabilityNodes: payload.capabilityNodes.map((node) => ({
      id: node.id as CapabilityNodeId,
      curriculumVersionId,
      parentId: node.parentId as CapabilityNodeId | undefined,
      code: node.code,
      name: node.name,
      shortName: node.shortName,
      nodeType: node.nodeType as CapabilityNodeType,
      subject: node.subject as SubjectCode,
      module: node.module,
      sequence: node.sequence,
      scoreWeight: node.scoreWeight,
      defaultTargetAccuracy: node.defaultTargetAccuracy,
      defaultTargetSeconds: node.defaultTargetSeconds,
      masteryPolicy: normalizeJsonObject(node.masteryPolicy),
      status: node.status as 'active' | 'retired'
    })),
    capabilityEdges: payload.capabilityEdges.map((edge) => ({
      fromNodeId: edge.fromNodeId as CapabilityNodeId,
      toNodeId: edge.toNodeId as CapabilityNodeId,
      relationType: edge.relationType as CapabilityRelationType,
      weight: edge.weight
    })),
    assessmentPolicies: payload.assessmentPolicies.map((policy) => ({
      id: policy.id as AssessmentPolicyVersionId,
      metadataPackageId,
      subject: policy.subject as SubjectCode,
      policyType: policy.policyType,
      version: policy.version,
      config: normalizeJsonObject(policy.config),
      contentHash: manifest.contentHash,
      status: policy.status as AssessmentPolicyStatus,
      createdAt: policy.createdAt as InstantMs
    }))
  };
}
