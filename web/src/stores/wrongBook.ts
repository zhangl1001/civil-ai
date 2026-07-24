import { defineStore } from 'pinia';
import { wrongBookRepository, type WrongBookEntry } from '@/services/WrongBookRepository';
import type { WrongStatus } from '@/domain/wrongbook';

export interface WrongBookState {
  entries: WrongBookEntry[];
  allModules: string[];
  allReasons: string[];
  selectedModule: string;
  selectedStatus: string;
  selectedReason: string;
  selectedScope: 'all' | 'due' | 'highFrequency';
  selectedSort: 'recent' | 'wrongCount' | 'due';
  isLoading: boolean;
  error: string | null;
}

export const useWrongBookStore = defineStore('wrongBook', {
  state: (): WrongBookState => ({
    entries: [],
    allModules: [],
    allReasons: [],
    selectedModule: '',
    selectedStatus: '',
    selectedReason: '',
    selectedScope: 'all',
    selectedSort: 'recent',
    isLoading: false,
    error: null
  }),

  getters: {
    modules(state): string[] {
      return state.allModules;
    },
    reasons(state): string[] {
      return state.allReasons;
    },
    openCount(state): number {
      return state.entries.filter((entry) => entry.item.status === 'open').length;
    }
  },

  actions: {
    async fetch() {
      this.isLoading = true;
      this.error = null;
      try {
        this.entries = await wrongBookRepository.list({
          module: this.selectedModule || undefined,
          status: this.selectedStatus ? this.selectedStatus as WrongStatus : undefined,
          reason: this.selectedReason || undefined,
          scope: this.selectedScope,
          sort: this.selectedSort
        });
        [this.allModules, this.allReasons] = await Promise.all([
          wrongBookRepository.modules(),
          wrongBookRepository.reasons()
        ]);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.entries = [];
      } finally {
        this.isLoading = false;
      }
    },

    async setModule(module: string) {
      this.selectedModule = module;
      await this.fetch();
    },

    async setStatus(status: string) {
      this.selectedStatus = status;
      await this.fetch();
    },

    async setReason(reason: string) {
      this.selectedReason = reason;
      await this.fetch();
    },

    async setScope(scope: WrongBookState['selectedScope']) {
      this.selectedScope = scope;
      await this.fetch();
    },

    async setSort(sort: WrongBookState['selectedSort']) {
      this.selectedSort = sort;
      await this.fetch();
    },

    async markReviewing(itemId: string) {
      await wrongBookRepository.markReviewing(itemId);
      await this.fetch();
    },

    async startReview(itemId: string) {
      await wrongBookRepository.startReview(itemId);
      await this.fetch();
    },

    async updateStatus(itemId: string, status: WrongStatus) {
      await wrongBookRepository.updateStatus(itemId, status);
      await this.fetch();
    },

    async updateReason(itemId: string, reason: string) {
      await wrongBookRepository.updateReason(itemId, reason);
      await this.fetch();
    },

    async scheduleReview(itemId: string, delayDays: number) {
      await wrongBookRepository.scheduleReview(itemId, delayDays);
      await this.fetch();
    },

    async deleteMany(itemIds: string[]) {
      await wrongBookRepository.deleteMany(itemIds);
      await this.fetch();
    }
  }
});
