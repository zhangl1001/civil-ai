<template>
  <figure class="statistical-chart">
    <figcaption v-if="block.title || block.unit" class="statistical-chart-caption">
      <span>{{ block.title }}</span>
      <small v-if="block.unit">{{ block.unit }}</small>
    </figcaption>
    <div class="statistical-chart-canvas" :class="`statistical-chart-${block.chartType}`">
      <canvas ref="canvasRef" role="img" :aria-label="chartLabel">
        {{ chartLabel }}
      </canvas>
    </div>
    <p v-if="block.sourceNote" class="statistical-chart-source">{{ block.sourceNote }}</p>
  </figure>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  Chart as ChartInstance,
  ChartConfiguration,
  ChartDataset,
  ChartType,
  Point
} from 'chart.js';
import type { StatisticalChartBlock, StatisticalChartSeries } from '@/modules/content/public';

const props = defineProps<{ readonly block: StatisticalChartBlock }>();
const canvasRef = ref<HTMLCanvasElement>();
let chart: ChartInstance | undefined;
let renderSequence = 0;

const chartLabel = computed(() => {
  const title = props.block.title || '统计图';
  return props.block.unit ? `${title}，单位：${props.block.unit}` : title;
});

onMounted(() => { void renderChart(); });
watch(() => props.block, () => { void renderChart(); }, { deep: true });
onBeforeUnmount(() => {
  renderSequence += 1;
  chart?.destroy();
  chart = undefined;
});

async function renderChart(): Promise<void> {
  const sequence = ++renderSequence;
  await nextTick();
  const canvas = canvasRef.value;
  if (!canvas) return;
  const module = await import('chart.js/auto');
  if (sequence !== renderSequence || !canvasRef.value) return;
  chart?.destroy();
  chart = new module.default(canvas, chartConfiguration(props.block, canvas));
}

function chartConfiguration(block: StatisticalChartBlock, canvas: HTMLCanvasElement): ChartConfiguration {
  const palette = chartPalette(canvas);
  const circular = block.chartType === 'pie' || block.chartType === 'doughnut';
  const datasets = block.series.map((series, index) => chartDataset(block, series, index, palette));
  const type = baseChartType(block.chartType);
  return {
    type,
    data: {
      labels: [...block.categories],
      datasets: datasets as ChartConfiguration['data']['datasets']
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 120,
      animation: prefersReducedMotion() ? false : { duration: 260 },
      indexAxis: block.chartType === 'horizontal_bar' ? 'y' : 'x',
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          display: circular || block.series.length > 1,
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12 }
        },
        tooltip: { enabled: true }
      },
      scales: circular ? undefined : {
        x: {
          stacked: block.chartType === 'stacked_bar',
          grid: { display: false },
          ticks: { autoSkip: true, maxTicksLimit: 7, maxRotation: 0, minRotation: 0 }
        },
        y: {
          stacked: block.chartType === 'stacked_bar',
          beginAtZero: block.chartType !== 'scatter',
          title: { display: Boolean(block.unit), text: block.unit },
          grid: { color: palette.grid }
        }
      }
    }
  };
}

function chartDataset(
  block: StatisticalChartBlock,
  series: StatisticalChartSeries,
  index: number,
  palette: ChartPalette
): ChartDataset<ChartType, Array<number | Point | null>> {
  const circular = block.chartType === 'pie' || block.chartType === 'doughnut';
  const type = datasetChartType(block.chartType, series);
  const color = palette.series[index % palette.series.length];
  const data = block.chartType === 'scatter'
    ? (series.points ?? []).map((point) => ({ x: point.x, y: point.y }))
    : [...(series.values ?? [])];
  return {
    type,
    label: series.label,
    data,
    borderColor: circular ? palette.surface : color.solid,
    backgroundColor: circular
      ? block.categories.map((_, categoryIndex) => palette.series[categoryIndex % palette.series.length].fill)
      : color.fill,
    borderWidth: circular ? 2 : type === 'line' ? 2 : 1,
    pointRadius: type === 'line' || type === 'scatter' ? 3 : 0,
    pointHoverRadius: type === 'line' || type === 'scatter' ? 5 : 0,
    tension: type === 'line' ? 0.22 : 0,
    fill: false
  };
}

function baseChartType(chartType: StatisticalChartBlock['chartType']): ChartType {
  if (chartType === 'pie' || chartType === 'doughnut' || chartType === 'line' || chartType === 'scatter') {
    return chartType;
  }
  return 'bar';
}

function datasetChartType(
  chartType: StatisticalChartBlock['chartType'],
  series: StatisticalChartSeries
): ChartType {
  if (chartType === 'combo') return series.renderAs ?? 'bar';
  return baseChartType(chartType);
}

interface PaletteColor {
  readonly solid: string;
  readonly fill: string;
}

interface ChartPalette {
  readonly series: readonly PaletteColor[];
  readonly grid: string;
  readonly surface: string;
}

function chartPalette(canvas: HTMLCanvasElement): ChartPalette {
  const style = getComputedStyle(canvas);
  const colors = [
    cssColor(style, '--primary-color', '#287a68'),
    cssColor(style, '--blue-color', '#2878c8'),
    cssColor(style, '--green-color', '#34a36f'),
    cssColor(style, '--orange-color', '#d88724'),
    cssColor(style, '--red-color', '#cf4c4c'),
    '#7a6fb3'
  ];
  return {
    series: colors.map((color) => ({ solid: color, fill: withAlpha(color, 0.58) })),
    grid: withAlpha(cssColor(style, '--text-secondary-color', '#667085'), 0.15),
    surface: cssColor(style, '--surface-color', '#ffffff')
  };
}

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${alpha})`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i)?.[1]?.split(',').slice(0, 3).map((item) => item.trim());
  return rgb?.length === 3 ? `rgba(${rgb.join(', ')}, ${alpha})` : color;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
</script>

<style scoped>
.statistical-chart { width:100%; max-width:100%; margin:0; min-width:0; }
.statistical-chart-caption { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:7px; color:var(--text-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.statistical-chart-caption small { flex:0 0 auto; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-regular); }
.statistical-chart-canvas { position:relative; width:100%; height:clamp(220px, 58vw, 300px); min-width:0; padding:8px 4px 2px; border-radius:8px; background:rgba(var(--color-ink-rgb),.025); overflow:hidden; }
.statistical-chart-pie,.statistical-chart-doughnut { height:clamp(240px, 66vw, 320px); }
.statistical-chart-source { margin:5px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-micro); }
</style>
