import { defineStore } from 'pinia';
import type { PlanDashboard } from '@/services/PlanDashboardService';
import { planDashboardService } from '@/services/PlanDashboardService';

export const usePlanStore = defineStore('plan', {
  state: () => ({
    dashboard: null as PlanDashboard | null,
    isLoading: false,
    isGenerating: false,
    error: ''
  }),

  getters: {
    tasks(state) {
      return state.dashboard?.todayTasks || [];
    },
    doneCount(state) {
      return (state.dashboard?.todayTasks || []).filter((task) => task.done).length;
    }
  },

  actions: {
    async load() {
      this.isLoading = true;
      this.error = '';
      try {
        this.dashboard = await planDashboardService.getDashboard();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.isLoading = false;
      }
    },

    async generate() {
      this.isGenerating = true;
      this.error = '';
      try {
        this.dashboard = await planDashboardService.generateTodayPlan();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.isGenerating = false;
      }
    }
  }
});
