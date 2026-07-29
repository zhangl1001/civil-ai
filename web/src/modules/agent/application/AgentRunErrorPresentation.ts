export function invalidProviderRequestText(diagnostic?: string): string {
  if (diagnostic?.includes('content[].thinking')) {
    return '模型思考模式与连续工具调用不兼容，请更新应用后重新执行';
  }
  if (diagnostic && /context|token|length|too long/i.test(diagnostic)) {
    return '本次任务上下文超过模型限制，请缩小范围后重试';
  }
  if (diagnostic && /tool|function|schema|parameter/i.test(diagnostic)) {
    return '当前模型接口拒绝了工具参数，请检查模型与接口协议配置';
  }
  return '模型接口拒绝了本次请求，请检查模型名称、接口协议和参数配置';
}
