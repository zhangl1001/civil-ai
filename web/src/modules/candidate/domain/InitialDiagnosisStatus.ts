export const InitialDiagnosisStatus = {
  NotStarted: 'not_started',
  InProgress: 'in_progress',
  DataInsufficient: 'data_insufficient',
  Sufficient: 'sufficient'
} as const;

export type InitialDiagnosisStatus = typeof InitialDiagnosisStatus[keyof typeof InitialDiagnosisStatus];

