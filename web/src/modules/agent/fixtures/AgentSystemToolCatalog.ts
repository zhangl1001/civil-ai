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
    description: '读取设备当前本地日期、时间、时区和日历日。涉及当前日期或时间时优先使用工具结果；长任务中如果时间事实可能已过期，可以再次调用刷新。不要用会话记忆或模型猜测替代设备时间。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  }
];
