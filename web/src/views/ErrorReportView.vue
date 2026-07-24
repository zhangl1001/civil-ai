<template>
  <div class="error-page app-page">
    <header class="app-page-header">
      <div class="title-row">
        <button class="icon-button" type="button" @click="goBack"><ArrowLeftIcon /></button>
        <div><h3>错因报告</h3><span>按结构化错题聚合</span></div>
        <span class="header-spacer" aria-hidden="true"></span>
      </div>
    </header>

    <PullToRefresh :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载错因报告" />
      <template v-else-if="report">
        <section class="hero app-card">
          <div>
            <strong>{{ report.totalErrors }}</strong>
            <span>开放错题</span>
          </div>
          <p>{{ report.topCategory ? `主导错因：${shortCategory(report.topCategory)}` : '完成练习后生成错因画像' }}</p>
          <div class="metric-row">
            <article><b>{{ report.distribution['概念性错误'] }}</b><em>概念性</em></article>
            <article><b>{{ report.distribution['理解性错误'] }}</b><em>理解性</em></article>
            <article><b>{{ report.distribution['执行性错误'] }}</b><em>执行性</em></article>
          </div>
        </section>

        <section class="panel app-card">
          <div class="section-title"><strong>错因分布</strong></div>
          <div v-for="item in distributionRows" :key="item.key" class="dist-row">
            <span>{{ item.label }}</span>
            <div><i :class="item.tone" :style="{ width: `${item.percent}%` }"></i></div>
            <em>{{ item.count }} · {{ item.percent }}%</em>
          </div>
        </section>

        <section class="panel app-card">
          <div class="section-title"><strong>模块拆解</strong><span>{{ report.modules.length }} 个模块</span></div>
          <div v-if="!report.modules.length" class="inline-empty">暂无错题数据</div>
          <article v-for="module in report.modules" :key="module.name" class="module-card">
            <div class="module-head">
              <TargetIcon />
              <div><strong>{{ module.name }}</strong><span>{{ module.totalErrors }} 次错误</span></div>
            </div>
            <div v-for="point in module.points" :key="`${module.name}-${point.name}`" class="point-row">
              <div><strong>{{ point.name }}</strong><span>{{ shortCategory(point.errorType) }} · {{ point.errorCount }} 次</span></div>
              <meter min="0" max="100" :value="point.proficiency"></meter>
            </div>
          </article>
        </section>

        <section class="panel app-card">
          <div class="section-title"><strong>改进建议</strong></div>
          <p v-for="item in report.recommendations" :key="item" class="advice">{{ item }}</p>
        </section>
      </template>
    </PullToRefresh>

    <footer class="app-page-footer footer-actions">
      <button class="secondary-button" type="button" @click="openWrongBook"><RotateCcwIcon /> 错题重做</button>
      <button class="primary-button" type="button" @click="startPractice"><ZapIcon /> 按首要错因加练</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeftIcon, RotateCcwIcon, TargetIcon, ZapIcon } from 'lucide-vue-next';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { goBackOrHome } from '@/router/navigation';
import { errorReportService, type ErrorCategory, type ErrorReport } from '@/services/ErrorReportService';

const router = useRouter();
const report = ref<ErrorReport | null>(null);
const isLoading = ref(false);

const distributionRows = computed(() => {
  const data = report.value;
  if (!data) return [];
  const total = Math.max(1, data.totalErrors);
  return [
    { key: '概念性错误' as ErrorCategory, label: '概念性', tone: 'red' },
    { key: '理解性错误' as ErrorCategory, label: '理解性', tone: 'orange' },
    { key: '执行性错误' as ErrorCategory, label: '执行性', tone: 'blue' }
  ].map((item) => {
    const count = data.distribution[item.key];
    return { ...item, count, percent: Math.max(count ? 8 : 0, Math.round(count / total * 100)) };
  });
});

onMounted(load);

async function load() {
  isLoading.value = true;
  try {
    report.value = await errorReportService.report();
  } finally {
    isLoading.value = false;
  }
}

function shortCategory(category: ErrorCategory): string {
  return category.replace('错误', '');
}

function startPractice() {
  if (!report.value) return;
  errorReportService.startWeakPractice(report.value);
  router.push('/vue/practice/session');
}

function openWrongBook() {
  router.push('/vue/wrongbook');
}

function goBack() {
  goBackOrHome(router);
}
</script>

<style scoped>
.title-row,.section-title,.dist-row,.module-head,.point-row,.footer-actions{display:flex;align-items:center}
.title-row{justify-content:space-between;gap:10px}
.header-spacer{width:36px;height:36px;flex:0 0 auto}
.title-row>div{text-align:center;min-width:0}
h3{margin:0;font-size: var(--type-size-section-title)}
.title-row span{display:block;margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.icon-button svg{width:18px;height:18px}
.hero{margin:16px;padding:18px;background:linear-gradient(135deg,rgba(239,68,68,.13),rgba(255,255,255,.92))}
.hero strong{display:block;color:#dc2626;font-size: var(--type-size-display-large);line-height:1}
.hero span{display:block;margin-top:4px;color:var(--text-secondary-color);font-size: var(--type-size-caption);font-weight: var(--type-weight-semibold)}
.hero p{margin:10px 0 0;color:var(--text-color);font-size: var(--type-size-body);font-weight: var(--type-weight-semibold)}
.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.metric-row article{padding:10px 4px;border-radius:12px;background:rgba(255,255,255,.72);text-align:center}
.metric-row b,.metric-row em{display:block}.metric-row b{font-size: var(--type-size-page-title)}.metric-row em{margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-style:normal;font-weight: var(--type-weight-semibold)}
.panel{margin:16px;padding:14px}
.section-title{justify-content:space-between;margin-bottom:10px}
.section-title strong{font-size: var(--type-size-body-large)}.section-title span{color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.dist-row{gap:10px;padding:9px 0;border-top:1px solid rgba(var(--color-ink-rgb), .06)}
.dist-row span{width:52px;color:var(--text-secondary-color);font-size: var(--type-size-caption);font-weight: var(--type-weight-semibold)}
.dist-row div{flex:1;height:18px;border-radius:6px;overflow:hidden;background:rgba(var(--color-ink-rgb), .08)}
.dist-row i{display:block;height:100%;border-radius:6px}
.dist-row i.red{background:#ef4444}.dist-row i.orange{background:#f59e0b}.dist-row i.blue{background:var(--color-brand)}
.dist-row em{width:72px;text-align:right;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-style:normal;font-weight: var(--type-weight-semibold)}
.inline-empty{padding:14px;color:var(--text-secondary-color);font-size: var(--type-size-secondary);text-align:center}
.module-card{padding:12px 0;border-top:1px solid rgba(var(--color-ink-rgb), .07)}
.module-head{gap:10px;margin-bottom:8px}
.module-head svg{width:18px;height:18px;color:#dc2626}
.module-head strong,.module-head span{display:block}
.module-head strong{font-size: var(--type-size-body-large)}.module-head span{margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.point-row{justify-content:space-between;gap:12px;padding:9px 0}
.point-row div{min-width:0;flex:1}.point-row strong,.point-row span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.point-row strong{font-size: var(--type-size-secondary)}.point-row span{margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
meter{width:82px;height:8px}
.advice{margin:8px 0 0;color:var(--text-secondary-color);font-size: var(--type-size-secondary);line-height:1.6}
.footer-actions{gap:10px}.footer-actions button{flex:1}.footer-actions svg{width:16px;height:16px}
</style>
