import type { JsonObject } from '@/kernel/public';
import type { CalloutKind, ContentAlignment, ContentBlockType } from '../domain/ContentCodes';

export interface ContentDocument {
  readonly schemaVersion: string;
  readonly blocks: readonly ContentBlock[];
}

export interface ContentBlockBase {
  readonly id: string;
  readonly type: ContentBlockType;
}

export interface TextBlock extends ContentBlockBase {
  readonly type: 'text';
  readonly source: string;
}

export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
  readonly alignment: ContentAlignment;
  readonly valueType: 'text' | 'number' | 'percent';
}

export type DataTableCell = string | number | null;

export interface DataTableBlock extends ContentBlockBase {
  readonly type: 'data_table';
  readonly caption?: string;
  readonly unit?: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly Readonly<Record<string, DataTableCell>>[];
  readonly sourceNote?: string;
}

export type StatisticalChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'stacked_bar'
  | 'combo'
  | 'scatter';

export interface StatisticalChartPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface StatisticalChartSeries {
  readonly id: string;
  readonly label: string;
  readonly values?: readonly (number | null)[];
  readonly points?: readonly StatisticalChartPoint[];
  readonly renderAs?: 'bar' | 'line';
}

export interface StatisticalChartBlock extends ContentBlockBase {
  readonly type: 'statistical_chart';
  readonly chartType: StatisticalChartType;
  readonly title?: string;
  readonly unit?: string;
  readonly categories: readonly string[];
  readonly series: readonly StatisticalChartSeries[];
  readonly sourceNote?: string;
}

export interface SvgDiagramBlock extends ContentBlockBase {
  readonly type: 'svg_diagram';
  readonly markup: string;
  readonly alt: string;
  readonly viewBox?: string;
  readonly fit: 'contain';
}

export interface ImageBlock extends ContentBlockBase {
  readonly type: 'image';
  readonly assetRef: string;
  readonly alt: string;
  readonly caption?: string;
}

export interface FormulaBlock extends ContentBlockBase {
  readonly type: 'formula';
  readonly source: string;
  readonly display: 'inline' | 'block';
}

export interface CalloutBlock extends ContentBlockBase {
  readonly type: 'callout';
  readonly kind: CalloutKind;
  readonly title?: string;
  readonly blocks: readonly ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | DataTableBlock
  | StatisticalChartBlock
  | SvgDiagramBlock
  | ImageBlock
  | FormulaBlock
  | CalloutBlock;

export interface ContentDocumentEnvelope {
  readonly document: ContentDocument;
  readonly extension: JsonObject;
}
