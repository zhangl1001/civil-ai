import { initializeTutorRuntime } from '@/composition-root/public';
import { practiceModuleLabel } from '@/domain/labels';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { ObjectiveSessionFacts } from '@/modules/evidence/public';
import type { MasteryTrack, ReviewQueueItem } from '@/modules/mastery/public';
import type { AbilityCalibrationSnapshot } from '@/modules/calibration/public';

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

export interface QualityModule {
  code: string;
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  mastery: number;
  confidence: number;
  avgSeconds: number;
  openWrongCount: number;
  repeatWrongRate: number;
}

export interface QualityTrendPoint {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface QualityDashboard {
  score: number;
  grade: string;
  totalQuestions: number;
  practiceDays: number;
  streak: number;
  weekQuestions: number;
  weekMinutes: number;
  avgSecondsPerQuestion: number;
  weakestModule?: QualityModule;
  modules: QualityModule[];
  trend: QualityTrendPoint[];
  openWrongCount: number;
  reviewDueCount: number;
  eventsCount: number;
  advice: string[];
  diagnosis: AbilityDiagnosis;
  diagnosisSummary: string;
  moduleDiagnoses: ModuleDiagnosis[];
  calibration?: AbilityCalibrationSnapshot;
}

interface SessionSlice {
  readonly facts: ObjectiveSessionFacts;
  readonly module: string;
}

export class QualityDashboardService {
  async dashboard(): Promise<QualityDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');

    const [curriculum, sessions, tracks, reviews, candidateHome, calibration] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.learningSessionRepository.listAll(cycle.examCycle.id),
      runtime.masteryRepository.listAllTracks(cycle.examCycle.id),
      runtime.masteryRepository.listAllReviews(cycle.examCycle.id),
      runtime.getCandidateHome.execute(),
      runtime.buildAbilityCalibration.execute({ persist: false })
    ]);
    if (!curriculum) throw new Error('当前考试大纲不可用。');

    const questionSetIds = [...new Set(sessions.map((item) => item.session.questionSetId))];
    const questionSets = await Promise.all(questionSetIds.map((id) => runtime.contentRepository.findQuestionSet(id)));
    const questionSetsById = new Map(questionSets.flatMap((bundle) => (
      bundle ? [[bundle.questionSet.id, bundle] as const] : []
    )));
    const slices: SessionSlice[] = sessions.map((facts) => ({
      facts,
      module: questionSetsById.get(facts.session.questionSetId)?.questionSet.module || 'aptitude'
    }));
    const nodesById = new Map(curriculum.capabilityNodes.map((node) => [node.id, node]));
    const moduleNames = buildModuleNames(curriculum.capabilityNodes);
    const modules = buildModules(slices, tracks, nodesById, moduleNames);
    const totalQuestions = sessions.reduce((sum, item) => sum + item.session.questionCount, 0);
    const totalCorrect = sessions.reduce((sum, item) => sum + item.session.correctCount, 0);
    const totalDuration = sessions.reduce((sum, item) => sum + item.session.elapsedMs, 0);
    const dates = new Set(sessions.map((item) => localDate(item.session.completedAt)));
    const weekStart = localDate(Date.now() - 6 * 86_400_000);
    const weekSessions = sessions.filter((item) => localDate(item.session.completedAt) >= weekStart);
    const openWrongCount = modules.reduce((sum, module) => sum + module.openWrongCount, 0);
    const reviewDueCount = reviews.filter((item) => isDueReview(item, Date.now())).length;
    const accuracy = totalQuestions ? totalCorrect / totalQuestions : 0;
    const recent = sessions.slice(0, 10);
    const recentTotal = recent.reduce((sum, item) => sum + item.session.questionCount, 0);
    const recentAccuracy = recentTotal
      ? recent.reduce((sum, item) => sum + item.session.correctCount, 0) / recentTotal
      : 0;
    const avgSecondsPerQuestion = totalQuestions ? Math.round(totalDuration / totalQuestions / 1000) : 0;
    const stability = weightedAverage(tracks, 'stability');
    const confidence = weightedAverage(tracks, 'confidence');
    const score = totalQuestions
      ? Math.round(clamp01(accuracy * 0.5 + recentAccuracy * 0.2 + stability * 0.2 + confidence * 0.1) * 100)
      : 0;
    const moduleDiagnoses = modules.map((module) => diagnoseModule(
      module,
      curriculum.capabilityNodes.filter((node) => node.module === module.code)
    )).sort((left, right) => right.priority - left.priority);
    const weakestModule = modules
      .filter((module) => module.total > 0)
      .slice()
      .sort((left, right) => left.mastery - right.mastery || left.accuracy - right.accuracy)[0];
    const remainingDays = daysUntil(cycle.examCycle.examDate);
    const diagnosis: AbilityDiagnosis = {
      projectId: cycle.project.id,
      profileId: cycle.profile.id,
      algorithmVersion: 'tutor-evidence-diagnosis:v1',
      generatedAt: Date.now(),
      overall: {
        xingceGap: candidateHome?.scores.find((item) => item.subject === 'aptitude')?.gap,
        shenlunGap: candidateHome?.scores.find((item) => item.subject === 'essay')?.gap,
        remainingDays,
        phase: diagnosisPhase(cycle.examCycle.phase, totalQuestions),
        confidence
      },
      modules: moduleDiagnoses,
      recommendation: {
        focusModules: moduleDiagnoses.filter((item) => item.diagnosisType !== 'stable').slice(0, 3).map((item) => item.module),
        dailyQuestionTarget: dailyQuestionTarget(cycle.studyConstraints.weekdayMinutes),
        reviewRatio: reviewDueCount > 0 || openWrongCount >= 10 ? 0.4 : 0.25,
        mockFrequencyDays: remainingDays !== undefined && remainingDays <= 45 ? 7 : 14,
        essayFrequencyDays: 3
      }
    };

    return {
      score,
      grade: gradeFor(score, totalQuestions),
      totalQuestions,
      practiceDays: dates.size,
      streak: streakFrom(dates),
      weekQuestions: weekSessions.reduce((sum, item) => sum + item.session.questionCount, 0),
      weekMinutes: Math.round(weekSessions.reduce((sum, item) => sum + item.session.elapsedMs, 0) / 60_000),
      avgSecondsPerQuestion,
      weakestModule,
      modules,
      trend: trend(sessions),
      openWrongCount,
      reviewDueCount,
      eventsCount: sessions.length,
      advice: adviceFor({ totalQuestions, weakestModule, reviewDueCount, avgSecondsPerQuestion }),
      diagnosis,
      diagnosisSummary: diagnosisSummary(diagnosis),
      moduleDiagnoses,
      calibration
    };
  }
}

function buildModuleNames(nodes: readonly CapabilityNode[]): ReadonlyMap<string, string> {
  return new Map(nodes
    .filter((node) => node.nodeType === 'module')
    .map((node) => [node.module, node.name]));
}

function buildModules(
  sessions: readonly SessionSlice[],
  tracks: readonly MasteryTrack[],
  nodesById: ReadonlyMap<string, CapabilityNode>,
  moduleNames: ReadonlyMap<string, string>
): QualityModule[] {
  const grouped = new Map<string, {
    total: number;
    correct: number;
    elapsedMs: number;
    wrongByQuestion: Map<string, number>;
    latestResultByQuestion: Map<string, string>;
  }>();
  sessions.forEach(({ facts, module }) => {
    const current = grouped.get(module) || {
      total: 0,
      correct: 0,
      elapsedMs: 0,
      wrongByQuestion: new Map<string, number>(),
      latestResultByQuestion: new Map<string, string>()
    };
    current.total += facts.session.questionCount;
    current.correct += facts.session.correctCount;
    current.elapsedMs += facts.session.elapsedMs;
    facts.attempts.forEach((attempt) => {
      if (!current.latestResultByQuestion.has(attempt.questionId)) {
        current.latestResultByQuestion.set(attempt.questionId, attempt.result);
      }
      if (attempt.result === 'incorrect') {
        current.wrongByQuestion.set(attempt.questionId, (current.wrongByQuestion.get(attempt.questionId) || 0) + 1);
      }
    });
    grouped.set(module, current);
  });
  tracks.forEach((track) => {
    const module = nodesById.get(track.capabilityNodeId)?.module;
    if (module && !grouped.has(module) && track.effectiveSample > 0) {
      grouped.set(module, {
        total: Math.max(1, Math.round(track.effectiveSample)),
        correct: Math.round(track.effectiveSample * track.accuracy),
        elapsedMs: 0,
        wrongByQuestion: new Map(),
        latestResultByQuestion: new Map()
      });
    }
  });
  return [...grouped.entries()].map(([code, values]) => {
    const moduleTracks = tracks.filter((track) => nodesById.get(track.capabilityNodeId)?.module === code);
    return {
      code,
      name: moduleNames.get(code) || moduleLabel(code),
      total: values.total,
      correct: values.correct,
      accuracy: values.total ? Math.round(values.correct / values.total * 100) : 0,
      mastery: Math.round(weightedAverage(moduleTracks, 'stability') * 100),
      confidence: weightedAverage(moduleTracks, 'confidence'),
      avgSeconds: values.total ? Math.round(values.elapsedMs / values.total / 1000) : 0,
      openWrongCount: [...values.latestResultByQuestion.values()].filter((result) => result === 'incorrect').length,
      repeatWrongRate: values.wrongByQuestion.size
        ? Math.round([...values.wrongByQuestion.values()].filter((count) => count > 1).length / values.wrongByQuestion.size * 100)
        : 0
    };
  }).sort((left, right) => right.total - left.total);
}

function diagnoseModule(module: QualityModule, nodes: readonly CapabilityNode[]): ModuleDiagnosis {
  const targetAccuracy = Math.round((nodes.find((node) => node.defaultTargetAccuracy)?.defaultTargetAccuracy ?? 0.72) * 100);
  const targetSeconds = Math.round(nodes.find((node) => node.defaultTargetSeconds)?.defaultTargetSeconds ?? 70);
  const accuracyGap = Math.max(0, targetAccuracy - module.accuracy);
  const speedGap = Math.max(0, module.avgSeconds - targetSeconds);
  const reasonCodes: string[] = [];
  if (module.total < 20) reasonCodes.push('sample_insufficient');
  if (accuracyGap >= 12) reasonCodes.push('accuracy_below_target');
  if (speedGap >= Math.max(10, targetSeconds * 0.2)) reasonCodes.push('speed_below_target');
  if (module.repeatWrongRate >= 25) reasonCodes.push('repeat_wrong_high');
  if (module.confidence < 0.45 && module.total >= 20) reasonCodes.push('evidence_unstable');
  let diagnosisType: DiagnosisType = 'stable';
  if (module.total < 20) diagnosisType = 'insufficient_sample';
  else if (accuracyGap >= 12 && speedGap >= Math.max(10, targetSeconds * 0.2)) diagnosisType = 'accuracy_and_speed_weak';
  else if (accuracyGap >= 12) diagnosisType = 'weak_accuracy';
  else if (speedGap >= Math.max(10, targetSeconds * 0.2)) diagnosisType = 'slow_speed';
  else if (module.repeatWrongRate >= 25) diagnosisType = 'review_not_closed';
  else if (module.confidence < 0.45) diagnosisType = 'unstable';
  return {
    module: module.name,
    questionCount: module.total,
    accuracy: module.accuracy,
    avgSeconds: module.avgSeconds,
    targetAccuracy,
    targetSeconds,
    accuracyGap,
    speedGap,
    repeatWrongRate: module.repeatWrongRate,
    priority: Math.round(
      accuracyGap * 1.8
      + Math.min(30, speedGap / Math.max(1, targetSeconds) * 30)
      + module.repeatWrongRate * 0.35
      + (1 - module.confidence) * 12
      + Math.min(12, module.openWrongCount)
    ),
    confidence: module.confidence,
    diagnosisType,
    reasonCodes
  };
}

function trend(sessions: readonly ObjectiveSessionFacts[]): QualityTrendPoint[] {
  return Array.from({ length: 7 }, (_, index) => localDate(Date.now() + (index - 6) * 86_400_000)).map((date) => {
    const day = sessions.filter((item) => localDate(item.session.completedAt) === date);
    const total = day.reduce((sum, item) => sum + item.session.questionCount, 0);
    const correct = day.reduce((sum, item) => sum + item.session.correctCount, 0);
    return { date, total, correct, accuracy: total ? Math.round(correct / total * 100) : 0 };
  });
}

function adviceFor(input: {
  readonly totalQuestions: number;
  readonly weakestModule?: QualityModule;
  readonly reviewDueCount: number;
  readonly avgSecondsPerQuestion: number;
}): string[] {
  const result: string[] = [];
  if (input.totalQuestions < 30) result.push('真实作答样本不足，先完成几组针对性练习再判断长期能力。');
  if (input.weakestModule) result.push(`优先补强${input.weakestModule.name}，当前证据掌握度 ${input.weakestModule.mastery}%。`);
  if (input.reviewDueCount) result.push(`${input.reviewDueCount} 个知识点已到复习窗口，建议先复习再做新题。`);
  if (input.avgSecondsPerQuestion > 90) result.push('平均作答速度偏慢，后续训练需要加入限时证据。');
  return result.length ? result : ['当前证据表现稳定，继续按计划巩固并补充迁移样本。'];
}

function diagnosisSummary(value: AbilityDiagnosis): string {
  const focus = value.recommendation.focusModules.length
    ? `优先训练${value.recommendation.focusModules.join('、')}`
    : '当前能力证据相对稳定';
  const gaps = [
    value.overall.xingceGap !== undefined ? `行测差距 ${value.overall.xingceGap} 分` : '',
    value.overall.shenlunGap !== undefined ? `申论差距 ${value.overall.shenlunGap} 分` : ''
  ].filter(Boolean).join('，');
  return `${focus}${gaps ? ` · ${gaps}` : ''}`;
}

function weightedAverage<T extends 'stability' | 'confidence'>(
  tracks: readonly MasteryTrack[],
  key: T
): number {
  const values = tracks.filter((track) => track.effectiveSample > 0);
  const totalWeight = values.reduce((sum, track) => sum + track.effectiveSample, 0);
  if (!totalWeight) return 0;
  return values.reduce((sum, track) => sum + track[key] * track.effectiveSample, 0) / totalWeight;
}

function isDueReview(review: ReviewQueueItem, now: number): boolean {
  return (review.status === 'scheduled' || review.status === 'in_progress') && review.dueAt <= now;
}

function gradeFor(score: number, totalQuestions: number): string {
  if (!totalQuestions) return '待诊断';
  if (score >= 85) return 'S 级';
  if (score >= 75) return 'A 级';
  if (score >= 65) return 'B 级';
  if (score >= 55) return 'C 级';
  return 'D 级';
}

function streakFrom(dates: ReadonlySet<string>): number {
  let count = 0;
  let cursor = Date.now();
  while (dates.has(localDate(cursor))) {
    count += 1;
    cursor -= 86_400_000;
  }
  return count;
}

function dailyQuestionTarget(minutes: number): number {
  return Math.max(8, Math.min(60, Math.round(minutes / 4)));
}

function daysUntil(value: string): number | undefined {
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 86_400_000)) : undefined;
}

function diagnosisPhase(
  phase: string,
  totalQuestions: number
): AbilityDiagnosis['overall']['phase'] {
  if (!totalQuestions) return 'onboarding';
  if (totalQuestions < 30) return 'diagnosis';
  if (phase === 'sprint') return 'sprint';
  if (phase === 'development' || phase === 'consolidation') return 'improvement';
  return 'foundation';
}

function localDate(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function moduleLabel(code: string): string {
  return practiceModuleLabel(code);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export const qualityDashboardService = new QualityDashboardService();
