import {
  asOptionalRecord,
  authoringVisual,
  decodeEmbeddedJson,
  normalizeAuthoringSvg,
  optionalAuthorTextValue
} from './GeneratedContentAuthoringUtils';

export function authoringMaterialGroups(input: unknown): ReadonlyMap<string, Record<string, unknown>> {
  if (!Array.isArray(input)) return new Map();
  const groups = new Map<string, Record<string, unknown>>();
  input.forEach((item) => {
    const group = asOptionalRecord(decodeEmbeddedJson(item));
    if (!group) return;
    const id = optionalAuthorTextValue(group.id);
    const markdown = optionalAuthorTextValue(group.markdown);
    if (!id || !markdown || groups.has(id)) return;
    groups.set(id, authorMaterialDocument(id, markdown, group.table, group.chart, group.visual));
  });
  return groups;
}

function authorMaterialDocument(
  id: string,
  markdown: string,
  tableInput: unknown,
  chartInput: unknown,
  visualInput: unknown
): Record<string, unknown> {
  const table = authoringTable(`${id}:table`, tableInput);
  const chart = authoringChart(`${id}:chart`, chartInput);
  const visual = authoringVisual(visualInput);
  return {
    schemaVersion: 'content.v1',
    blocks: [
      { id: `${id}:text`, type: 'text', source: markdown },
      ...(table ? [table] : []),
      ...(chart ? [chart] : []),
      ...(visual ? [{
        id: `${id}:visual`,
        type: 'svg_diagram',
        markup: normalizeAuthoringSvg(visual.svg, visual.viewBox),
        alt: visual.alt,
        ...(visual.viewBox ? { viewBox: visual.viewBox } : {}),
        fit: 'contain'
      }] : [])
    ]
  };
}

const authoringChartTypes = new Set([
  'bar',
  'horizontal_bar',
  'line',
  'pie',
  'doughnut',
  'stacked_bar',
  'combo',
  'scatter'
]);

function authoringChart(id: string, input: unknown): Record<string, unknown> | undefined {
  const chart = asOptionalRecord(decodeEmbeddedJson(input));
  if (!chart || typeof chart.type !== 'string' || !authoringChartTypes.has(chart.type)) return undefined;
  if (!Array.isArray(chart.categories) || !Array.isArray(chart.series) || !chart.series.length) return undefined;
  const categories = chart.categories.flatMap((item) => (
    typeof item === 'string' && item.trim() ? [item.trim()] : []
  ));
  if (categories.length !== chart.categories.length) return undefined;
  const series: Record<string, unknown>[] = [];
  chart.series.forEach((item, index) => {
    const record = asOptionalRecord(item);
    const label = optionalAuthorTextValue(record?.label);
    if (!record || !label) return;
    if (chart.type === 'scatter') {
      if (!Array.isArray(record.points)) return;
      const points = record.points.flatMap((point) => {
        const value = asOptionalRecord(point);
        return typeof value?.x === 'number' && typeof value.y === 'number'
          ? [{
              x: value.x,
              y: value.y,
              ...(optionalAuthorTextValue(value.label) ? { label: optionalAuthorTextValue(value.label) } : {})
            }]
          : [];
      });
      if (points.length === record.points.length && points.length) {
        series.push({ id: `series_${index + 1}`, label, points });
      }
      return;
    }
    if (!Array.isArray(record.values) || record.values.length !== categories.length || !categories.length) return;
    const values = record.values.filter((value) => value === null || typeof value === 'number');
    if (values.length !== record.values.length) return;
    const renderAs = record.renderAs === 'bar' || record.renderAs === 'line' ? record.renderAs : undefined;
    series.push({
      id: `series_${index + 1}`,
      label,
      values,
      ...(renderAs ? { renderAs } : {})
    });
  });
  if (series.length !== chart.series.length) return undefined;
  return {
    id,
    type: 'statistical_chart',
    chartType: chart.type,
    ...(optionalAuthorTextValue(chart.title) ? { title: optionalAuthorTextValue(chart.title) } : {}),
    ...(optionalAuthorTextValue(chart.unit) ? { unit: optionalAuthorTextValue(chart.unit) } : {}),
    categories,
    series,
    ...(optionalAuthorTextValue(chart.sourceNote) ? { sourceNote: optionalAuthorTextValue(chart.sourceNote) } : {})
  };
}

function authoringTable(id: string, input: unknown): Record<string, unknown> | undefined {
  const table = asOptionalRecord(decodeEmbeddedJson(input));
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return undefined;
  const columns = table.columns.flatMap((item, index) => {
    const column = asOptionalRecord(item);
    const label = optionalAuthorTextValue(column?.label);
    if (!label) return [];
    const alignment = column?.alignment === 'left' || column?.alignment === 'center' || column?.alignment === 'right'
      ? column.alignment
      : index === 0 ? 'left' : 'right';
    const valueType = column?.valueType === 'text' || column?.valueType === 'number' || column?.valueType === 'percent'
      ? column.valueType
      : index === 0 ? 'text' : 'number';
    return [{ key: `column_${index + 1}`, label, alignment, valueType }];
  });
  if (columns.length < 2 || columns.length !== table.columns.length) return undefined;
  const rows = table.rows.flatMap((item) => {
    if (!Array.isArray(item) || item.length !== columns.length) return [];
    const cells = item.map((cell) => (
      cell === null || typeof cell === 'string' || typeof cell === 'number' ? cell : undefined
    ));
    if (cells.some((cell) => cell === undefined)) return [];
    return [Object.fromEntries(columns.map((column, index) => [column.key, cells[index] ?? null]))];
  });
  if (!rows.length) return undefined;
  return {
    id,
    type: 'data_table',
    ...(optionalAuthorTextValue(table.caption) ? { caption: optionalAuthorTextValue(table.caption) } : {}),
    ...(optionalAuthorTextValue(table.unit) ? { unit: optionalAuthorTextValue(table.unit) } : {}),
    columns,
    rows,
    ...(optionalAuthorTextValue(table.sourceNote) ? { sourceNote: optionalAuthorTextValue(table.sourceNote) } : {})
  };
}
