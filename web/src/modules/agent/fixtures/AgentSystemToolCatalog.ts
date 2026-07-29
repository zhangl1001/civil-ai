import type { JsonObject } from '@/kernel/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

const emptyObjectSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {}
};

/** Platform facts only. Business state belongs to tutorToolCatalog. */
export const agentSystemToolCatalog: readonly AgentToolDefinition[] = [
  {
    name: 'system.read_clock',
    description: '读取设备当前本地日期、时间、时区和日历日。涉及“今天、明天、剩余几天、截止日期或按时间调整计划”时按需调用，不使用会话记忆猜测当前日期。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  }
];
