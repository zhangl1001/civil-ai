import { defineStore } from 'pinia';
import type { CalendarDayDetail, CalendarMonthSummary } from '@/domain/calendar';
import { calendarService } from '@/services/CalendarService';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export const useCalendarStore = defineStore('calendar', {
  state: () => ({
    ...currentYearMonth(),
    selectedDate: new Date().toISOString().slice(0, 10),
    monthData: null as CalendarMonthSummary | null,
    dayDetail: null as CalendarDayDetail | null,
    isLoading: false,
    error: ''
  }),

  actions: {
    async loadMonth() {
      this.isLoading = true;
      this.error = '';
      try {
        this.monthData = await calendarService.getMonth(this.year, this.month);
        await this.selectDate(this.selectedDate);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.isLoading = false;
      }
    },

    async changeMonth(delta: number) {
      const date = new Date(this.year, this.month - 1 + delta, 1);
      this.year = date.getFullYear();
      this.month = date.getMonth() + 1;
      this.selectedDate = `${this.year}-${String(this.month).padStart(2, '0')}-01`;
      await this.loadMonth();
    },

    async selectDate(date: string) {
      this.selectedDate = date;
      this.dayDetail = await calendarService.getDayDetail(date);
    }
  }
});
