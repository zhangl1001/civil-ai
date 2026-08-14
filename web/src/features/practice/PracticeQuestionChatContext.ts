import { contentDocumentText, correctAnswerLabel, type QuestionContent } from '@/modules/content/public';

export interface PracticeQuestionChatContextInput {
  readonly content: QuestionContent;
  readonly moduleLabel: string;
  readonly capabilityName?: string;
  readonly selectedOptionIds: readonly string[];
  /** Already-resolved wording, so this stays independent of the evidence module. */
  readonly diagnosisText?: string;
}

/**
 * Builds the opening message for "ask AI about this question". It lives outside
 * the page so prompt wording is reviewed as content, not as view markup.
 */
export function practiceQuestionChatContext(input: PracticeQuestionChatContextInput): string {
  const { content } = input;
  const material = content.material ? contentDocumentText(content.material) : '';
  const options = content.options
    .map((option) => `${option.id}. ${contentDocumentText(option.content)}`)
    .join('\n');
  return [
    '我想针对当前题目进行一次深度学习。请把它当作我的个人错题辅导，不要只复述答案。',
    '',
    '## 当前学习上下文',
    `- 模块：${input.moduleLabel}`,
    `- 知识点：${input.capabilityName || '请根据题目识别'}`,
    `- 我的答案：${input.selectedOptionIds.join('') || '未作答'}`,
    `- 正确答案：${correctAnswerLabel(content)}`,
    input.diagnosisText ? `- 已有错因：${input.diagnosisText}` : '- 已有错因：尚未形成',
    material ? `\n### 共用材料\n${material}` : '',
    `\n### 题干\n${contentDocumentText(content.prompt)}`,
    `\n### 选项\n${options}`,
    '',
    '## 辅导要求',
    '1. 先指出本题考查的细分知识点和必要的前置知识。',
    '2. 按步骤还原正确推理链，并逐项比较干扰项。',
    '3. 结合我的答案和错因，指出我的思考在哪一步偏离。',
    '4. 总结一个可迁移的方法和易错提醒。',
    '5. 最后用一个简短追问检查我是否真正理解；不要输出内部思考过程。'
  ].filter(Boolean).join('\n');
}
