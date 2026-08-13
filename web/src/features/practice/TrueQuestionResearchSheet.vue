<template>
  <BottomSheet
    :model-value="modelValue"
    title="AI 联网找题"
    subtitle="确认范围后创建独立研究任务"
    variant="form"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="research-form">
      <fieldset>
        <legend>考试类型</legend>
        <div class="choice-row">
          <button type="button" :class="{ active: form.examType === TrueQuestionResearchExamType.National }" @click="selectExamType(TrueQuestionResearchExamType.National)">国家公务员考试</button>
          <button type="button" :class="{ active: form.examType === TrueQuestionResearchExamType.Provincial }" @click="selectExamType(TrueQuestionResearchExamType.Provincial)">省级公务员考试</button>
        </div>
      </fieldset>

      <fieldset v-if="form.examType === TrueQuestionResearchExamType.Provincial">
        <legend>地区</legend>
        <div class="province-list">
          <button v-for="province in PROVINCE_OPTIONS" :key="province" type="button" :class="{ active: form.province === province }" @click="form.province = province">{{ province }}</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>年份范围</legend>
        <div class="choice-row">
          <button type="button" :class="{ active: form.yearRange === TrueQuestionResearchYearRange.RecentThreeYears }" @click="form.yearRange = TrueQuestionResearchYearRange.RecentThreeYears">最近三年</button>
          <button type="button" :class="{ active: form.yearRange === TrueQuestionResearchYearRange.RecentFiveYears }" @click="form.yearRange = TrueQuestionResearchYearRange.RecentFiveYears">最近五年</button>
          <button type="button" :class="{ active: form.yearRange === TrueQuestionResearchYearRange.AnyYear }" @click="form.yearRange = TrueQuestionResearchYearRange.AnyYear">不限年份</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>行测模块</legend>
        <div class="choice-row">
          <button type="button" :class="{ active: !form.module }" @click="form.module = ''">全部模块</button>
          <button v-for="item in moduleOptions" :key="item.code" type="button" :class="{ active: form.module === item.code }" @click="form.module = item.code">{{ item.name }}</button>
        </div>
      </fieldset>

      <label class="keyword-field">
        <span>试卷或考点</span>
        <input v-model.trim="form.keyword" type="text" maxlength="60" placeholder="可选，例如：A类、削弱论证" />
      </label>

      <fieldset>
        <legend>来源偏好</legend>
        <div class="choice-row">
          <button type="button" :class="{ active: form.sourcePreference === TrueQuestionResearchSourcePreference.OfficialFirst }" @click="form.sourcePreference = TrueQuestionResearchSourcePreference.OfficialFirst">官方来源优先</button>
          <button type="button" :class="{ active: form.sourcePreference === TrueQuestionResearchSourcePreference.VerifiablePublic }" @click="form.sourcePreference = TrueQuestionResearchSourcePreference.VerifiablePublic">可核验公开来源</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>本轮题量</legend>
        <div class="choice-row">
          <button v-for="count in [3, 5, 8, 10]" :key="count" type="button" :class="{ active: form.maxQuestions === count }" @click="form.maxQuestions = count">{{ count }}题</button>
        </div>
      </fieldset>

      <button type="button" class="submit-button" @click="submit">
        <SearchIcon />创建联网研究任务
      </button>
      <p>搜索结果只会形成待确认草稿，不会直接写入正式题库。</p>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { SearchIcon } from 'lucide-vue-next';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import { curriculumModuleOptions, PROVINCE_OPTIONS } from '@/domain/labels';
import {
  TrueQuestionResearchExamType,
  TrueQuestionResearchSourcePreference,
  TrueQuestionResearchYearRange,
  defaultTrueQuestionResearchCriteria,
  type TrueQuestionResearchCriteria
} from './TrueQuestionResearchCriteria';

const props = defineProps<{
  modelValue: boolean;
  examName?: string;
  province?: string;
  module?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [criteria: TrueQuestionResearchCriteria];
}>();

const moduleOptions = curriculumModuleOptions();
const form = reactive<TrueQuestionResearchCriteria>(defaultTrueQuestionResearchCriteria(props));

watch(() => props.modelValue, (visible) => {
  if (!visible) return;
  Object.assign(form, defaultTrueQuestionResearchCriteria(props));
});

function selectExamType(examType: TrueQuestionResearchCriteria['examType']) {
  form.examType = examType;
  if (examType === TrueQuestionResearchExamType.National) form.province = '全国';
  else if (form.province === '全国') form.province = props.province && props.province !== '全国' ? props.province : '江苏';
}

function submit() {
  emit('submit', { ...form });
}
</script>

<style scoped>
.research-form { display:flex; flex-direction:column; gap:15px; }
fieldset { min-width:0; margin:0; border:0; padding:0; }
legend,.keyword-field>span { margin-bottom:8px; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.choice-row,.province-list { display:flex; flex-wrap:wrap; gap:7px; }
.province-list { max-height:128px; overflow-y:auto; overscroll-behavior:contain; padding-right:2px; }
.choice-row button,.province-list button { min-height:34px; border:0; border-radius:999px; padding:0 11px; color:var(--text-secondary-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-caption); }
.choice-row button.active,.province-list button.active { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.13); font-weight:var(--type-weight-semibold); }
.keyword-field { display:flex; flex-direction:column; }
.keyword-field input { width:100%; min-height:42px; box-sizing:border-box; border:0; border-radius:12px; padding:0 12px; color:var(--text-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-body); outline:none; }
.keyword-field input:focus { box-shadow:0 0 0 2px rgba(var(--color-brand-rgb),.14); }
.submit-button { min-height:44px; border:0; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:7px; color:#fff; background:var(--primary-color); font:inherit; font-weight:var(--type-weight-semibold); }
.submit-button svg { width:17px; height:17px; }
p { margin:0; color:var(--text-secondary-color); font-size:var(--type-size-micro); line-height:1.5; text-align:center; }
</style>
