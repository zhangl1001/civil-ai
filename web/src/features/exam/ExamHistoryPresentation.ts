export interface ExamHistoryGroup<Item> {
  readonly month: string;
  readonly label: string;
  readonly items: readonly Item[];
}

export function durationText(durationMs?: number): string {
  return durationMs ? `${Math.max(1, Math.round(durationMs / 60000))} 分钟` : '未记录时长';
}

export function groupHistoryByMonth<Item extends { readonly date: string }>(items: readonly Item[]): ExamHistoryGroup<Item>[] {
  const grouped = new Map<string, Item[]>();
  items.forEach((item) => {
    const month = /^\d{4}-\d{2}/.test(item.date) ? item.date.slice(0, 7) : 'unknown';
    grouped.set(month, [...(grouped.get(month) || []), item]);
  });
  return Array.from(grouped.entries()).map(([month, groupItems]) => ({
    month,
    label: month === 'unknown' ? '未记录月份' : `${month.slice(0, 4)}年${Number(month.slice(5))}月`,
    items: groupItems
  }));
}
