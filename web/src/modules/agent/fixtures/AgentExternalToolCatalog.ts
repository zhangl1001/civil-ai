import type { JsonObject } from '@/kernel/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

const webSearchSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 2, maxLength: 300 },
    purpose: { type: 'string', enum: ['current_affairs', 'true_question', 'exam_syllabus', 'general'] },
    freshness: { type: 'string', enum: ['day', 'week', 'month', 'year', 'any'] },
    limit: { type: 'number', minimum: 1, maximum: 5 }
  }
};

const webReadPageSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 8, maxLength: 2_000 },
    focus: { type: 'string', minLength: 2, maxLength: 160 },
    offset: { type: 'number', minimum: 0, maximum: 160_000 }
  }
};

/**
 * External system capabilities. They read bounded public evidence and do not
 * mutate business data. The Agent decides when they are useful; Skills add
 * domain-specific research guidance without owning the network capability.
 */
export const agentExternalToolCatalog: readonly AgentToolDefinition[] = [
  {
    name: 'web.search',
    description: '检索公开网页，获取需要实时、外部或可核实的事实（例如天气、时政、公告、大纲或真题来源），返回标题、网址和短摘要。',
    inputSchema: webSearchSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'web.read_page',
    description: '读取本轮搜索结果或其公开子链接的正文；长文可用 focus 聚焦章节，或用 offset 分段读取。',
    inputSchema: webReadPageSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }
];
