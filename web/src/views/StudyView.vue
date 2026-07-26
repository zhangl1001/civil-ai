<template>
  <div class="study-page app-page">
    <PageHeader :title="lectureTitle || '考点精讲'" :meta="lectureTitle ? 'AI 私教讲义' : activeModule || '按大纲学习和补弱'">
      <template #actions>
        <HeaderMoreMenu title="精讲设置" subtitle="筛选模块">
          <div class="menu-field">
            <span>模块筛选</span>
            <div class="module-filter-options">
              <button type="button" :class="{ active: activeModule === '' }" @click="activeModule = ''">全部模块</button>
              <button
                v-for="module in dashboard?.modules || []"
                :key="module.name"
                type="button"
                :class="{ active: activeModule === module.name }"
                @click="activeModule = module.name"
              >
                {{ module.name }}
              </button>
            </div>
          </div>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <PullToRefresh class="study-content" :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载考点精讲" />
      <LectureContent v-else-if="lectureContent" :markdown="lectureContent" surface />
      <template v-else-if="dashboard">
        <section class="study-hero app-card">
          <div>
            <span>AI 精讲</span>
            <strong>搜索考点，生成一份可复盘讲义</strong>
          </div>
          <div class="search-row">
            <SearchIcon />
            <input v-model.trim="query" placeholder="搜索考点或输入疑问" @keyup.enter="learnQuery" />
            <button type="button" @click="learnQuery">开始</button>
          </div>
        </section>

        <section class="panel app-card">
          <div class="section-title"><strong>薄弱考点</strong><span>{{ dashboard.weakPoints.length }} 个需加强</span></div>
          <div v-if="!dashboard.weakPoints.length" class="inline-empty">完成练习后自动显示薄弱考点</div>
          <button v-for="(point, index) in dashboard.weakPoints" :key="`${point.module}-${point.name}`" type="button" class="weak-card" @click="learn(point)">
            <i :class="index === 0 ? 'danger' : index < 3 ? 'warn' : 'info'">{{ index + 1 }}</i>
            <div><strong>{{ point.name }}</strong><span>{{ point.module }} · {{ point.reason }}</span></div>
            <em>{{ point.proficiency }}%</em>
          </button>
        </section>

        <section class="panel app-card">
          <div class="section-title"><strong>知识体系</strong><span>{{ visibleModules.length }} 个模块</span></div>
          <article v-for="module in visibleModules" :key="module.name" class="tree-module">
            <button type="button" class="tree-head" @click="toggle(module.name)">
              <BookOpenIcon /><strong>{{ module.name }}</strong><span>{{ module.total }} 个考点</span>
            </button>
            <div v-show="opened.has(module.name)" class="tree-body">
              <div v-for="group in module.groups" :key="group.name" class="tree-group">
                <b>{{ group.name }}</b>
                <div>
                  <button v-for="point in group.points" :key="point.name" type="button" @click="learn(point)">
                    {{ point.name }}<span v-if="point.wrongCount">{{ point.wrongCount }}</span>
                  </button>
                </div>
              </div>
            </div>
          </article>
        </section>
      </template>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpenIcon, SearchIcon } from 'lucide-vue-next';
import { initializeTutorRuntime } from '@/composition-root/public';
import { studyService, type StudyDashboard, type StudyPoint } from '@/services/StudyService';
import { useAIChatStore } from '@/stores/aiChat';
import PageHeader from '@/components/layout/PageHeader.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import LectureContent from '@/components/content/LectureContent.vue';

const chat = useAIChatStore();
const route = useRoute();
const dashboard = ref<StudyDashboard | null>(null);
const isLoading = ref(false);
const query = ref('');
const activeModule = ref('');
const opened = reactive(new Set<string>());
const lectureContent = ref('');
const lectureTitle = ref('');

const visibleModules = computed(() => {
  const modules = dashboard.value?.modules || [];
  return activeModule.value ? modules.filter((module) => module.name === activeModule.value) : modules;
});

onMounted(load);

async function load() {
  isLoading.value = true;
  try {
    const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : '';
    if (assetId) {
      const runtime = await initializeTutorRuntime();
      const asset = await runtime.learningAssetStore.find(assetId);
      lectureContent.value = typeof asset?.payload.content === 'string' ? asset.payload.content : '';
      lectureTitle.value = asset?.title || '';
      if (lectureContent.value) return;
    }
    dashboard.value = await studyService.dashboard();
    if (!opened.size && dashboard.value.modules[0]) opened.add(dashboard.value.modules[0].name);
  } finally {
    isLoading.value = false;
  }
}

function toggle(moduleName: string) {
  if (opened.has(moduleName)) opened.delete(moduleName);
  else opened.add(moduleName);
}

async function learn(point: StudyPoint) {
  await studyService.startLearning(point);
  query.value = point.name;
  await chat.open();
}

async function learnQuery() {
  if (!query.value) return;
  await studyService.startLearning({ module: activeModule.value || undefined, name: query.value });
  await chat.open();
}

</script>

<style scoped>
.study-content { display: flex; flex-direction: column; gap: 14px; }
.study-hero { padding: 14px; display: flex; flex-direction: column; gap: 12px; background: rgba(255,255,255,.78); }
.study-hero > div:first-child { display: flex; flex-direction: column; gap: 4px; }
.study-hero span { color: var(--primary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.study-hero strong { color: var(--text-color); font-size: var(--type-size-section-title); line-height: 1.3; }
.search-row { min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 11px; border-radius: 13px; background: rgba(245,246,250,.9); border: 1px solid rgba(var(--color-ink-rgb), .06); }
.search-row svg { width: 17px; height: 17px; color: var(--text-secondary-color); flex-shrink: 0; }
.search-row input { min-width: 0; flex: 1; height: 40px; border: 0; outline: 0; background: transparent; color: var(--text-color); font: inherit; font-size: var(--type-size-body); }
.search-row button { width: 58px; height: 32px; border: 0; border-radius: 11px; background: var(--primary-color); color: #fff; font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); font-family: inherit; }
.menu-field { display: flex; flex-direction: column; gap: 8px; padding: 11px 12px 12px; border-radius: 12px; background: rgba(var(--color-ink-rgb), .055); }
.menu-field span { color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.module-filter-options { display:flex; flex-wrap:wrap; gap:7px; }
.module-filter-options button { min-height:31px; border:0; border-radius:999px; padding:0 10px; background:rgba(255,255,255,.76); color:var(--text-secondary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.module-filter-options button.active { background:rgba(var(--color-brand-rgb), .12); color:var(--primary-color); }
.empty-state { min-height: 180px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.72); color: var(--text-secondary-color); font-size: var(--type-size-secondary); }
.panel { padding: 14px; }
.section-title,.weak-card,.tree-head { display:flex; align-items:center; }
.section-title { justify-content:space-between; margin-bottom:10px; }
.section-title strong { font-size: var(--type-size-body-large); }
.section-title span { color:var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.inline-empty { padding:14px; text-align:center; color:var(--text-secondary-color); font-size: var(--type-size-secondary); }
.weak-card { width:100%; gap:10px; padding:12px 0; border:0; border-top:1px solid rgba(var(--color-ink-rgb), .07); background:transparent; text-align:left; font-family: inherit; }
.weak-card i { width:30px; height:30px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-style:normal; font-weight: var(--type-weight-semibold); flex-shrink: 0; }
.weak-card i.danger { background:rgba(239,68,68,.12); color:#dc2626; }
.weak-card i.warn { background:rgba(245,158,11,.13); color:#d97706; }
.weak-card i.info { background:rgba(37,99,235,.1); color:var(--color-brand); }
.weak-card div { min-width:0; flex:1; }
.weak-card strong,.weak-card span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.weak-card strong { font-size: var(--type-size-body); }
.weak-card span { margin-top:3px; color:var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.weak-card em { font-size: var(--type-size-caption); font-style:normal; font-weight: var(--type-weight-semibold); color:var(--primary-color); }
.tree-module { border-top:1px solid rgba(var(--color-ink-rgb), .07); }
.tree-head { width:100%; gap:9px; padding:13px 0; border:0; background:transparent; text-align:left; font-family: inherit; }
.tree-head svg { width:17px; height:17px; color:var(--primary-color); flex-shrink: 0; }
.tree-head strong { flex:1; font-size: var(--type-size-body); }
.tree-head span { color:var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.tree-body { padding:0 0 12px; }
.tree-group { margin-top:10px; }
.tree-group b { display:block; margin-bottom:6px; color:var(--text-secondary-color); font-size: var(--type-size-micro); }
.tree-group div { display:flex; flex-wrap:wrap; gap:7px; }
.tree-group button { max-width:100%; min-height:31px; padding:0 10px; border:0; border-radius:9px; background:rgba(var(--color-ink-rgb), .06); color:var(--text-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); font-family: inherit; }
.tree-group span { display:inline-flex; align-items:center; justify-content:center; min-width:15px; height:15px; margin-left:4px; padding:0 4px; border-radius:8px; background:#dc2626; color:#fff; font-size: var(--type-size-micro); }
</style>
