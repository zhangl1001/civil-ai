import { initializeTutorRuntime } from '@/composition-root/public';

export class AIStudentContextService {
  async buildSystemContext(): Promise<string> {
    try {
      const runtime = await initializeTutorRuntime();
      const home = await runtime.getCandidateHome.execute();
      if (!home) return '';
      return [
        '# 当前考期锚点',
        '这里只提供保持陪伴连续性所需的最小事实。能力、计划、题库和错题明细必须按需调用只读工具，不得猜测。',
        `考试周期：${home.projectName} · ${home.examName} · 阶段 ${home.phase} · 考试日期 ${home.examDate}`,
        `建档状态：${home.diagnosisStatus}`,
        `目标差距：${home.scores.map((score) => `${score.subject} ${score.currentScore ?? '未测'}/${score.targetScore}${score.gap === undefined ? '' : `，差距 ${score.gap}`}`).join('；') || '暂无目标分'}`,
        '对话策略：先回应当前问题；需要学习事实时再调用对应工具，只使用本次查询返回的数据。'
      ].join('\n');
    } catch {
      return '';
    }
  }
}

export const aiStudentContextService = new AIStudentContextService();
