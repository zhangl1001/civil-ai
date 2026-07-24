import type { DigestItem } from '@/domain/digest';
import { generationTaskService } from './GenerationTaskService';
import { digestRepository } from './DigestRepository';
import { projectRepository } from './ProjectRepository';
import { practiceFlowService } from './PracticeFlowService';
import type { EnqueueResult } from '@/tasks/taskTypes';

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
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function toMonthlyItem(item: DigestItem): MonthlyDigestItem {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    summary: item.summary,
    date: item.date,
    source: item.source,
    tags: item.tags
  };
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
    const project = await projectRepository.getActiveProject();
    const key = monthKey(year, month);
    const items = (await digestRepository.listForMonth(project.id, 'news', year, month)).map(toMonthlyItem);

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
      sourceFiles: Array.from(new Set(items.map((item) => `每日热点/${item.date}.md`))),
      generatedAt: new Date().toISOString().slice(0, 10)
    };
  }

  startPractice(): void {
    practiceFlowService.writeStartContext({
      module: '常识判断',
      knowledgePoint: '时政热点',
      date: new Date().toISOString().slice(0, 10),
      mode: 'practice',
      source: 'practice-center',
      questionCount: 10
    });
  }

  async enqueueReport(year: number, month: number): Promise<EnqueueResult> {
    const dashboard = await this.dashboard(year, month);
    return generationTaskService.enqueue({
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
