import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import type { AgentRunAggregate } from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type {
  ErrorDiagnosisRepository,
  RunAiErrorDiagnosis
} from '@/modules/evidence/public';

export async function executeErrorDiagnosis(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  candidates: CandidateRepository,
  curriculums: CurriculumRepository,
  diagnoses: ErrorDiagnosisRepository,
  runner: RunAiErrorDiagnosis
): Promise<void> {
  if (!gateway) throw new Error('Error diagnosis requires provider gateway');
  const inputItems = objectArray(run.run.inputSnapshot.items);
  if (!inputItems.length) throw new Error('Error diagnosis run is missing diagnosis items');
  if (!run.run.examCycleId) throw new Error('Error diagnosis run is missing its exam cycle');
  const cycle = await candidates.findCycle(run.run.examCycleId);
  if (!cycle) throw new Error(`Exam cycle does not exist: ${run.run.examCycleId}`);
  const curriculum = await curriculums.findBundle(cycle.examCycle.curriculumVersionId);
  if (!curriculum) throw new Error(`Curriculum does not exist: ${cycle.examCycle.curriculumVersionId}`);
  const provisionalDiagnosisIds = inputItems.map((item) => (
    text(item.provisionalDiagnosisId, 'provisionalDiagnosisId') as Parameters<ErrorDiagnosisRepository['find']>[0]
  ));
  const provisionalDiagnoses = await diagnoses.findMany(provisionalDiagnosisIds);
  const diagnosisById = new Map(provisionalDiagnoses.map((diagnosis) => [diagnosis.id, diagnosis]));
  const items = inputItems.map((item, index) => {
    const provisionalDiagnosisId = provisionalDiagnosisIds[index]!;
    const diagnosis = diagnosisById.get(provisionalDiagnosisId);
    if (!diagnosis) throw new Error(`Provisional diagnosis does not exist: ${provisionalDiagnosisId}`);
    const capability = curriculum.capabilityNodes.find((node) => node.id === diagnosis.capabilityNodeId);
    return {
      provisionalDiagnosisId: provisionalDiagnosisId as Parameters<RunAiErrorDiagnosis['execute']>[0]['items'][number]['provisionalDiagnosisId'],
      evidenceContext: object(item.evidence),
      subject: capability?.subject ?? '行测',
      capabilityName: capability?.name
    };
  });
  await runner.execute({
    agentRunId: run.run.id,
    items
  }, gateway, signal);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Agent run input is missing ${field}`);
  return value.trim();
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function objectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}
