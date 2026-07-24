export const ScoreMeasurementType = {
  SelfReport: 'self_report',
  OfficialExam: 'official_exam',
  FullMock: 'full_mock',
  ModuleMock: 'module_mock',
  InitialDiagnosis: 'initial_diagnosis'
} as const;

export type ScoreMeasurementType = typeof ScoreMeasurementType[keyof typeof ScoreMeasurementType];

const values: ReadonlySet<string> = new Set(Object.values(ScoreMeasurementType));

export function isScoreMeasurementType(value: unknown): value is ScoreMeasurementType {
  return typeof value === 'string' && values.has(value);
}
