import type { CapabilityNodeId, CurriculumVersionId, JsonObject, SubjectCode } from '@/kernel/public';
import type { AssessmentPolicyVersion, CapabilityNode, CurriculumRepository } from '../contracts/CurriculumRepository';
import {
  AssessmentPolicyStatus,
  AssessmentPolicyType,
  CapabilityNodeType,
  parseExamDeliveryKind,
  type ExamDeliveryKind
} from '../domain/MetadataCodes';

export interface ExamMockScheme {
  readonly code: string;
  readonly name: string;
  readonly questionCount: number;
  readonly durationMinutes: number;
}

/** Mock paper defaults for one subject. Absent when the subject has no mock exam. */
export interface ExamMockPaperSpec {
  readonly defaultQuestionCount: number;
  readonly defaultDurationMinutes: number;
  readonly schemes: readonly ExamMockScheme[];
  readonly focusTags: readonly string[];
}

export interface ExamSubjectModule {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly code: string;
  readonly name: string;
}

export interface ExamSubjectView {
  readonly code: SubjectCode;
  readonly name: string;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly deliveryKind: ExamDeliveryKind;
  readonly modules: readonly ExamSubjectModule[];
  readonly mockExam?: ExamMockPaperSpec;
}

const ACTIVE_NODE_STATUS = 'active';

/**
 * Projects the subject layer of a curriculum package: display name, module list
 * and how the subject is answered. Exam flows read this instead of hard-coding
 * subject names, so installing a different exam pack changes the offered
 * subjects without touching application code.
 */
export class GetExamSubjects {
  constructor(private readonly curriculumRepository: CurriculumRepository) {}

  async execute(curriculumVersionId: CurriculumVersionId): Promise<readonly ExamSubjectView[]> {
    const bundle = await this.curriculumRepository.findBundle(curriculumVersionId);
    if (!bundle) return [];

    const activeNodes = bundle.capabilityNodes.filter((node) => node.status === ACTIVE_NODE_STATUS);
    const deliveryPolicyBySubject = latestPublishedDeliveryPolicies(bundle.assessmentPolicies);

    return activeNodes
      .filter((node) => node.nodeType === CapabilityNodeType.Subject)
      .sort(bySequence)
      .flatMap((node) => {
        const policy = deliveryPolicyBySubject.get(node.subject);
        // A subject without a published, parseable exam_delivery policy cannot be
        // routed to an answering flow, so it is not offered rather than guessed.
        if (!policy) return [];
        const deliveryKind = parseExamDeliveryKind(readValue(policy.config, 'deliveryKind'));
        if (!deliveryKind) return [];
        const mockExam = readMockPaperSpec(readValue(policy.config, 'mockExam'));
        return [{
          code: node.subject,
          name: node.name,
          capabilityNodeId: node.id,
          deliveryKind,
          modules: modulesOf(activeNodes, node.subject),
          ...(mockExam ? { mockExam } : {})
        }];
      });
  }
}

function modulesOf(activeNodes: readonly CapabilityNode[], subject: SubjectCode): readonly ExamSubjectModule[] {
  return activeNodes
    .filter((node) => node.nodeType === CapabilityNodeType.Module && node.subject === subject)
    .sort(bySequence)
    .map((node) => ({ capabilityNodeId: node.id, code: node.module, name: node.name }));
}

function bySequence(left: CapabilityNode, right: CapabilityNode): number {
  return left.sequence - right.sequence;
}

function latestPublishedDeliveryPolicies(
  policies: readonly AssessmentPolicyVersion[]
): ReadonlyMap<SubjectCode, AssessmentPolicyVersion> {
  const latest = new Map<SubjectCode, AssessmentPolicyVersion>();
  for (const policy of policies) {
    if (policy.policyType !== AssessmentPolicyType.ExamDelivery) continue;
    if (policy.status !== AssessmentPolicyStatus.Published) continue;
    const current = latest.get(policy.subject);
    if (!current || compareVersions(policy.version, current.version) > 0) latest.set(policy.subject, policy);
  }
  return latest;
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function readMockPaperSpec(value: unknown): ExamMockPaperSpec | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const defaultQuestionCount = readPositiveInteger(record.defaultQuestionCount);
  const defaultDurationMinutes = readPositiveInteger(record.defaultDurationMinutes);
  if (defaultQuestionCount === undefined || defaultDurationMinutes === undefined) return undefined;
  return {
    defaultQuestionCount,
    defaultDurationMinutes,
    schemes: readArray(record.schemes).flatMap((item) => {
      const scheme = readMockScheme(item);
      return scheme ? [scheme] : [];
    }),
    focusTags: readArray(record.focusTags).filter((item): item is string => typeof item === 'string' && item.length > 0)
  };
}

function readMockScheme(value: unknown): ExamMockScheme | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const questionCount = readPositiveInteger(record.questionCount);
  const durationMinutes = readPositiveInteger(record.durationMinutes);
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  if (!code || !name || questionCount === undefined || durationMinutes === undefined) return undefined;
  return { code, name, questionCount, durationMinutes };
}

function readValue(config: JsonObject, key: string): unknown {
  return (config as Record<string, unknown>)[key];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
