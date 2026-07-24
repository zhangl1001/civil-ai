import type { ExamPlan } from '@/domain/plan';
import type { HomeFeatureGroup } from '@/domain/home';

export interface HomeFeatureContext {
  plan: ExamPlan;
  hasAbility: boolean;
  totalQuestions: number;
  totalWrong: number;
  reviewDue: number;
}

function examDays(plan: ExamPlan): number | null {
  if (!plan?.exam_date) return null;
  const exam = new Date(`${plan.exam_date}T00:00:00`);
  if (Number.isNaN(exam.getTime())) return null;
  return Math.max(0, Math.ceil((exam.getTime() - Date.now()) / 86400000));
}

export class HomeFeatureService {
  buildGroups(ctx: HomeFeatureContext): HomeFeatureGroup[] {
    const hasErrors = ctx.reviewDue > 0 || ctx.totalWrong > 0;
    const days = examDays(ctx.plan);
    const sprintReady = ctx.hasAbility && days !== null;

    return [
      {
        id: 'diagnosis',
        title: '诊断复盘',
        sub: '把错题、画像和质量数据转成下一组训练',
        items: [
          {
            id: 'error-report',
            name: '错因报告',
            sub: hasErrors ? `${ctx.totalWrong} 道错题，定位首要错因` : '完成批改后生成',
            icon: 'PieChart',
            color: 'red',
            ready: hasErrors,
            actionLabel: '复盘',
            disabledReason: '先完成一组练习并批改',
            action: { kind: 'route', route: '/vue/error-report' }
          },
          {
            id: 'knowledge-graph',
            name: '知识地图',
            sub: ctx.hasAbility ? '按大纲查看薄弱考点' : '先建立能力画像',
            icon: 'Map',
            color: 'green',
            ready: ctx.hasAbility,
            actionLabel: '定位',
            disabledReason: '先完成诊断或专项练习',
            action: { kind: 'route', route: '/vue/knowledge-graph' }
          },
          {
            id: 'quality-dashboard',
            name: '质量追踪',
            sub: ctx.totalQuestions ? `已记录 ${ctx.totalQuestions} 题，找训练偏差` : '学习、题目和评分质量面板',
            icon: 'BarChart3',
            color: 'blue',
            ready: true,
            actionLabel: '追踪',
            action: { kind: 'route', route: '/vue/quality-dashboard' }
          }
        ]
      },
      {
        id: 'improve',
        title: '专项提升',
        sub: '围绕阶段任务补强薄弱项和素材积累',
        items: [
          {
            id: 'sprint',
            name: '考前冲刺',
            sub: sprintReady ? (days! <= 30 ? `距考试 ${days} 天，强化冲刺` : `距考试 ${days} 天，提前规划`) : (days === null ? '设置考试日期后启用' : '先完成诊断练习'),
            icon: 'Flame',
            color: 'orange',
            ready: sprintReady,
            actionLabel: '冲刺',
            disabledReason: days === null ? '请先设置备考计划' : '先完成诊断练习',
            action: { kind: 'route', route: '/vue/sprint' }
          },
          {
            id: 'monthly-digest',
            name: '时政月报',
            sub: '常识判断与申论素材积累',
            icon: 'Newspaper',
            color: 'blue',
            ready: true,
            actionLabel: '训练',
            action: { kind: 'route', route: '/vue/monthly-digest' }
          },
          {
            id: 'interview',
            name: '面试模拟',
            sub: '结构化表达与答题复盘',
            icon: 'Mic',
            color: 'purple',
            ready: true,
            actionLabel: '模拟',
            action: { kind: 'route', route: '/vue/interview' }
          }
        ]
      }
    ];
  }
}

export const homeFeatureService = new HomeFeatureService();
