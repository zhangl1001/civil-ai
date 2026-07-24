import { initializeTutorRuntime } from '@/composition-root/public';
import type { LocalDate } from '@/kernel/public';
import type { CapabilityNode } from '@/modules/curriculum/public';
import { errorCauseLabel } from '@/modules/evidence/public';
import type { DailyPlanItemRecord } from '@/modules/planning/public';
import type { MasteryTrack } from '@/modules/mastery/public';

const MAX_TRACKS = 5;
const MAX_PLAN_ITEMS = 5;

export class AIStudentContextService {
  async buildSystemContext(): Promise<string> {
    try {
      const runtime = await initializeTutorRuntime();
      const home = await runtime.getCandidateHome.execute();
      const cycle = await runtime.candidateRepository.findCurrentCycle();
      if (!home || !cycle) return '';

      const [curriculum, tracks, plan, wrongBook] = await Promise.all([
        runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
        runtime.masteryRepository.listPriorityTracks(home.examCycleId, MAX_TRACKS),
        runtime.dailyPlanRepository.findCurrent(home.examCycleId, todayLocalDate()),
        runtime.getWrongBookEntries.execute({ examCycleId: home.examCycleId, limit: 20 })
      ]);
      const nodes = new Map((curriculum?.capabilityNodes || []).map((node) => [node.id, node]));
      const lines = [
        '# 学生教学档案摘要',
        '以下是本地学习引擎提供的确定性摘要，只能作为教学建议依据；不要编造缺失数据。',
        `考试周期：${home.projectName} · ${home.examName} · 阶段 ${home.phase} · 考试日期 ${home.examDate}`,
        `建档状态：${home.diagnosisStatus}`,
        `目标差距：${home.scores.map((score) => `${score.subject} ${score.currentScore ?? '未测'}/${score.targetScore}${score.gap === undefined ? '' : `，差距 ${score.gap}`}`).join('；') || '暂无目标分'}`,
        formatTracks(tracks, nodes),
        formatErrorCauses(wrongBook.flatMap((entry) => entry.diagnoses.map((diagnosis) => diagnosis.causeCode))),
        formatPlan(plan?.items || [], nodes),
        '对话策略：先回应用户当下问题，再结合目标差距、薄弱点和今日计划给具体建议；不展示内部思考，不把历史原文当作事实。'
      ].filter(Boolean);
      return lines.join('\n');
    } catch {
      return '';
    }
  }
}

function formatErrorCauses(causeCodes: readonly string[]): string {
  if (!causeCodes.length) return '最近错因：暂无足够错题诊断。';
  const counts = new Map<string, number>();
  causeCodes.forEach((code) => counts.set(code, (counts.get(code) || 0) + 1));
  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([code, count]) => `${errorCauseLabel[code as keyof typeof errorCauseLabel] || code} ${count}次`);
  return `最近错因：${top.join('；')}`;
}

function formatTracks(tracks: readonly MasteryTrack[], nodes: Map<string, CapabilityNode>): string {
  if (!tracks.length) return '优先薄弱点：暂无足够学习证据。';
  return `优先薄弱点：${tracks.map((track) => {
    const node = nodes.get(track.capabilityNodeId);
    const name = node ? `${node.module}/${node.name}` : track.capabilityNodeId;
    return `${name}(${track.state}，正确率${percent(track.accuracy)}，稳定性${percent(track.stability)})`;
  }).join('；')}`;
}

function formatPlan(items: readonly DailyPlanItemRecord[], nodes: Map<string, CapabilityNode>): string {
  const visible = items.slice(0, MAX_PLAN_ITEMS);
  if (!visible.length) return '今日计划：暂无已生成计划。';
  return `今日计划：${visible.map((item) => {
    const node = nodes.get(item.capabilityNodeId);
    const name = node ? `${node.module}/${node.name}` : item.capabilityNodeId;
    return `${item.sequence}.${item.itemType} ${name} ${item.status}`;
  }).join('；')}`;
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` as LocalDate;
}

export const aiStudentContextService = new AIStudentContextService();
