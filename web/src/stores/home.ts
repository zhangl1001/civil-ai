import { defineStore } from 'pinia';
import type { HomeFeatureGroup } from '@/domain/home';
import { homeDashboardRepository } from '@/services/HomeDashboardRepository';

export interface Project {
  id: string;
  name: string;
  status?: string;
  activeProfileId?: string;
}

export interface TodayTask {
  id: string;
  type: string;
  text: string;
  sub: string;
  done: boolean;
  icon: string;
}

export interface Countdown {
  days: number;
  phase: string;
  progress: number;
  label: string;
}

export interface ModuleStat {
  name: string;
  accuracy: number;
}

export interface HomeState {
  greeting: string;
  greetingSub: string;
  activeProject: Project | null;
  requiresOnboarding: boolean;
  countdown: Countdown | null;
  todayTasks: TodayTask[];
  moduleStats: ModuleStat[];
  diagnosisSummary: string;
  focusModules: string[];
  featureGroups: HomeFeatureGroup[];
  isLoading: boolean;
  error: string | null;
}

export const useHomeStore = defineStore('home', {
  state: (): HomeState => ({
    greeting: '加载中...',
    greetingSub: '',
    activeProject: null,
    requiresOnboarding: false,
    countdown: null,
    todayTasks: [],
    moduleStats: [],
    diagnosisSummary: '',
    focusModules: [],
    featureGroups: [],
    isLoading: true,
    error: null,
  }),

  actions: {
    async fetchHomeData() {
      this.isLoading = true;
      this.error = null;
      try {
        const data = await homeDashboardRepository.getHomeData();
        this.activeProject = data.activeProject;
        this.requiresOnboarding = data.requiresOnboarding;
        this.countdown = data.countdown;
        this.todayTasks = data.todayTasks;
        this.moduleStats = data.moduleStats;
        this.diagnosisSummary = data.diagnosisSummary;
        this.focusModules = data.focusModules;
        this.featureGroups = data.featureGroups;
        this.greeting = data.greeting;
        this.greetingSub = data.greetingSub;
      } catch (error: any) {
        console.error('Failed to fetch home data:', error);
        this.error = error.message || '加载首页数据失败';
        this.greeting = '数据加载失败';
      } finally {
        this.isLoading = false;
      }
    },
  },
});
