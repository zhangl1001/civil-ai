<template>
  <div class="knowledge-page app-page">
    <header class="app-page-header">
      <div class="title-row">
        <button class="icon-button" type="button" @click="goBack"><ArrowLeftIcon /></button>
        <div><h3>知识地图</h3><span>按大纲定位薄弱考点</span></div>
        <span class="header-spacer" aria-hidden="true"></span>
      </div>
    </header>

    <PullToRefresh :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载知识地图" />
      <template v-else-if="dashboard">
        <section class="hero app-card">
          <div><MapIcon /><strong>知识地图</strong></div>
          <p>按模块、考点和掌握度定位训练优先级</p>
          <div class="metric-row">
            <span><b>{{ dashboard.totalPoints }}</b><em>考点</em></span>
            <span><b>{{ dashboard.weakPoints }}</b><em>薄弱</em></span>
            <span><b>{{ dashboard.masteredPoints }}</b><em>掌握</em></span>
          </div>
        </section>

        <div class="actions">
          <button class="primary-button" type="button" @click="startWeakest"><TargetIcon /> 训练最弱考点</button>
        </div>

        <section class="module-list">
          <article v-for="module in dashboard.modules" :key="module.name" class="module-card app-card">
            <button type="button" class="module-head" @click="toggleModule(module.name)">
              <ChevronRightIcon :class="{ open: openedModules.includes(module.name) }" />
              <strong>{{ module.name }}</strong>
              <span>{{ module.mastered }}/{{ module.points.length }}</span>
              <div><i :style="{ width: `${module.accuracy}%` }"></i></div>
              <em>{{ module.accuracy }}%</em>
            </button>
            <div v-if="openedModules.includes(module.name)" class="point-list">
              <button v-for="point in module.points" :key="point.id" type="button" class="point-row" @click="selectedPoint = point">
                <i :class="statusClass(point.status)"></i>
                <span>{{ point.name }}</span>
                <small>{{ point.group }}</small>
                <em>{{ point.proficiency }}%</em>
              </button>
            </div>
          </article>
        </section>
      </template>
    </PullToRefresh>

    <div v-if="selectedPoint" class="detail-overlay" @click.self="selectedPoint = null">
      <section class="detail-card app-card">
        <h4>{{ selectedPoint.name }}</h4>
        <span>{{ selectedPoint.module }} · {{ selectedPoint.group }}</span>
        <div class="detail-stats">
          <p><b>{{ selectedPoint.total }}</b><em>题数</em></p>
          <p><b>{{ selectedPoint.accuracy }}%</b><em>正确率</em></p>
          <p><b>{{ selectedPoint.wrongCount }}</b><em>错题</em></p>
        </div>
        <button class="primary-button" type="button" @click="startPoint(selectedPoint)"><TargetIcon /> 练这个考点</button>
        <button class="secondary-button" type="button" @click="selectedPoint = null">关闭</button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeftIcon, ChevronRightIcon, MapIcon, TargetIcon } from 'lucide-vue-next';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { goBackOrHome } from '@/router/navigation';
import { knowledgeGraphService, type KnowledgeGraphDashboard, type KnowledgePointNode } from '@/services/KnowledgeGraphService';

const router = useRouter();
const dashboard = ref<KnowledgeGraphDashboard | null>(null);
const isLoading = ref(false);
const openedModules = ref<string[]>([]);
const selectedPoint = ref<KnowledgePointNode | null>(null);

onMounted(load);

async function load() {
  isLoading.value = true;
  try {
    dashboard.value = await knowledgeGraphService.dashboard();
    openedModules.value = dashboard.value.modules.slice(0, 2).map((module) => module.name);
  } finally {
    isLoading.value = false;
  }
}

function toggleModule(name: string) {
  openedModules.value = openedModules.value.includes(name)
    ? openedModules.value.filter((item) => item !== name)
    : [...openedModules.value, name];
}

function startWeakest() {
  const point = dashboard.value?.weakest;
  router.push({
    path: '/vue/practice/session',
    query: { mode: 'self', capabilityNodeId: point?.id || '' }
  });
}

function startPoint(point: KnowledgePointNode) {
  selectedPoint.value = null;
  router.push({
    path: '/vue/practice/session',
    query: { mode: 'self', capabilityNodeId: point.id }
  });
}

function goBack() {
  goBackOrHome(router);
}

function statusClass(status: KnowledgePointNode['status']): string {
  return status === '已掌握' ? 'mastered' : status === '薄弱' ? 'weak' : status === '学习中' ? 'learning' : 'new';
}
</script>

<style scoped>
.title-row,.hero>div,.metric-row,.module-head,.point-row{display:flex;align-items:center}
.title-row{justify-content:space-between;gap:10px}
.header-spacer{width:36px;height:36px;flex:0 0 auto}
.title-row>div{text-align:center;min-width:0}
h3{margin:0;font-size: var(--type-size-section-title)}
.title-row span{display:block;margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.icon-button svg{width:18px;height:18px}
.hero{margin:0 0 16px;padding:18px}
.hero>div{gap:8px}.hero svg{width:22px;height:22px;color:#2e7d32}.hero strong{font-size: var(--type-size-section-title)}
.hero p{margin:6px 0 12px;color:var(--text-secondary-color);font-size: var(--type-size-caption)}
.metric-row{gap:8px}.metric-row span{flex:1;border-radius:12px;padding:9px 6px;background:rgba(var(--color-ink-rgb), .04);text-align:center}.metric-row b,.metric-row em{display:block}.metric-row b{font-size: var(--type-size-section-title)}.metric-row em{margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-style:normal;font-weight: var(--type-weight-semibold)}
.actions{margin:0 0 16px}.actions .primary-button{width:100%}.actions svg{width:16px;height:16px}
.module-list{margin:0 0 24px}
.module-card{margin-bottom:12px;overflow:hidden}
.module-head{width:100%;min-height:64px;gap:10px;border:none;background:transparent;padding:12px 14px;color:var(--text-color);font:inherit;text-align:left}
.module-head>svg{width:16px;height:16px;color:var(--text-secondary-color);transition:transform .2s}.module-head>svg.open{transform:rotate(90deg)}
.module-head strong{flex:1;font-size: var(--type-size-body)}.module-head span{height:22px;border-radius:11px;padding:0 8px;display:inline-flex;align-items:center;background:rgba(46,125,50,.1);color:#2e7d32;font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.module-head div{width:72px;height:7px;border-radius:4px;overflow:hidden;background:rgba(var(--color-ink-rgb), .08)}.module-head i{display:block;height:100%;background:#2e7d32}.module-head em{width:40px;text-align:right;color:#2e7d32;font-size: var(--type-size-caption);font-style:normal;font-weight: var(--type-weight-semibold)}
.point-list{padding:0 14px 12px}
.point-row{width:100%;min-height:48px;gap:10px;padding:6px 0;border:none;border-top:1px solid rgba(var(--color-ink-rgb), .06);background:transparent;color:var(--text-color);font:inherit;text-align:left}
.point-row>i{width:8px;height:8px;border-radius:50%;flex-shrink:0}.point-row>i.mastered{background:#2e7d32}.point-row>i.learning{background:#ef6c00}.point-row>i.weak{background:#d93025}.point-row>i.new{background:rgba(var(--color-ink-rgb), .22)}
.point-row span{flex:1;font-size: var(--type-size-secondary)}.point-row small{max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary-color);font-size: var(--type-size-micro)}.point-row em{width:38px;text-align:right;color:var(--text-secondary-color);font-style:normal;font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.detail-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.42)}
.detail-card{width:100%;max-width:340px;padding:18px}.detail-card h4{margin:0;font-size: var(--type-size-section-title)}.detail-card>span{display:block;margin-top:3px;color:var(--text-secondary-color);font-size: var(--type-size-caption)}
.detail-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.detail-stats p{margin:0;border-radius:12px;padding:10px 4px;background:rgba(var(--color-ink-rgb), .04);text-align:center}.detail-stats b,.detail-stats em{display:block}.detail-stats b{font-size: var(--type-size-section-title)}.detail-stats em{color:var(--text-secondary-color);font-size: var(--type-size-micro);font-style:normal;font-weight: var(--type-weight-semibold)}
.detail-card .primary-button,.detail-card .secondary-button{width:100%;margin-top:8px}.secondary-button{height:42px;border:none;border-radius:12px;background:rgba(var(--color-ink-rgb), .07);color:var(--text-secondary-color);font-size: var(--type-size-body);font-weight: var(--type-weight-semibold)}
</style>
