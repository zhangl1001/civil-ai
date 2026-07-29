import type { AgentToolExecutionResult } from '@/modules/agent/public';

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
