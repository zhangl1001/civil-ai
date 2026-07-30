import { initializeTutorRuntime } from '@/composition-root/public';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';

export interface MonthlyDigestItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  source?: string;
  tags: string[];
}

export interface MonthlyDigestDashboard {
  year: number;
  month: number;
  monthKey: string;
  itemCount: number;
  items: MonthlyDigestItem[];
  categories: Array<{ name: string; count: number; items: MonthlyDigestItem[] }>;
  sourceFiles: string[];
  generatedAt: string;
  reportContent?: string;
  reportAssetId?: string;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function clean(text: string): string {
  return text.replace(/[#>*_`~-]/g, '').replace(/\s+/g, ' ').trim();
}

function inferCategory(text: string): string {
  if (/经济|消费|金融|产业|就业|市场|企业/.test(text)) return '经济';
  if (/科技|人工智能|数据|数字|创新|芯片/.test(text)) return '科技';
  if (/法律|法治|司法|监管|条例/.test(text)) return '法律';
  if (/外交|国际|全球|外贸|一带一路/.test(text)) return '外交';
  if (/文化|教育|文旅|体育|非遗/.test(text)) return '文化';
  if (/民生|社会|基层|治理|养老|医疗/.test(text)) return '社会';
  if (/政治|政策|政府|党建/.test(text)) return '政治';
  return '综合';
}

function contentItems(assetId: string, date: string, content: string): MonthlyDigestItem[] {
  const matches = [...content.matchAll(/^#{2,3}\s+(.+)$(.*?)(?=^#{2,3}\s+|\s*$)/gms)];
  const blocks = matches.length
    ? matches.map((match) => ({ title: clean(match[1]), body: match[2].trim() }))
    : [{ title: '今日热点', body: content.trim() }];
  return blocks.filter((item) => item.title || item.body).map((item, index) => {
    const category = inferCategory(`${item.title} ${item.body}`);
    return {
      id: `${assetId}:${index}`,
      category,
      title: item.title,
      summary: clean(item.body).slice(0, 180),
      date,
      source: '每日热点',
      tags: [category]
    };
  });
}

export class MonthlyDigestService {
  currentMonth(): { year: number; month: number } {
    return currentMonth();
  }

  recentMonths(count = 6): Array<{ year: number; month: number; key: string; label: string }> {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      return { year, month, key: monthKey(year, month), label: `${month}月` };
    });
  }

  async dashboard(year: number, month: number): Promise<MonthlyDigestDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    const key = monthKey(year, month);
    if (!cycle) {
      return {
        year,
        month,
        monthKey: key,
        itemCount: 0,
        items: [],
        categories: [],
        sourceFiles: [],
        generatedAt: new Date().toISOString().slice(0, 10)
      };
    }
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.DigestDaily],
      status: LearningAssetStatus.Ready,
      limit: 500
    });
    const items = assets
      .filter((asset) => asset.payload.tab === 'news' && typeof asset.payload.date === 'string' && asset.payload.date.startsWith(key))
      .flatMap((asset) => contentItems(
        asset.id,
        String(asset.payload.date),
        typeof asset.payload.content === 'string' ? asset.payload.content : ''
      ));
    const report = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.DigestMonthly,
      `digest:monthly:${key}`
    );

    const grouped = new Map<string, MonthlyDigestItem[]>();
    for (const item of items) {
      const bucket = grouped.get(item.category) || [];
      bucket.push(item);
      grouped.set(item.category, bucket);
    }

    const categories = Array.from(grouped.entries())
      .map(([name, categoryItems]) => ({ name, count: categoryItems.length, items: categoryItems }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      year,
      month,
      monthKey: key,
      itemCount: items.length,
      items,
      categories,
      sourceFiles: Array.from(new Set(items.map((item) => `每日热点/${item.date}`))),
      generatedAt: new Date().toISOString().slice(0, 10),
      reportContent: typeof report?.payload.content === 'string' ? report.payload.content : undefined,
      reportAssetId: report?.id
    };
  }

  async enqueueReport(
    year: number,
    month: number,
    idempotencyKey?: string
  ): Promise<AgentTaskEnqueueResult> {
    const dashboard = await this.dashboard(year, month);
    return generationTaskService.enqueue({
      idempotencyKey,
      intent: 'monthlyDigest',
      title: '时政月报',
      detail: `${dashboard.monthKey} · ${dashboard.itemCount} 条热点`,
      module: '时政月报',
      sourceId: `monthly-digest:${dashboard.monthKey}`,
      payload: {
        digestScope: 'monthly',
        year,
        month,
        monthKey: dashboard.monthKey,
        itemCount: dashboard.itemCount
      }
    });
  }
}

export const monthlyDigestService = new MonthlyDigestService();
