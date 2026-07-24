export type ProfileStatsRange = 'all' | '7d' | '30d';

export interface ProfileStatsSnapshot {
  id: string;
  projectId: string;
  profileId?: string;
  range: ProfileStatsRange;
  algorithmVersion: string;
  generatedAt: number;
  stats: unknown;
}

export interface AbilityDiagnosisRecord {
  id: string;
  projectId: string;
  profileId?: string;
  statsSnapshotId?: string;
  algorithmVersion: string;
  generatedAt: number;
  diagnosis: unknown;
}

export type ProfileInsightKind = 'summary' | 'plan' | 'encouragement' | 'risk' | 'strategy';

export interface ProfileInsight {
  id: string;
  projectId: string;
  profileId?: string;
  diagnosisId?: string;
  kind: ProfileInsightKind;
  content: string;
  structuredAdvice?: unknown;
  generatedAt: number;
  expiresAt?: number;
}
