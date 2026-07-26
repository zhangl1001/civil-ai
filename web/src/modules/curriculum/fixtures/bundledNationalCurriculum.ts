import type {
  AssessmentPolicyVersionId,
  CapabilityNodeId,
  CurriculumVersionId,
  InstantMs,
  JsonObject,
  MetadataPackageId,
  SubjectCode
} from '@/kernel/public';
import fixture from './civil-service-national-v2.json';
import type { CurriculumBundle } from '../contracts/CurriculumRepository';
import type {
  AssessmentPolicyStatus,
  CapabilityNodeType,
  CapabilityRelationType,
  CurriculumStatus,
  MetadataPackageStatus
} from '../domain/MetadataCodes';

function normalizeJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function createBundledNationalCurriculum(): CurriculumBundle {
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
      nodeType: node.nodeType as CapabilityNodeType,
      subject: node.subject as SubjectCode,
      module: node.module,
      sequence: node.sequence,
      scoreWeight: node.scoreWeight,
      defaultTargetAccuracy: node.defaultTargetAccuracy,
      defaultTargetSeconds: node.defaultTargetSeconds,
      masteryPolicy: node.masteryPolicy as JsonObject,
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
