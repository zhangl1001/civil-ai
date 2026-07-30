const CONFIRM_REPLIES = new Set([
  '确认', '确定', '开始', '执行', '可以', '好', '好的', '行', '嗯', '是', 'yes', 'ok'
]);
const CANCEL_REPLIES = new Set(['取消', '算了', '不要', '停止', '不执行', '否', 'no']);

export function isAgentConfirmation(text: string): boolean {
  return CONFIRM_REPLIES.has(text.trim().toLocaleLowerCase());
}

export function isAgentCancellation(text: string): boolean {
  return CANCEL_REPLIES.has(text.trim().toLocaleLowerCase());
}
