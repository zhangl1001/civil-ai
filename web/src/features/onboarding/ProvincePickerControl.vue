<template>
  <button
    class="province-select-trigger"
    type="button"
    :disabled="national"
    :aria-label="national ? '国考地区固定为全国' : `当前报考地区：${modelValue}`"
    @click="open = true"
  >
    <MapPinIcon />
    <span>{{ modelValue || '选择省份' }}</span>
    <ChevronDownIcon v-if="!national" />
  </button>

  <OptionPickerSheet
    v-model="open"
    :value="modelValue"
    title="选择报考省份"
    subtitle="用于匹配省考范围、真题和政策信息"
    :options="options"
    @select="$emit('update:modelValue', $event)"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ChevronDownIcon, MapPinIcon } from 'lucide-vue-next';
import OptionPickerSheet from '@/components/layout/OptionPickerSheet.vue';

const props = defineProps<{
  modelValue: string;
  national: boolean;
  options: readonly { readonly value: string; readonly label: string }[];
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();

const open = ref(false);
watch(() => props.national, (national) => {
  if (national) open.value = false;
});
</script>

<style scoped>
.province-select-trigger {
  width: 100%;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-control);
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--surface-control);
  color: var(--text-color);
  font: inherit;
  font-size: var(--type-size-body);
  text-align: left;
}

.province-select-trigger svg {
  width: 17px;
  height: 17px;
  color: var(--primary-color);
}

.province-select-trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.province-select-trigger:disabled {
  grid-template-columns: 18px minmax(0, 1fr);
  opacity: .72;
}
</style>
