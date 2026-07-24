import type { ExamCycleId, SubjectCode } from '@/kernel/public';
import type { CandidateRepository, ScoreMeasurement } from '../contracts/CandidateRepository';
import { InitialDiagnosisStatus, type InitialDiagnosisStatus as InitialDiagnosisStatusCode } from '../domain/InitialDiagnosisStatus';
import { ScoreMeasurementType } from '../domain/ScoreMeasurementType';

export interface CandidateHomeScore {
  readonly subject: SubjectCode;
  readonly currentScore?: number;
  readonly targetScore: number;
  readonly maxScore: number;
  readonly gap?: number;
  readonly confidence: number;
  readonly evidenceLabel: 'self_report' | 'measured' | 'missing';
}

export interface CandidateHomeSnapshot {
  readonly examCycleId: ExamCycleId;
  readonly projectName: string;
  readonly examName: string;
  readonly examDate: string;
  readonly phase: string;
  readonly diagnosisStatus: InitialDiagnosisStatusCode;
  readonly scores: readonly CandidateHomeScore[];
}

export class GetCandidateHome {
  constructor(private readonly candidateRepository: CandidateRepository) {}

  async execute(): Promise<CandidateHomeSnapshot | undefined> {
    const cycle = await this.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;

    const scores = cycle.scoreTargets
      .filter((target) => target.status === 'active')
      .map((target): CandidateHomeScore => {
        const measurement = latestMeasurement(cycle.scoreMeasurements, target.subject);
        return {
          subject: target.subject,
          currentScore: measurement?.score,
          targetScore: target.targetScore,
          maxScore: target.maxScore,
          gap: measurement ? roundScore(target.targetScore - measurement.score) : undefined,
          confidence: measurement?.confidence ?? 0,
          evidenceLabel: measurement
            ? measurement.measurementType === ScoreMeasurementType.SelfReport ? 'self_report' : 'measured'
            : 'missing'
        };
      });

    return {
      examCycleId: cycle.examCycle.id,
      projectName: cycle.project.name,
      examName: cycle.examCycle.examName || cycle.examCycle.examType,
      examDate: cycle.examCycle.examDate,
      phase: cycle.examCycle.phase,
      diagnosisStatus: resolveDiagnosisStatus(scores),
      scores
    };
  }
}

function latestMeasurement(
  measurements: readonly ScoreMeasurement[],
  subject: SubjectCode
): ScoreMeasurement | undefined {
  return measurements
    .filter((measurement) => measurement.subject === subject)
    .reduce<ScoreMeasurement | undefined>((latest, measurement) => (
      !latest || measurement.measuredAt > latest.measuredAt ? measurement : latest
    ), undefined);
}

function resolveDiagnosisStatus(scores: readonly CandidateHomeScore[]): InitialDiagnosisStatusCode {
  if (!scores.length || scores.every((score) => score.evidenceLabel === 'missing')) {
    return InitialDiagnosisStatus.NotStarted;
  }
  if (scores.every((score) => score.evidenceLabel === 'measured' && score.confidence >= 0.6)) {
    return InitialDiagnosisStatus.Sufficient;
  }
  return InitialDiagnosisStatus.DataInsufficient;
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
