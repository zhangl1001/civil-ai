import { database } from '@/db/database';
import type { DbKeyRange } from '@/db/database';
import { STORES, type DigestItemRecord } from '@/db/schema';
import type { DigestItem, DigestTab } from '@/domain/digest';

const DIR_BY_TAB: Record<DigestTab, string> = {
  news: '每日热点',
  tips: '每日知识点'
};

const CATEGORY_NAMES = ['政治', '经济', '社会', '科技', '文化', '法律', '外交', '综合'];

function compatibilityPath(tab: DigestTab, date: string): string {
  return `${DIR_BY_TAB[tab]}/${date}.md`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCategory(text: string, index: number, tab: DigestTab): string {
  if (tab === 'tips') return '知识点';
  const matched = CATEGORY_NAMES.find((name) => text.includes(name));
  if (matched) return matched;
  if (/经济|消费|金融|产业|就业|市场|企业/.test(text)) return '经济';
  if (/科技|人工智能|数据|数字|创新|芯片/.test(text)) return '科技';
  if (/法律|法治|司法|监管|条例/.test(text)) return '法律';
  if (/外交|国际|全球|外贸|一带一路/.test(text)) return '外交';
  if (/文化|教育|文旅|体育|非遗/.test(text)) return '文化';
  if (/民生|社会|基层|治理|养老|医疗/.test(text)) return '社会';
  return CATEGORY_NAMES[index % CATEGORY_NAMES.length] || '综合';
}

function parseBlocks(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (const raw of lines) {
    const heading = raw.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      if (current) blocks.push(current);
      current = { title: stripMarkdown(heading[1]), body: [] };
    } else if (current) {
      current.body.push(raw);
    }
  }
  if (current) blocks.push(current);

  if (!blocks.length) {
    const parts = markdown.split(/\n(?=\s*[-*]\s+)/).map((part, index) => {
      const [first, ...rest] = part.split(/\r?\n/);
      return { title: stripMarkdown(first || `条目 ${index + 1}`), body: rest };
    });
    blocks.push(...parts.filter((part) => part.title));
  }

  if (!blocks.length && markdown.trim()) {
    blocks.push({ title: '今日内容', body: [markdown] });
  }

  return blocks
    .map((block) => ({ title: block.title, body: block.body.join('\n').trim() }))
    .filter((block) => block.title || block.body);
}

function toRecord(input: {
  projectId: string;
  tab: DigestTab;
  date: string;
  block: { title: string; body: string };
  index: number;
  now: number;
}): DigestItemRecord {
  const text = stripMarkdown(`${input.block.title} ${input.block.body}`);
  const category = inferCategory(text, input.index, input.tab);
  const id = `${input.projectId}:digest:${input.tab}:${input.date}:${input.index}`;
  return {
    id,
    projectId: input.projectId,
    type: input.tab,
    date: input.date,
    category,
    title: input.block.title || `条目 ${input.index + 1}`,
    summary: stripMarkdown(input.block.body).slice(0, 140),
    body: input.block.body,
    tags: [category],
    source: input.tab === 'news' ? '每日热点' : '每日知识点',
    sourceRef: compatibilityPath(input.tab, input.date),
    order: input.index,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function rangeForMonth(projectId: string, tab: DigestTab, year: number, month: number): DbKeyRange {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return {
    lower: [projectId, tab, `${key}-01`],
    upper: [projectId, tab, `${key}-31`]
  };
}

function rangeForTab(projectId: string, tab: DigestTab): DbKeyRange {
  return {
    lower: [projectId, tab, '0000-00-00'],
    upper: [projectId, tab, '9999-99-99']
  };
}

export class DigestRepository {
  compatibilityPath(tab: DigestTab, date: string): string {
    return compatibilityPath(tab, date);
  }

  parseMarkdown(projectId: string, tab: DigestTab, date: string, markdown: string): DigestItem[] {
    const now = Date.now();
    return parseBlocks(markdown).map((block, index) => toRecord({ projectId, tab, date, block, index, now }));
  }

  async saveFromMarkdown(projectId: string, tab: DigestTab, date: string, markdown: string): Promise<DigestItem[]> {
    const records = this.parseMarkdown(projectId, tab, date, markdown);
    await database.putMany<DigestItemRecord>(STORES.digestItems, records);
    return records;
  }

  async listForDate(projectId: string, tab: DigestTab, date: string): Promise<DigestItem[]> {
    const items = await database.queryByIndex<DigestItemRecord>(STORES.digestItems, 'projectTypeDate', [projectId, tab, date]);
    return items.sort((a, b) => a.order - b.order);
  }

  async listForMonth(projectId: string, tab: DigestTab, year: number, month: number): Promise<DigestItem[]> {
    const items = await database.queryByIndex<DigestItemRecord>(STORES.digestItems, 'projectTypeDate', rangeForMonth(projectId, tab, year, month));
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  }

  async history(projectId: string, tab: DigestTab, limit = 20): Promise<Array<{ date: string; tab: DigestTab; path: string; updatedAt: number }>> {
    const items = await database.queryByIndex<DigestItemRecord>(STORES.digestItems, 'projectTypeDate', rangeForTab(projectId, tab));
    const byDate = new Map<string, number>();
    items.forEach((item) => byDate.set(item.date, Math.max(byDate.get(item.date) || 0, item.updatedAt)));
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, limit)
      .map(([date, updatedAt]) => ({ date, tab, path: compatibilityPath(tab, date), updatedAt }));
  }

  async deleteDate(projectId: string, tab: DigestTab, date: string): Promise<void> {
    const items = await database.queryByIndex<DigestItemRecord>(STORES.digestItems, 'projectTypeDate', [projectId, tab, date]);
    await Promise.all(items.map((item) => database.delete(STORES.digestItems, item.id)));
  }

  async importCompatibilityDate(_projectId: string, _tab: DigestTab, _date: string): Promise<DigestItem[]> {
    return [];
  }
}

export const digestRepository = new DigestRepository();
