export function compactGuidanceText(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
}

export function chatErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/not implemented|unimplemented/i.test(message)) return '本地会话组件尚未加载，请重新运行最新版本。';
  if (/network|fetch|连接|网络/i.test(message)) return '模型服务连接失败，请检查网络和 AI 配置。';
  return message.trim() || '操作没有完成，请重试。';
}

export function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function clampChatSheetHeight(value: number): number {
  return Math.max(42, Math.min(92, value));
}
