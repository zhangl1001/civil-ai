import { computed } from 'vue';
import { APTITUDE_PRACTICE_MODULE_OPTIONS } from '@/domain/labels';

interface AbilityRadarSource {
  readonly value: {
    readonly modules: ReadonlyArray<{
      readonly code: string;
      readonly accuracy: number;
      readonly total: number;
    }>;
  } | null;
}

export function useHomeAbilityRadar(quality: AbilityRadarSource) {
  const modules = computed(() => APTITUDE_PRACTICE_MODULE_OPTIONS.map((option) => {
    const module = quality.value?.modules.find((item) => item.code === option.code);
    return { name: option.name, accuracy: module?.accuracy || 0, total: module?.total || 0 };
  }));
  const evidenceCount = computed(() => modules.value.filter((item) => item.total > 0).length);
  const axis = computed(() => modules.value.map((module, index) => {
    const point = radarPoint(index, modules.value.length, 1);
    const label = radarPoint(index, modules.value.length, 1.18);
    return {
      name: module.name,
      shortName: module.name.length > 4 ? module.name.slice(0, 4) : module.name,
      x: point.x,
      y: point.y,
      labelX: label.x,
      labelY: label.y,
      anchor: label.x > 112 ? 'start' : label.x < 88 ? 'end' : 'middle'
    };
  }));
  const points = computed(() => modules.value.map((module, index) => ({
    name: module.name,
    ...radarPoint(index, modules.value.length, module.accuracy / 100)
  })));
  const polygon = computed(() => points.value.map((point) => `${point.x},${point.y}`).join(' '));
  const gridPolygons = computed(() => [0.25, 0.5, 0.75, 1].map((scale) => modules.value.map((_, index) => {
    const point = radarPoint(index, modules.value.length, scale);
    return `${point.x},${point.y}`;
  }).join(' ')));
  return { modules, evidenceCount, axis, points, polygon, gridPolygons };
}

function radarPoint(index: number, total: number, scale: number): { x: number; y: number } {
  if (total <= 0) return { x: 100, y: 100 };
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  const radius = 66 * scale;
  return {
    x: Math.round((100 + Math.cos(angle) * radius) * 10) / 10,
    y: Math.round((100 + Math.sin(angle) * radius) * 10) / 10
  };
}
