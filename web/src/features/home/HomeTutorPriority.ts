import type { RouteLocationRaw } from 'vue-router';
import { essayCenterLocation } from '@/features/practice/EssayNavigation';
import { practiceDetailLocation } from '@/features/practice/PracticeNavigation';
import { LearnerPriorityAction, type LearnerPriorityResult } from '@/modules/mastery/public';

export function tutorPriorityTitle(priority: LearnerPriorityResult): string {
  if (priority.action === LearnerPriorityAction.Learn) return `今天先学透 ${priority.name}`;
  if (priority.action === LearnerPriorityAction.Review) return `今天优先复习 ${priority.name}`;
  if (priority.action === LearnerPriorityAction.Diagnose) return `继续校准 ${priority.name}`;
  if (priority.action === LearnerPriorityAction.Maintain) return `保持 ${priority.name} 的稳定表现`;
  return `今天优先突破 ${priority.name}`;
}

export function tutorPriorityDetail(priority: LearnerPriorityResult): string {
  if (!priority.reliable) return `${priority.module} 的有效样本和置信度仍不足，先用一组高信息量题目确认真实水平。`;
  if (priority.reasonCodes.includes('learning_needs_validation')) return `已经完成${priority.name}讲解，下一步用配套练习验证是否真正掌握。`;
  if (priority.action === LearnerPriorityAction.Review) return `${priority.name} 的证据正在变旧或保持度不足，适合先复习再训练。`;
  return `${priority.name} 当前正确率 ${Math.round(priority.accuracy * 100)}%，系统已综合样本量、保持度和迁移表现安排下一步。`;
}

export function tutorPriorityActionLabel(priority: LearnerPriorityResult): string {
  if (priority.action === LearnerPriorityAction.Learn) return `学习${priority.name}`;
  if (priority.action === LearnerPriorityAction.Review) return `复习${priority.name}`;
  if (priority.action === LearnerPriorityAction.Diagnose) return `校准${priority.name}`;
  return `突破${priority.name}`;
}

export function tutorPriorityLocation(priority: LearnerPriorityResult): RouteLocationRaw {
  if (priority.subject === 'essay') return essayCenterLocation('tutor');
  return practiceDetailLocation({ mode: 'tutor', module: priority.module, capabilityNodeId: priority.capabilityNodeId });
}
