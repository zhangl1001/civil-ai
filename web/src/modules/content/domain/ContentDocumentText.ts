import type { ContentBlock, ContentDocument } from '../contracts/ContentDocument';

export function contentDocumentText(document: ContentDocument): string {
  return document.blocks.map((block) => contentBlockText(block)).filter(Boolean).join('\n');
}

export function contentBlockText(block: ContentBlock): string {
  if (block.type === 'text') return block.source;
  if (block.type === 'data_table') {
    const header = block.columns.map((column) => column.label).join(' | ');
    const rows = block.rows.map((row) => (
      block.columns.map((column) => String(row[column.key] ?? '')).join(' | ')
    ));
    return [block.caption ?? '', header, ...rows, block.sourceNote ?? ''].filter(Boolean).join('\n');
  }
  if (block.type === 'statistical_chart') {
    const categories = block.categories.join('、');
    const series = block.series.map((item) => {
      const values = item.values?.map((value) => value ?? '').join('、');
      const points = item.points?.map((point) => `${point.label ?? point.x}: ${point.y}`).join('、');
      return `${item.label}: ${values || points || ''}`;
    });
    return [block.title ?? '', categories, ...series, block.sourceNote ?? ''].filter(Boolean).join('\n');
  }
  if (block.type === 'svg_diagram' || block.type === 'image') return block.alt;
  if (block.type === 'formula') return block.source;
  return [block.title ?? '', ...block.blocks.map((child) => contentBlockText(child))].filter(Boolean).join('\n');
}
