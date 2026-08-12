export const BaselineCoverageStatus = {
  NotStarted: 'not_started',
  InProgress: 'in_progress',
  Sufficient: 'sufficient'
} as const;
export type BaselineCoverageStatus = typeof BaselineCoverageStatus[keyof typeof BaselineCoverageStatus];

export const ScoreForecastBasis = {
  Missing: 'missing',
  SelfReport: 'self_report',
  Measured: 'measured',
  TrainingEvidence: 'training_evidence',
  TrueQuestionCalibrated: 'true_question_calibrated',
  Blended: 'blended'
} as const;
export type ScoreForecastBasis = typeof ScoreForecastBasis[keyof typeof ScoreForecastBasis];

export const ABILITY_CALIBRATION_ALGORITHM_VERSION = 'ability-calibration:v2';
