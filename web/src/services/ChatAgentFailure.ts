import { ProviderGatewayError } from '@/capabilities/ai-runtime/public';

/** Where the chat sends people to fix their model settings. */
export const CHAT_MODEL_SETTINGS_ROUTE = '/vue/profile?sheet=ai';

export const ChatFailureCode = {
  NotConfigured: 'provider.not_configured',
  Stopped: 'chat.stopped',
  Interrupted: 'chat.interrupted',
  DatabaseBusy: 'database.busy',
  ContextBudget: 'agent.context_budget_exceeded',
  Unknown: 'agent.execution_failed'
} as const;

export interface ChatFailure {
  /** Stable identity persisted on the run and the message, e.g. `provider.authentication`. */
  readonly code: string;
  /** Chinese explanation shown to the user. */
  readonly message: string;
  /** The fix lives in the AI model settings, so the UI offers a way there. */
  readonly configureModel: boolean;
}

const SETTINGS = '“我的 → AI 模型”';

const FAILURES: Readonly<Record<string, readonly [message: string, configureModel: boolean]>> = {
  [ChatFailureCode.NotConfigured]: [`还没有配置 AI 模型。请先在${SETTINGS}中填写接口地址、模型名称和 API Key。`, true],
  'provider.authentication': [`模型服务鉴权失败：API Key 无效、已过期或无权访问该模型。请在${SETTINGS}中检查密钥和接口地址。`, true],
  'provider.quota_exceeded': ['模型账户余额不足或调用额度已用完。请到模型服务商处充值或提升额度后再试。', true],
  'provider.rate_limited': ['模型服务请求过于频繁，暂时被限流。请稍等片刻再重试。', false],
  'provider.model_not_found': [`找不到当前配置的模型。请在${SETTINGS}中检查模型名称是否正确。`, true],
  'provider.endpoint_not_found': [`模型接口地址不存在。请在${SETTINGS}中检查接口地址（Base URL）和接口协议。`, true],
  'provider.invalid_request': ['当前模型或接口不支持本次请求。请检查模型与接口协议配置，或换用兼容的模型。', true],
  'provider.unsupported_media': ['当前模型不支持图片理解。请换用支持视觉输入的模型后重试。', true],
  'provider.context_too_long': ['本次对话内容超过了模型的上下文长度上限。请新建会话或精简内容后重试。', false],
  'provider.html_response': [`接口地址返回的是网页而不是模型响应。请在${SETTINGS}中检查接口地址（Base URL）。`, true],
  'provider.protocol': ['模型接口返回的内容无法识别。请检查接口地址和接口协议是否匹配。', true],
  'provider.empty_response': ['模型没有返回可显示的内容，请重试。', false],
  'provider.output_limit': ['模型输出已达长度上限，却没有给出正文。请精简问题后重试。', false],
  'provider.thinking_only': ['模型只输出了思考过程，没有给出正文（思考用完了输出长度）。请精简问题后重试；若经常出现，可换用非思考模型或关闭思考模式。', true],
  'provider.stream_interrupted': ['模型回复在传输中途中断，请检查网络后重试。', false],
  'provider.transient': ['模型服务暂时不可用，请稍后重试。', false],
  'provider.overloaded': ['模型服务当前繁忙（过载），请稍后重试。', false],
  'provider.timeout': ['模型长时间没有响应，本次请求已超时。请稍后重试。', false],
  'network.unavailable': ['网络连接失败，请检查网络后重试。', false],
  [ChatFailureCode.DatabaseBusy]: ['本地数据正在忙，请稍后重试。', false],
  [ChatFailureCode.ContextBudget]: ['本次对话内容超过了可处理的上下文长度。请新建会话或精简内容后重试。', false],
  [ChatFailureCode.Stopped]: ['已停止回复。', false],
  [ChatFailureCode.Interrupted]: ['应用切到后台，本次回复已中断。', false],
  [ChatFailureCode.Unknown]: ['AI 回复未能正常完成，请重试。', false]
};

/**
 * Explains why a chat turn failed. The error class, its stable `code`, the
 * provider failure kind and the HTTP status decide; message text is only
 * consulted for errors that carry none of those.
 */
export function describeChatFailure(error: unknown): ChatFailure {
  const code = failureCode(error);
  const failure = chatFailureForCode(code);
  if (error instanceof ProviderGatewayError && (error.status ?? 0) >= 400 && STATUS_DETAIL_CODES.has(code)) {
    return { ...failure, message: withHttpStatus(failure.message, error.status!) };
  }
  if (code === ChatFailureCode.Unknown) {
    const message = errorMessage(error);
    // Our own application errors are written for people; provider prose is not.
    if (/[\u4e00-\u9fff]/.test(message) && message.length <= 160) return { ...failure, message };
  }
  return failure;
}

function withHttpStatus(message: string, status: number): string {
  const clauseEnd = message.search(/[，。]/);
  return clauseEnd < 0
    ? `${message}（HTTP ${status}）`
    : `${message.slice(0, clauseEnd)}（HTTP ${status}）${message.slice(clauseEnd)}`;
}

/** Presentation for a persisted failure code; unknown codes fall back to the generic failure. */
export function chatFailureForCode(code: string, recordedMessage?: string): ChatFailure {
  const [message, configureModel] = FAILURES[code] ?? FAILURES[ChatFailureCode.Unknown];
  return {
    code: FAILURES[code] ? code : ChatFailureCode.Unknown,
    message: recordedMessage?.trim() || message,
    configureModel
  };
}

function failureCode(error: unknown): string {
  if (isAbortError(error)) return ChatFailureCode.Stopped;
  const code = codeOf(error);
  if (code === 'agent_run.lifecycle_suspended') return ChatFailureCode.Interrupted;
  if (error instanceof ProviderGatewayError) {
    if (FAILURES[error.code]) return error.code;
    return FAILURES[`provider.${error.kind}`] ? `provider.${error.kind}` : ChatFailureCode.Unknown;
  }
  if (code && FAILURES[code]) return code;
  if (code?.startsWith('database.')) return ChatFailureCode.DatabaseBusy;
  return codeFromMessage(errorMessage(error));
}

/** Last resort for plain errors from older code paths and native plugins. */
function codeFromMessage(message: string): string {
  if (/context budget|context does not fit|exceeds? (?:the )?(?:model )?context|exceeds budget|上下文.{0,6}(?:超过|超出)/i.test(message)) {
    return ChatFailureCode.ContextBudget;
  }
  if (/sqlite|database|transaction|数据库|事务/i.test(message)) return ChatFailureCode.DatabaseBusy;
  if (/failed to fetch|network|load failed|offline|网络/i.test(message)) return 'network.unavailable';
  if (/timed? ?out|超时/i.test(message)) return 'provider.timeout';
  return ChatFailureCode.Unknown;
}

const STATUS_DETAIL_CODES: ReadonlySet<string> = new Set([
  'provider.transient',
  'provider.invalid_request',
  'provider.endpoint_not_found',
  'provider.protocol'
]);

function isAbortError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { readonly name?: unknown }).name === 'AbortError';
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}
