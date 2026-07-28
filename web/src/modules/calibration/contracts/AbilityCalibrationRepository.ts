import type { TransactionContext } from '@/capabilities/database/public';
import type {
  AbilityCalibrationSnapshotId,
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  SubjectCode
} from '@/kernel/public';
import type { BaselineCoverageStatus, ScoreForecastBasis } from '../domain/CalibrationCodes';

export interface ModuleCoverageProjection {
  readonly module: string;
  readonly name: string;
  readonly anchorSample: number;
  readonly trueAnchorSample: number;
  readonly covered: boolean;
  readonly confidence: number;
}

export interface BaselineCoverageProjection {
  readonly status: BaselineCoverageStatus;
  readonly requiredModuleCount: number;
  readonly coveredModuleCount: number;
  readonly coverageRatio: number;
  readonly anchorSample: number;
  readonly trueAnchorSample: number;
  readonly confidence: number;
  readonly modules: readonly ModuleCoverageProjection[];
  readonly coveredModules: readonly string[];
  readonly uncoveredModules: readonly string[];
  readonly nextCapabilityNodeId?: CapabilityNodeId;
  readonly nextRecommendation: string;
}

export interface CapabilityCalibrationProjection {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly module: string;
  readonly trainingAccuracy?: number;
  readonly trueQuestionAccuracy?: number;
  readonly calibratedAccuracy?: number;
  readonly calibrationGap?: number;
  readonly trainingSample: number;
  readonly trueQuestionSample: number;
  readonly confidence: number;
}

export interface ModuleCalibrationProjection {
  readonly module: string;
  readonly name: string;
  readonly scoreWeight: number;
  readonly trainingAccuracy?: number;
  readonly trueQuestionAccuracy?: number;
  readonly calibratedAccuracy?: number;
  readonly calibrationGap?: number;
  readonly trainingSample: number;
  readonly trueQuestionSample: number;
  readonly speed: number;
  readonly retention: number;
  readonly transfer: number;
  readonly confidence: number;
}

export interface ScoreForecastProjection {
  readonly subject: SubjectCode;
  readonly low?: number;
  readonly center?: number;
  readonly high?: number;
  readonly maxScore: number;
  readonly targetScore?: number;
  readonly targetGapLow?: number;
  readonly targetGapHigh?: number;
  readonly confidence: number;
  readonly coverageRatio: number;
  readonly basis: ScoreForecastBasis;
  readonly explanation: string;
}

export interface AbilityChangeProjection {
  readonly module: string;
  readonly trainingAccuracyDelta?: number;
  readonly trueQuestionAccuracyDelta?: number;
  readonly calibratedAccuracyDelta?: number;
  readonly speedDelta?: number;
  readonly retentionDelta?: number;
  readonly transferDelta?: number;
  readonly targetScoreContribution?: number;
}

export interface AbilityCalibrationSnapshot {
  readonly id: AbilityCalibrationSnapshotId;
  readonly examCycleId: ExamCycleId;
  readonly algorithmVersion: string;
  readonly evidenceCutoffAt: InstantMs;
  readonly inputFingerprint: string;
  readonly baseline: BaselineCoverageProjection;
  readonly capabilities: readonly CapabilityCalibrationProjection[];
  readonly modules: readonly ModuleCalibrationProjection[];
  readonly scoreForecasts: readonly ScoreForecastProjection[];
  readonly changes: readonly AbilityChangeProjection[];
  readonly createdAt: InstantMs;
}

export interface AbilityCalibrationRepository {
  findLatest(examCycleId: ExamCycleId): Promise<AbilityCalibrationSnapshot | undefined>;
  findByFingerprint(inputFingerprint: string): Promise<AbilityCalibrationSnapshot | undefined>;
  append(snapshot: AbilityCalibrationSnapshot, context: TransactionContext): Promise<void>;
}
