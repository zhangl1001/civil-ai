import type { ExamProfile } from '@/domain/project';
import { abilityStatsService, type AbilityStats, type ModuleStats } from './AbilityStatsService';
import { examProfileRepository } from './ExamProfileRepository';
import { profileAnalysisRepository } from './ProfileAnalysisRepository';
import { projectRepository } from './ProjectRepository';

export type DiagnosisType =
  | 'insufficient_sample'
  | 'weak_accuracy'
  | 'slow_speed'
  | 'accuracy_and_speed_weak'
  | 'unstable'
  | 'review_not_closed'
  | 'stable';

export interface ModuleDiagnosis {
  module: string;
  questionCount: number;
  accuracy: number;
  avgSeconds: number;
  targetAccuracy: number;
  targetSeconds: number;
  accuracyGap: number;
  speedGap: number;
  repeatWrongRate: number;
  priority: number;
  confidence: number;
  diagnosisType: DiagnosisType;
  reasonCodes: string[];
}

export interface AbilityDiagnosis {
  projectId: string;
  profileId?: string;
  algorithmVersion: string;
  generatedAt: number;
  overall: {
    xingceGap?: number;
    shenlunGap?: number;
    remainingDays?: number;
    phase: 'onboarding' | 'diagnosis' | 'foundation' | 'improvement' | 'sprint';
    confidence: number;
  };
  modules: ModuleDiagnosis[];
  recommendation: {
    focusModules: string[];
    dailyQuestionTarget: number;
    reviewRatio: number;
    mockFrequencyDays: number;
    essayFrequencyDays: number;
  };
}

const MODULE_TARGET_SECONDS: Record<string, number> = {
  资料分析: 75,
  判断推理: 70,
  言语理解: 55,
  数量关系: 95,
  常识判断: 35,
  行测: 60,
  专项练习: 70
};

function daysUntil(date?: string): number | undefined {
  if (!date) return undefined;
  const end = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(end)) return undefined;
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000));
}

function phaseFrom(days?: number, stats?: AbilityStats): AbilityDiagnosis['overall']['phase'] {
  if (days === undefined) return stats?.totals.questionCount ? 'diagnosis' : 'onboarding';
  if (days <= 30) return 'sprint';
  if (days <= 90) return 'improvement';
  return stats?.totals.questionCount && stats.totals.questionCount >= 80 ? 'improvement' : 'foundation';
}

function confidence(questionCount: number): number {
  return Math.round(Math.min(1, questionCount / 80) * 100) / 100;
}

function targetAccuracy(profile: ExamProfile | undefined, module: string): number {
  const target = profile?.targetScores.xingce;
  if (!target) return module === '数量关系' ? 55 : 70;
  if (target >= 80) return module === '数量关系' ? 65 : 78;
  if (target >= 70) return module === '数量关系' ? 58 : 70;
  return module === '数量关系' ? 50 : 64;
}

function diagnoseModule(item: ModuleStats, profile?: ExamProfile): ModuleDiagnosis {
  const targetAcc = targetAccuracy(profile, item.module);
  const targetSeconds = MODULE_TARGET_SECONDS[item.module] || MODULE_TARGET_SECONDS.专项练习;
  const accuracyGap = Math.max(0, targetAcc - item.accuracy);
  const speedGap = item.avgSeconds ? Math.max(0, item.avgSeconds - targetSeconds) : 0;
  const reasonCodes: string[] = [];
  const conf = confidence(item.questionCount);

  if (item.questionCount < 20) reasonCodes.push('sample_insufficient');
  if (accuracyGap >= 12) reasonCodes.push('accuracy_below_target');
  if (speedGap >= 12) reasonCodes.push('speed_slower_than_target');
  if (item.repeatWrongRate >= 30) reasonCodes.push('repeat_wrong_high');
  if (item.recentQuestionCount >= 10 && item.recentAccuracy + 8 < item.accuracy) reasonCodes.push('recent_decline');

  let diagnosisType: DiagnosisType = 'stable';
  if (item.questionCount < 20) diagnosisType = 'insufficient_sample';
  else if (accuracyGap >= 12 && speedGap >= 12) diagnosisType = 'accuracy_and_speed_weak';
  else if (accuracyGap >= 12) diagnosisType = 'weak_accuracy';
  else if (speedGap >= 12) diagnosisType = 'slow_speed';
  else if (item.repeatWrongRate >= 30) diagnosisType = 'review_not_closed';
  else if (reasonCodes.includes('recent_decline')) diagnosisType = 'unstable';

  const priority = Math.round(
    accuracyGap * 1.8 +
    Math.min(30, speedGap) * 0.8 +
    item.repeatWrongRate * 0.45 +
    (1 - conf) * 12 +
    Math.min(20, item.wrongCount)
  );

  return {
    module: item.module,
    questionCount: item.questionCount,
    accuracy: item.accuracy,
    avgSeconds: item.avgSeconds,
    targetAccuracy: targetAcc,
    targetSeconds,
    accuracyGap,
    speedGap,
    repeatWrongRate: item.repeatWrongRate,
    priority,
    confidence: conf,
    diagnosisType,
    reasonCodes
  };
}

function recommendedDailyQuestions(profile: ExamProfile | undefined): number {
  const dailyMinutes = profile?.timeBudget.dailyStudyMinutes || 90;
  const weekday = profile?.timeBudget.weekdayMinutes || dailyMinutes;
  const weekend = profile?.timeBudget.weekendMinutes || dailyMinutes;
  const weeklyDays = Math.max(1, Math.min(7, profile?.timeBudget.weeklyStudyDays || 5));
  const weeklyMinutes = weekday * Math.min(5, weeklyDays) + weekend * Math.max(0, weeklyDays - 5);
  const averageDailyMinutes = Math.max(dailyMinutes, Math.round(weeklyMinutes / weeklyDays));
  const intensityFactor = profile?.preferences.intensity === 'high' ? 1.15 : profile?.preferences.intensity === 'light' ? 0.78 : 1;
  const fullTimeBoost = profile?.timeBudget.isFullTime ? 1.12 : 1;
  return Math.max(10, Math.min(100, Math.round((averageDailyMinutes / 4) * intensityFactor * fullTimeBoost)));
}

function reviewRatio(stats: AbilityStats, modules: ModuleDiagnosis[], profile?: ExamProfile): number {
  const base = stats.totals.reviewDueCount > 20 || modules.some((item) => item.repeatWrongRate >= 30) ? 0.4 : 0.25;
  if (profile?.preferences.reviewPreference === 'daily') return Math.max(base, 0.38);
  if (profile?.preferences.reviewPreference === 'exam_first') return Math.min(0.32, base);
  return base;
}

export class AbilityDiagnosisService {
  async current(): Promise<AbilityDiagnosis> {
    const project = await projectRepository.getActiveProject();
    const [stats, profile] = await Promise.all([
      abilityStatsService.forProject(project.id),
      examProfileRepository.getActiveProfile(project.id)
    ]);
    return this.fromStats(stats, profile);
  }

  async latestOrCurrent(): Promise<AbilityDiagnosis> {
    const project = await projectRepository.getActiveProject();
    const profile = await examProfileRepository.getActiveProfile(project.id);
    const latest = await profileAnalysisRepository.latestDiagnosis(project.id, profile?.id);
    if (latest?.diagnosis) return latest.diagnosis as AbilityDiagnosis;
    return this.current();
  }

  async refreshProject(projectId: string): Promise<AbilityDiagnosis> {
    const [stats, profile] = await Promise.all([
      abilityStatsService.refreshProject(projectId),
      examProfileRepository.getActiveProfile(projectId)
    ]);
    const diagnosis = this.fromStats(stats, profile);
    const snapshot = await profileAnalysisRepository.latestStatsSnapshot(projectId, stats.profileId, 'all');
    await profileAnalysisRepository.saveDiagnosis({
      projectId,
      profileId: diagnosis.profileId,
      statsSnapshotId: snapshot?.id,
      algorithmVersion: diagnosis.algorithmVersion,
      generatedAt: diagnosis.generatedAt,
      diagnosis
    });
    return diagnosis;
  }

  fromStats(stats: AbilityStats, profile?: ExamProfile): AbilityDiagnosis {
    const remainingDays = daysUntil(profile?.examDate);
    const modules = stats.modules.map((item) => diagnoseModule(item, profile)).sort((a, b) => b.priority - a.priority);
    const focusModules = modules
      .filter((item) => item.diagnosisType !== 'stable')
      .slice(0, 3)
      .map((item) => item.module);
    const xingceGap = profile?.targetScores.xingce !== undefined && profile.currentScores.xingce !== undefined
      ? Math.round((profile.targetScores.xingce - profile.currentScores.xingce) * 10) / 10
      : undefined;
    const shenlunGap = profile?.targetScores.shenlun !== undefined && profile.currentScores.shenlun !== undefined
      ? Math.round((profile.targetScores.shenlun - profile.currentScores.shenlun) * 10) / 10
      : undefined;
    const weeklyDays = profile?.timeBudget.weeklyStudyDays || 5;
    return {
      projectId: stats.projectId,
      profileId: profile?.id || stats.profileId,
      algorithmVersion: 'ability-diagnosis-v1',
      generatedAt: Date.now(),
      overall: {
        xingceGap,
        shenlunGap,
        remainingDays,
        phase: phaseFrom(remainingDays, stats),
        confidence: confidence(stats.totals.questionCount)
      },
      modules,
      recommendation: {
        focusModules,
        dailyQuestionTarget: recommendedDailyQuestions(profile),
        reviewRatio: reviewRatio(stats, modules, profile),
        mockFrequencyDays: remainingDays !== undefined && remainingDays <= 45 ? 7 : 14,
        essayFrequencyDays: weeklyDays >= 5 ? 3 : 5
      }
    };
  }
}

export const abilityDiagnosisService = new AbilityDiagnosisService();
