import type { AgentToolExecutionResult } from '@/modules/agent/public';

export function composeGroundedAgentSystem(system: string): string {
  const deviceClock = readDeviceClock().content;
  return [
    system,
    '# 平台当前时间事实',
    '以下内容由设备运行时直接提供，不是会话记忆，也不是模型推测。涉及当前日期、时间、星期或考试倒计时，优先使用它；长任务中需要刷新时，自主调用 system.read_clock。',
    `<system_clock>${deviceClock}</system_clock>`
  ].join('\n\n');
}

export function readDeviceClock(): AgentToolExecutionResult {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value || '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  return {
    content: JSON.stringify({
      today,
      timeZone,
      now: now.toISOString(),
      source: 'device_clock',
      note: '这是设备当前时间；涉及考试倒计时还需结合 tutor.read_daily_context 的 examDate。'
    }),
    madeProgress: true
  };
}
