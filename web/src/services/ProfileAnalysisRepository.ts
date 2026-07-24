import { database, type DbKeyRange } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityDiagnosisRecord, ProfileInsight, ProfileInsightKind, ProfileStatsRange, ProfileStatsSnapshot } from '@/domain/profileAnalysis';

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function latest<T extends { generatedAt: number }>(items: T[]): T | undefined {
  return items.sort((a, b) => b.generatedAt - a.generatedAt)[0];
}

export class ProfileAnalysisRepository {
  async saveStatsSnapshot(input: Omit<ProfileStatsSnapshot, 'id' | 'generatedAt'> & { generatedAt?: number }): Promise<ProfileStatsSnapshot> {
    const record: ProfileStatsSnapshot = {
      ...input,
      id: id('profile_stats'),
      generatedAt: input.generatedAt || Date.now()
    };
    await database.put<ProfileStatsSnapshot>(STORES.profileStatsSnapshots, record);
    return record;
  }

  async latestStatsSnapshot(projectId: string, profileId?: string, range: ProfileStatsRange = 'all'): Promise<ProfileStatsSnapshot | undefined> {
    const rows = profileId
      ? await database.queryByIndex<ProfileStatsSnapshot>(STORES.profileStatsSnapshots, 'projectProfileRange', [projectId, profileId, range])
      : await database.queryByIndex<ProfileStatsSnapshot>(STORES.profileStatsSnapshots, 'projectId', projectId);
    return latest(rows.filter((row) => row.range === range));
  }

  async saveDiagnosis(input: Omit<AbilityDiagnosisRecord, 'id' | 'generatedAt'> & { generatedAt?: number }): Promise<AbilityDiagnosisRecord> {
    const record: AbilityDiagnosisRecord = {
      ...input,
      id: id('ability_diagnosis'),
      generatedAt: input.generatedAt || Date.now()
    };
    await database.put<AbilityDiagnosisRecord>(STORES.abilityDiagnoses, record);
    return record;
  }

  async latestDiagnosis(projectId: string, profileId?: string): Promise<AbilityDiagnosisRecord | undefined> {
    if (profileId) {
      const range: DbKeyRange = {
        lower: [projectId, profileId, 0],
        upper: [projectId, profileId, Number.MAX_SAFE_INTEGER]
      };
      return latest(await database.queryByIndex<AbilityDiagnosisRecord>(STORES.abilityDiagnoses, 'projectProfileGenerated', range));
    }
    return latest(await database.queryByIndex<AbilityDiagnosisRecord>(STORES.abilityDiagnoses, 'projectId', projectId));
  }

  async saveInsight(input: Omit<ProfileInsight, 'id' | 'generatedAt'> & { generatedAt?: number }): Promise<ProfileInsight> {
    const record: ProfileInsight = {
      ...input,
      id: id('profile_insight'),
      generatedAt: input.generatedAt || Date.now()
    };
    await database.put<ProfileInsight>(STORES.profileInsights, record);
    return record;
  }

  async latestInsight(projectId: string, kind: ProfileInsightKind, profileId?: string): Promise<ProfileInsight | undefined> {
    const rows = await database.queryByIndex<ProfileInsight>(STORES.profileInsights, 'projectKind', [projectId, kind]);
    return latest(rows.filter((row) => !profileId || row.profileId === profileId));
  }
}

export const profileAnalysisRepository = new ProfileAnalysisRepository();
