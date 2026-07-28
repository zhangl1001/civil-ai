import type { ModelImageContentPart } from '@/capabilities/ai-runtime/public';

export interface ChatAgentTurnPolicy {
  readonly routingText: string;
  readonly requiredToolCode?: string;
  readonly forceRequiredToolOnFirstTurn?: boolean;
  readonly systemConstraint?: string;
}

const IMPORT_START_MARKER = '【已导入本地文件：';
const IMPORT_INTENT = /(?:导入|录入|上传|扫描|入库|解析).{0,12}(?:真题|题目|试卷|文件|PDF|图片)|(?:PDF|OCR).{0,12}(?:题目|试卷)/i;
const SHORT_CONTINUATION = /^(?:是(?:的|啊)?|确认|好的?|行|可以|继续|开始|执行|导入|重新(?:录入|导入|上传|扫描)|再(?:录入|导入|上传|扫描)|你.{0,8}(?:生|导入|扫描|处理).{0,4}(?:了吗|了没|好了吗)|(?:生|导入|扫描|处理).{0,4}(?:了吗|了没|好了吗))(?:吧|一下)?[？?。！!\s]*$/;

export function planChatAgentTurn(
  currentText: string,
  recentUserTexts: readonly string[],
  attachments: readonly ModelImageContentPart[] = []
): ChatAgentTurnPolicy {
  const current = currentText.trim();
  const previousImport = [...recentUserTexts]
    .reverse()
    .find((text) => text !== current && (text.includes(IMPORT_START_MARKER) || IMPORT_INTENT.test(text)));
  const continuation = Boolean(previousImport && SHORT_CONTINUATION.test(current));
  const routingText = continuation ? `${previousImport}\n${current}` : current;
  if (current.includes(IMPORT_START_MARKER)) {
    return {
      routingText,
      requiredToolCode: 'question_bank.scan',
      systemConstraint: attachments.length
        ? '本轮原图只在当前模型请求中可用。必须在本轮实际调用题库扫描工具生成草稿；不得先用文字要求确认后再扫描。'
        : '本轮导入文件已保存为本地提取文本。先按需读取文件，再实际调用题库扫描工具；扫描草稿生成前不得声称已经开始导入。'
    };
  }
  if (continuation) {
    return {
      routingText,
      requiredToolCode: 'question_bank.resume',
      forceRequiredToolOnFirstTurn: true,
      systemConstraint: '历史轮次的图片附件已经失效。先读取当前会话的导入草稿状态；如果没有草稿，要求用户重新上传原图，不得声称仍在识别或导入。'
    };
  }
  return { routingText };
}
