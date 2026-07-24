import type { CreateProjectInput, DailyPlan, ExamPlan, PlanTask, SyllabusTarget } from '@/domain/plan';
import type { AbilityProfile } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import { abilityDiagnosisService, type AbilityDiagnosis } from './AbilityDiagnosisService';
import { DEFAULT_KNOWLEDGE_TREE, XC_MODULES } from './KnowledgeDefaults';
import { settingsService } from './SettingsService';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function examName(input: CreateProjectInput): string {
  const type = input.examType || '';
  return input.province ? `${input.province}${type}` : type;
}

export function createBusinessModel(input: CreateProjectInput) {
  const examDate = input.examDate || '';
  const type = input.examType || '';
  return {
    version: 1,
    created_at: new Date().toISOString(),
    exam_type: type,
    exam_name: examName(input),
    province: input.province || '',
    exam_date: examDate,
    position: input.position || '',
    requirements: input.requirements || '',
    question_count: input.mockExamCount || 120,
    confidence: examDate && type ? 'medium' as const : 'low' as const,
    gaps: []
  };
}

function createPhases(examDate?: string): ExamPlan['phases'] | undefined {
  if (!examDate) return undefined;
  const end = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return undefined;

  const start = new Date();
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const phaseLen = Math.ceil(totalDays / 3);
  const p1s = start;
  const p1e = addDays(p1s, phaseLen);
  const p2s = addDays(p1e, 1);
  const p2e = addDays(p2s, phaseLen);
  const p3s = addDays(p2e, 1);
  return {
    '基础期': `${isoDate(p1s)} ~ ${isoDate(p1e)}`,
    '强化期': `${isoDate(p2s)} ~ ${isoDate(p2e)}`,
    '冲刺期': `${isoDate(p3s)} ~ ${examDate}`
  };
}

export function createExamPlan(input: CreateProjectInput): ExamPlan {
  return {
    exam_date: input.examDate || '',
    exam_name: examName(input),
    exam_type: input.examType || '',
    province: input.province || '',
    mock_exam_count: input.mockExamCount || 120,
    position: input.position || '',
    requirements: input.requirements || '',
    business_model: createBusinessModel(input),
    phases: createPhases(input.examDate),
    tasks: {}
  };
}

interface ModuleSummary {
  name: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface PlanAbilitySnapshot {
  modules?: Record<string, Record<string, { attempts?: number; accuracy?: number; proficiency?: number; status?: string; errors?: Record<string, number>; plateau?: { is_plateau?: boolean } }>>;
}

class PlanService {
  async getPlan(projectId: string): Promise<ExamPlan> {
    const key = this.planSettingKey(projectId);
    const saved = await settingsService.get<ExamPlan | null>(key, null);
    if (saved && Object.keys(saved).length) return saved;
    return {};
  }

  async savePlan(projectId: string, plan: ExamPlan): Promise<ExamPlan> {
    await settingsService.set(this.planSettingKey(projectId), plan);
    return plan;
  }

  async ensurePlan(projectId: string, input: CreateProjectInput): Promise<ExamPlan> {
    const existing = await this.getPlan(projectId);
    if (existing && Object.keys(existing).length) return existing;
    return this.savePlan(projectId, createExamPlan(input));
  }

  getPhase(plan: ExamPlan): string {
    if (!plan?.exam_date) return '诊断期';
    const end = new Date(`${plan.exam_date}T00:00:00`);
    const remain = Math.ceil((end.getTime() - Date.now()) / 86400000);
    if (!Number.isFinite(remain)) return '诊断期';
    if (remain <= 30) return '冲刺期';
    if (remain <= 90) return '强化期';
    return '基础期';
  }

  private moduleSummaries(profile: PlanAbilitySnapshot): ModuleSummary[] {
    return XC_MODULES.map((name) => {
      const points = Object.values(profile.modules?.[name] || {});
      const total = points.reduce((sum, point) => sum + (point.attempts || 0), 0);
      const weighted = points.reduce((sum, point) => sum + (point.attempts || 0) * (point.accuracy || 0), 0);
      const accuracy = total ? Math.round((weighted / total) * 100) : 0;
      return { name, total, correct: Math.round(total * accuracy / 100), accuracy };
    }).sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      return a.accuracy - b.accuracy;
    });
  }

  async loadSyllabusTargets(_projectId: string, profile: PlanAbilitySnapshot): Promise<SyllabusTarget[]> {
    const targets: SyllabusTarget[] = [];
    for (const moduleName of XC_MODULES) {
      const syllabus = DEFAULT_KNOWLEDGE_TREE[moduleName] || {};
      for (const [group, items] of Object.entries(syllabus)) {
        for (const item of items || []) {
          const name = item;
          if (!name) continue;
          const point = profile.modules?.[moduleName]?.[name];
          const attempts = point?.attempts || 0;
          const accuracy = Math.round((point?.accuracy || 0) * 100);
          const proficiency = Math.round(((point?.proficiency ?? point?.accuracy) || 0) * 100);
          const status = point?.status || '未学';
          const errors = Object.values(point?.errors || {}).reduce((sum, count) => sum + (count || 0), 0);
          let priority = 0;
          if (status === '未学') priority += 50;
          if (attempts < 3) priority += 35;
          priority += Math.max(0, 80 - proficiency);
          priority += Math.min(30, errors * 6);
          if (point?.plateau?.is_plateau) priority += 12;
          targets.push({
            module: moduleName,
            group,
            knowledge_point: name,
            status,
            attempts,
            accuracy,
            proficiency,
            errors,
            priority,
            reason: status === '未学' ? '大纲未学' : attempts < 3 ? '样本不足' : proficiency < 65 ? `掌握度 ${proficiency}%` : errors > 0 ? `错因 ${errors} 次` : '巩固提升'
          });
        }
      }
    }
    return targets.sort((a, b) => b.priority - a.priority);
  }

  buildTodayTasks(input: { plan: ExamPlan; profile?: PlanAbilitySnapshot; stats?: { records?: Array<{ total?: number }> }; reviewDue?: number; targets?: SyllabusTarget[] }): DailyPlan {
    const plan = input.plan || {};
    const profile = input.profile || {};
    const stats = input.stats || {};
    const reviewDue = input.reviewDue || 0;
    const abilityDiagnosis = (input as typeof input & { diagnosis?: AbilityDiagnosis }).diagnosis;
    const phase = this.phaseFromDiagnosis(abilityDiagnosis) || this.getPhase(plan);
    const records = stats.records || [];
    const sampleTotal = records.reduce((sum, record) => sum + (record.total || 0), 0);
    const modules = this.moduleSummaries(profile);
    const covered = modules.filter((module) => module.total > 0).length;
    const gaps: string[] = [];
    if (!plan.exam_date) gaps.push('考试日期未确认');
    if (!plan.business_model) gaps.push('目标模型不完整');
    if (sampleTotal < 30) gaps.push('诊断样本不足');
    if (covered < 3) gaps.push('模块覆盖不足');
    const diagnosis = { sample_total: sampleTotal, covered_modules: covered, gaps, ready: gaps.length === 0, label: gaps[0] || '诊断充分' };
    const targets = input.targets || [];
    const weak = modules.filter((module) => module.total === 0 || module.accuracy < (phase === '冲刺期' ? 78 : phase === '强化期' ? 72 : 65));
    const focusModules = abilityDiagnosis?.recommendation.focusModules || [];
    const priority = this.prioritizeModules(weak.length ? weak : modules, focusModules);
    const dailyTarget = abilityDiagnosis?.recommendation.dailyQuestionTarget || 15;
    const reviewRatio = abilityDiagnosis?.recommendation.reviewRatio || 0.25;
    const items: PlanTask[] = [];
    let id = 1;

    if (!diagnosis.ready) {
      const firstTarget = targets[0];
      const first = firstTarget ? { name: firstTarget.module } : (priority[0] || { name: '资料分析' });
      items.push({
        id: id++,
        type: 'diagnosis',
        module: first.name,
        text: `完成首次诊断 · ${first.name}`,
        knowledge_point: firstTarget?.knowledge_point || '',
        target: Math.min(12, Math.max(8, Math.round(dailyTarget * 0.55))),
        actual: 0,
        done: false,
        source: 'business_v1',
        reason: firstTarget ? `${firstTarget.knowledge_point} · ${firstTarget.reason}` : diagnosis.label,
        sub: '按大纲补齐画像样本',
        prescription: { purpose: 'diagnosis', question_count: Math.min(12, Math.max(8, Math.round(dailyTarget * 0.55))), difficulty: 'mixed', new_review_ratio: reviewRatio >= 0.35 ? '6:4' : '8:2', reason: diagnosis.label }
      });
    }

    if (reviewDue > 0) {
      items.push({
        id: id++,
        type: 'review',
        module: priority[0]?.name || '',
        text: '复习到期错题',
        target: Math.min(Math.max(10, Math.round(dailyTarget * reviewRatio)), reviewDue),
        actual: 0,
        done: false,
        source: 'business_v1',
        reason: `${reviewDue} 条复习到期`,
        sub: '先处理遗忘风险',
        prescription: { purpose: 'review', question_count: Math.min(Math.max(10, Math.round(dailyTarget * reviewRatio)), reviewDue), difficulty: '错题同难度+变式', new_review_ratio: '0:10', reason: '到期复习' }
      });
    }

    const usedModules = new Set<string>();
    targets.slice(0, phase === '冲刺期' ? 2 : 3).forEach((target) => {
      if (usedModules.has(target.module) && phase !== '基础期') return;
      usedModules.add(target.module);
      items.push({
        id: id++,
        type: 'practice',
        module: target.module,
        text: `${target.module} · ${target.knowledge_point}`,
        knowledge_point: target.knowledge_point,
        target: target.attempts < 3 ? Math.min(10, dailyTarget) : Math.min(16, dailyTarget),
        actual: 0,
        done: false,
        source: 'business_v2_syllabus',
        reason: target.reason,
        sub: `${target.group} · 练完回流画像`,
        prescription: {
          purpose: target.attempts < 3 ? 'sample_building' : 'weakness_training',
          question_count: target.attempts < 3 ? Math.min(10, dailyTarget) : Math.min(16, dailyTarget),
          difficulty: target.proficiency < 45 ? '基础-标准' : '标准-进阶',
          new_review_ratio: target.errors > 0 ? '6:4' : '8:2',
          reason: target.reason
        }
      });
    });

    if (!items.some((item) => item.type === 'practice')) {
      priority.slice(0, phase === '冲刺期' ? 1 : 2).forEach((module) => {
        const moduleDiagnosis = abilityDiagnosis?.modules.find((item) => item.module === module.name);
        items.push({
          id: id++,
          type: 'practice',
          module: module.name,
          text: `${module.name}专项练习`,
          target: module.total < 10 ? Math.min(10, dailyTarget) : Math.min(18, dailyTarget),
          actual: 0,
          done: false,
          source: 'business_v1',
          reason: moduleDiagnosis ? this.reasonFromDiagnosis(moduleDiagnosis) : module.total === 0 ? '尚无样本' : `正确率 ${module.accuracy}%`,
          sub: '弱项优先，完成后回流画像',
          prescription: { purpose: module.total < 10 ? 'sample_building' : 'module_boost', question_count: module.total < 10 ? Math.min(10, dailyTarget) : Math.min(18, dailyTarget), difficulty: module.accuracy < 50 ? '基础-标准' : '标准', new_review_ratio: reviewRatio >= 0.35 ? '6:4' : '7:3', reason: moduleDiagnosis ? this.reasonFromDiagnosis(moduleDiagnosis) : module.total === 0 ? '尚无样本' : `正确率 ${module.accuracy}%` }
        });
      });
    }

    items.push({
      id: id++,
      type: 'essay',
      module: '申论',
      text: phase === '冲刺期' ? '申论限时训练' : '申论基础训练',
      target: 1,
      actual: 0,
      done: false,
      source: 'business_v1',
      reason: '主观题需要连续样本',
      sub: 'AI 批改仅作训练参考',
      prescription: { purpose: 'essay_dimension_training', question_count: 1, difficulty: phase === '冲刺期' ? '限时套题' : '单题精练', new_review_ratio: '新题+复盘', reason: '主观题维度画像' }
    });

    items.push(phase === '冲刺期'
      ? { id: id++, type: 'mock', module: '', text: '限时模拟考试', target: 1, actual: 0, done: false, source: 'business_v1', reason: `考前 ${phase}`, sub: '按真实时间完成并回流错题', prescription: { purpose: 'mock_exam', question_count: 1, difficulty: '全真限时', new_review_ratio: '阶段评估', reason: '考前综合校准' } }
      : { id: id++, type: 'digest', module: '', text: '每日积累', target: 1, actual: 0, done: false, source: 'business_v1', reason: '常识和申论素材', sub: '补充时政与表达素材' });

    return { generated_by: 'business_v1', phase, diagnosis, items: items.slice(0, 5) };
  }

  async generateTodayPlan(projectId: string): Promise<DailyPlan> {
    const [plan, profiles, sessions, diagnosis] = await Promise.all([
      this.getPlan(projectId),
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', projectId),
      database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', projectId),
      abilityDiagnosisService.latestOrCurrent()
    ]);
    const profile = this.profileFromStructured(profiles);
    const stats = { records: sessions.map((session) => ({ total: session.questionCount })) };
    const targets = await this.loadSyllabusTargets(projectId, profile);
    const daily = this.buildTodayTasks({ plan, profile, stats, targets, diagnosis } as Parameters<PlanService['buildTodayTasks']>[0] & { diagnosis: AbilityDiagnosis });
    const nextPlan: ExamPlan = {
      ...plan,
      tasks: {
        ...(plan.tasks || {}),
        [today()]: daily
      }
    };
    await this.savePlan(projectId, nextPlan);
    return daily;
  }

  private phaseFromDiagnosis(diagnosis?: AbilityDiagnosis): string | undefined {
    if (!diagnosis) return undefined;
    return {
      onboarding: '诊断期',
      diagnosis: '诊断期',
      foundation: '基础期',
      improvement: '强化期',
      sprint: '冲刺期'
    }[diagnosis.overall.phase];
  }

  private prioritizeModules(modules: ModuleSummary[], focusModules: string[]): ModuleSummary[] {
    if (!focusModules.length) return modules;
    const rank = new Map(focusModules.map((module, index) => [module, index]));
    return [...modules].sort((a, b) => {
      const ar = rank.has(a.name) ? rank.get(a.name)! : 99;
      const br = rank.has(b.name) ? rank.get(b.name)! : 99;
      return ar - br || a.accuracy - b.accuracy || a.total - b.total;
    });
  }

  private reasonFromDiagnosis(module: AbilityDiagnosis['modules'][number]): string {
    if (module.reasonCodes.includes('sample_insufficient')) return '样本不足，需要先补诊断题';
    if (module.reasonCodes.includes('accuracy_below_target') && module.reasonCodes.includes('speed_slower_than_target')) return '正确率和速度都低于目标';
    if (module.reasonCodes.includes('accuracy_below_target')) return `正确率差距 ${module.accuracyGap}%`;
    if (module.reasonCodes.includes('speed_slower_than_target')) return `平均耗时慢 ${module.speedGap} 秒`;
    if (module.reasonCodes.includes('repeat_wrong_high')) return '重复错题率偏高';
    return `诊断优先级 ${module.priority}`;
  }

  private profileFromStructured(profiles: AbilityProfile[]): PlanAbilitySnapshot {
    const modules: NonNullable<PlanAbilitySnapshot['modules']> = {};
    for (const moduleName of XC_MODULES) {
      const profile = profiles.find((item) => item.module === moduleName);
      const groups = DEFAULT_KNOWLEDGE_TREE[moduleName] || {};
      const pointNames = Object.values(groups).flat();
      const attemptsPerPoint = profile && pointNames.length ? Math.max(1, Math.round(profile.total / pointNames.length)) : 0;
      modules[moduleName] = Object.fromEntries(pointNames.map((pointName) => [
        pointName,
        {
          attempts: attemptsPerPoint,
          accuracy: profile ? profile.accuracy / 100 : 0,
          proficiency: profile ? profile.accuracy / 100 : 0,
          status: profile && profile.total > 0 ? (profile.accuracy >= 75 ? '已掌握' : '学习中') : '未学',
          errors: {}
        }
      ]));
    }
    return { modules };
  }

  private planSettingKey(projectId: string): string {
    return `plan:${projectId}`;
  }
}

export const planService = new PlanService();
