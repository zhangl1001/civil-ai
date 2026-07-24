<template>
  <div class="calendar-page app-page">
    <PageHeader title="练习日历" :meta="headerMeta" />

    <PullToRefresh class="calendar-content" :on-refresh="store.loadMonth">
      <section class="month-card app-card">
        <div class="month-nav">
          <button class="icon-button" type="button" @click="store.changeMonth(-1)"><ChevronLeftIcon /></button>
          <strong>{{ store.year }}年{{ store.month }}月</strong>
          <button class="icon-button" type="button" @click="store.changeMonth(1)"><ChevronRightIcon /></button>
        </div>
        <div class="weekdays">
          <span v-for="day in weekdays" :key="day">{{ day }}</span>
        </div>
        <div class="calendar-grid">
          <span v-for="n in leadingEmpty" :key="`e-${n}`"></span>
          <button
            v-for="cell in store.monthData?.cells || []"
            :key="cell.date"
            :class="['day-cell', { today: cell.isToday, selected: cell.date === store.selectedDate, active: cell.hasPractice || cell.hasEssay || cell.hasMock }]"
            type="button"
            @click="store.selectDate(cell.date)"
          >
            <strong>{{ cell.day }}</strong>
            <span class="badges">
              <em v-if="cell.hasMock" class="mock">模</em>
              <em v-if="cell.hasPractice" class="practice">测</em>
              <em v-if="cell.hasEssay" class="essay">申</em>
            </span>
            <small>{{ cell.accuracy !== null ? `${cell.accuracy}%` : cell.total ? '待批' : '-' }}</small>
          </button>
        </div>
      </section>

      <section class="detail-card app-card">
        <AppStateView v-if="store.isLoading" compact state="loading" title="加载练习记录" />
        <template v-else-if="store.dayDetail?.hasActivity">
          <div class="detail-head">
            <div>
              <strong>{{ store.dayDetail.date }}</strong>
              <span v-if="store.dayDetail.isToday">今天</span>
            </div>
            <em v-if="store.dayDetail.accuracy !== null">{{ store.dayDetail.accuracy }}%</em>
          </div>
          <article v-for="task in store.dayDetail.tasks" :key="task.id" class="day-task">
            <span :class="['task-dot', task.type]"></span>
            <div>
              <strong>{{ task.title }}</strong>
              <small>{{ task.questionCount ? `${task.questionCount}题` : '记录完成' }}<template v-if="task.accuracy !== undefined"> · 正确率 {{ task.accuracy }}%</template></small>
            </div>
            <button v-if="task.type === 'practice' && task.module" type="button" @click="openPractice(task.module)">
              查看
            </button>
          </article>
          <div v-if="store.dayDetail.weakModules.length" class="weak-tip">
            重点关注：{{ store.dayDetail.weakModules.map(item => `${item.module}(${item.accuracy}%)`).join('、') }}
          </div>
        </template>
        <AppStateView
          v-else
          compact
          :title="store.dayDetail?.isToday ? '今天还没有练习' : `${store.selectedDate} 无练习记录`"
          :description="store.dayDetail?.isToday ? '去刷题中心完成一组练习，日历会自动记录。' : ''"
        />
      </section>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { useCalendarStore } from '@/stores/calendar';
import { practiceFlowService } from '@/services/PracticeFlowService';

const store = useCalendarStore();
const router = useRouter();
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

const leadingEmpty = computed(() => {
  const first = new Date(store.year, store.month - 1, 1).getDay();
  return first === 0 ? 6 : first - 1;
});
const headerMeta = computed(() => {
  const data = store.monthData;
  if (!data) return '';
  const score = data.averageAccuracy !== null ? ` · 均分 ${data.averageAccuracy}` : '';
  return `连续 ${data.streak} 天 · 本月练了 ${data.activeDays} 天${score}`;
});

onMounted(() => {
  void store.loadMonth();
});

function openPractice(module: string) {
  practiceFlowService.writeStartContext({
    module,
    date: store.selectedDate,
    mode: 'practice',
    source: 'calendar',
    questionCount: 10
  });
  void router.push('/vue/practice/session');
}
</script>

<style scoped>
.calendar-content { display: flex; flex-direction: column; gap: 14px; }
.month-card { padding: 12px; }
.month-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.month-nav strong { font-size: var(--type-size-body-large); }
.weekdays, .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
.weekdays { margin-bottom: 4px; color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); text-align: center; }
.day-cell { min-width: 0; min-height: 54px; padding: 5px 4px; border: 1.5px solid transparent; border-radius: 9px; display: flex; flex-direction: column; gap: 2px; background: rgba(255,255,255,.72); color: var(--text-color); text-align: left; }
.day-cell.today { border-color: var(--primary-color); }
.day-cell.selected { background: rgba(var(--color-brand-rgb), .1); border-color: var(--primary-color); }
.day-cell strong { font-size: var(--type-size-caption); }
.badges { display: flex; gap: 2px; min-height: 14px; }
.badges em { padding: 1px 4px; border-radius: 4px; font-size: var(--type-size-micro); font-style: normal; font-weight: var(--type-weight-semibold); }
.badges .mock { color: var(--red-color); background: rgba(255,59,48,.12); }
.badges .practice { color: var(--primary-color); background: rgba(var(--color-brand-rgb), .12); }
.badges .essay { color: var(--green-color); background: rgba(52,199,89,.12); }
.day-cell small { margin-top: auto; color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); text-align: center; }
.detail-card { padding: 14px; }
.detail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.detail-head strong { font-size: var(--type-size-body-large); }
.detail-head span { margin-left: 8px; padding: 2px 7px; border-radius: 99px; background: var(--primary-color); color: #fff; font-size: var(--type-size-micro); }
.detail-head em { color: var(--primary-color); font-size: var(--type-size-display); font-style: normal; font-weight: var(--type-weight-semibold); }
.day-task { display: flex; align-items: center; gap: 9px; min-height: 46px; padding: 8px 0; border-top: 1px solid rgba(var(--color-ink-rgb), .06); }
.day-task:first-of-type { border-top: none; }
.task-dot { width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; background: var(--primary-color); }
.task-dot.essay { background: var(--green-color); }
.task-dot.mock { background: var(--red-color); }
.task-dot.digest { background: var(--orange-color); }
.day-task div { flex: 1; min-width: 0; }
.day-task strong { display: block; font-size: var(--type-size-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-task small { color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.day-task button { border: 1px solid rgba(var(--color-ink-rgb), .08); border-radius: 8px; background: rgba(255,255,255,.72); color: var(--primary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.weak-tip { margin-top: 8px; padding: 9px 10px; border-left: 3px solid var(--orange-color); border-radius: 8px; background: rgba(255,149,0,.08); color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.5; }
.empty { padding: 10px 0; color: var(--text-secondary-color); font-size: var(--type-size-secondary); text-align: center; }
</style>
