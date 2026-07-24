import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { ExamProfile, ExamProfileBaseline, ExamProfilePreferences, ExamProfileTimeBudget, ExamScoreSet } from '@/domain/project';

export interface SaveExamProfileInput {
  id?: string;
  examType?: string;
  examName?: string;
  province?: string;
  examDate?: string;
  position?: string;
  requirements?: string;
  currentScores?: ExamScoreSet;
  targetScores?: ExamScoreSet;
  timeBudget?: ExamProfileTimeBudget;
  baseline?: ExamProfileBaseline;
  preferences?: ExamProfilePreferences;
}

function profileId(projectId: string): string {
  return `${projectId}:profile:default`;
}

function cleanScoreSet(value?: ExamScoreSet): ExamScoreSet {
  return {
    xingce: normalizeScore(value?.xingce),
    shenlun: normalizeScore(value?.shenlun),
    interview: normalizeScore(value?.interview)
  };
}

function normalizeScore(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(0, Math.min(150, Math.round(number * 10) / 10));
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export class ExamProfileRepository {
  async listByProject(projectId: string): Promise<ExamProfile[]> {
    const profiles = await database.queryByIndex<ExamProfile>(STORES.examProfiles, 'projectId', projectId);
    return profiles.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getActiveProfile(projectId: string): Promise<ExamProfile | undefined> {
    const active = await database.queryByIndex<ExamProfile>(STORES.examProfiles, 'projectStatus', [projectId, 'active']);
    return active.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async getDraftProfile(projectId: string): Promise<ExamProfile | undefined> {
    const drafts = await database.queryByIndex<ExamProfile>(STORES.examProfiles, 'projectStatus', [projectId, 'draft']);
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async hasActiveProfile(projectId: string): Promise<boolean> {
    return Boolean(await this.getActiveProfile(projectId));
  }

  async saveDraft(projectId: string, input: SaveExamProfileInput): Promise<ExamProfile> {
    return this.save(projectId, 'draft', input);
  }

  async activateProfile(projectId: string, input: SaveExamProfileInput): Promise<ExamProfile> {
    const now = Date.now();
    const next = await this.buildProfile(projectId, 'active', input, now);
    const existingActive = await this.getActiveProfile(projectId);
    const operations = [];
    if (existingActive && existingActive.id !== next.id) {
      operations.push({
        type: 'put' as const,
        storeName: STORES.examProfiles,
        value: { ...existingActive, status: 'archived' as const, updatedAt: now }
      });
    }
    operations.push({ type: 'put' as const, storeName: STORES.examProfiles, value: next });
    await database.transaction(operations);
    return next;
  }

  private async save(projectId: string, status: ExamProfile['status'], input: SaveExamProfileInput): Promise<ExamProfile> {
    const now = Date.now();
    const next = await this.buildProfile(projectId, status, input, now);
    await database.put<ExamProfile>(STORES.examProfiles, next);
    return next;
  }

  private async buildProfile(projectId: string, status: ExamProfile['status'], input: SaveExamProfileInput, now: number): Promise<ExamProfile> {
    const id = input.id || profileId(projectId);
    const existing = await database.get<ExamProfile>(STORES.examProfiles, id);
    return {
      id,
      projectId,
      version: 1,
      status,
      examType: cleanString(input.examType) ?? existing?.examType,
      examName: cleanString(input.examName) ?? existing?.examName,
      province: cleanString(input.province) ?? existing?.province,
      examDate: cleanString(input.examDate) ?? existing?.examDate,
      position: cleanString(input.position) ?? existing?.position,
      requirements: cleanString(input.requirements) ?? existing?.requirements,
      currentScores: {
        ...(existing?.currentScores || {}),
        ...cleanScoreSet(input.currentScores)
      },
      targetScores: {
        ...(existing?.targetScores || {}),
        ...cleanScoreSet(input.targetScores)
      },
      timeBudget: {
        ...(existing?.timeBudget || {}),
        ...(input.timeBudget || {})
      },
      baseline: {
        ...(existing?.baseline || {}),
        ...(input.baseline || {})
      },
      preferences: {
        ...(existing?.preferences || {}),
        ...(input.preferences || {})
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
  }
}

export const examProfileRepository = new ExamProfileRepository();
