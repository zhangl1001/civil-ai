import type { DigestTab } from '@/domain/digest';

export function buildDailyDigestRequest(
  tab: DigestTab,
  detail: string | undefined,
  learningLoad: Record<string, unknown>
): string {
  const base = detail || (tab === 'news' ? '生成今日公考相关时政热点积累' : '生成今日公考知识点积累');
  if (!Object.keys(learningLoad).length) return base;
  return `${base}\n根据学习负载处方自主决定主题数量，建议 ${String(learningLoad.targetThemes ?? '')} 个，允许范围 ${String(learningLoad.minimumThemes ?? '')}-${String(learningLoad.maximumThemes ?? '')} 个；不得为凑数量重复内容。`;
}
