import type { EssayQuestionRecord } from '@/services/EssayRepository';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateEssayQuestion(question: EssayQuestionRecord): ValidationResult {
  const issues: string[] = [];
  if (!question.title.trim()) issues.push('申论缺少标题');
  if (!question.material.trim()) issues.push('申论缺少给定资料');
  if (!question.requirement.trim()) issues.push('申论缺少作答要求');
  if (!/字|不超过|左右|不少于/.test(question.requirement)) issues.push('申论作答要求缺少字数约束');
  if (!question.lecture) {
    issues.push('申论缺少讲义');
  } else {
    if (!question.lecture.knowledgePoint?.trim()) issues.push('申论讲义缺少细分知识点');
    if (!question.lecture.title?.trim()) issues.push('申论讲义缺少标题');
    if (!question.lecture.summary?.trim()) issues.push('申论讲义缺少核心导学');
  }
  return { valid: issues.length === 0, issues };
}

export function buildEssayRepairPrompt(rawText: string, issues: string[]): string {
  return [
    '# JSON 修复任务：申论题',
    '',
    '## 发现的问题',
    ...issues.slice(0, 12).map((issue) => `- ${issue}`),
    '',
    '## 修复要求',
    '1. 只输出修复后的 JSON 对象。',
    '2. 必须包含 title、material、requirement 和 lecture。',
    '3. material 提供足以支撑作答的资料，requirement 明确题型、对象、字数和限定。',
    '4. lecture 是围绕细分知识点的学习讲义，不是单题解析；必须包含 knowledgePoint、title、summary、clues、methods、structure、warnings、cases、drills。',
    '5. 重要内容要讲清考点边界、识别方式、作答方法和易错原因；各列表条数、篇幅和组织顺序按教学需要自主决定，可以留空，不得为凑数量重复。',
    '6. 题目、资料和讲义必须围绕同一个细分知识点形成可学习、可训练的闭环。',
    '',
    '## 原始输出',
    rawText
  ].join('\n');
}
