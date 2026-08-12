<template>
  <section class="home-action-section">
    <div class="home-action-heading">
      <strong>功能入口</strong>
      <span>学习、练习、模考与面试</span>
    </div>
    <div class="home-action-grid">
      <button v-for="action in actions" :key="action.name" type="button" class="home-action-card" @click="router.push(action.to)">
        <i :class="action.color"><component :is="action.icon" /></i>
        <strong>{{ action.name }}</strong>
        <span>{{ action.sub }}</span>
        <span v-if="action.tags.length" class="home-action-tags">
          <em v-for="tag in action.tags" :key="tag">{{ tag }}</em>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { BookOpenIcon, FilePenLineIcon, MicIcon, MonitorIcon } from 'lucide-vue-next';

const router = useRouter();
const actions = [
  { name: '学习中心', sub: '知识学习与每日积累', tags: [], icon: BookOpenIcon, color: 'study', to: '/vue/study' },
  { name: '刷题中心', sub: '私教、自主与真题练习', tags: ['行测', '申论'], icon: FilePenLineIcon, color: 'practice', to: '/vue/practice' },
  { name: '阶段模考', sub: '整卷训练与阶段校准', tags: [], icon: MonitorIcon, color: 'mock', to: '/vue/exam' },
  { name: '面试训练', sub: '模拟作答与深度复盘', tags: [], icon: MicIcon, color: 'interview', to: '/vue/interview' }
];
</script>

<style scoped>
.home-action-section { display:flex; flex-direction:column; gap:14px; }
.home-action-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.home-action-heading strong { font-size:var(--type-size-body-large); }
.home-action-heading span { color:var(--text-secondary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.home-action-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.home-action-card { position:relative; min-height:104px; border:0; border-radius:var(--radius-card); padding:13px; display:flex; flex-direction:column; gap:7px; color:inherit; background:var(--surface-card); box-shadow:var(--app-shadow-soft); font:inherit; text-align:left; }
.home-action-card i { width:34px; height:34px; border-radius:12px; display:grid; place-items:center; }
.home-action-card svg { width:18px; height:18px; }
.home-action-card strong { font-size:var(--type-size-body); }
.home-action-card > span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }
.home-action-card .home-action-tags { position:absolute; top:13px; right:13px; display:inline-flex; align-items:center; gap:4px; }
.home-action-tags em { border-radius:var(--radius-pill); padding:2px 6px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.09); font-size:var(--type-size-micro); font-style:normal; font-weight:var(--type-weight-semibold); }
.home-action-card .study { color:var(--green-color); background:rgba(52,199,89,.12); }
.home-action-card .practice { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.12); }
.home-action-card .mock { color:#1e8e3e; background:rgba(30,142,62,.12); }
.home-action-card .interview { color:var(--orange-color); background:rgba(255,149,0,.12); }
</style>
