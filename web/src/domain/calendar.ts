export interface CalendarMonthCell {
  date: string;
  day: number;
  isToday: boolean;
  hasPractice: boolean;
  hasEssay: boolean;
  hasMock: boolean;
  total: number;
  correct: number;
  accuracy: number | null;
}

export interface CalendarMonthSummary {
  year: number;
  month: number;
  activeDays: number;
  streak: number;
  averageAccuracy: number | null;
  cells: CalendarMonthCell[];
}

export interface CalendarDayTask {
  id: string;
  type: 'practice' | 'essay' | 'mock' | 'digest' | 'review' | 'grade';
  title: string;
  module?: string;
  status: 'done' | 'pending';
  questionCount: number;
  correct?: number;
  accuracy?: number;
  sourceRef?: string;
}

export interface CalendarDayDetail {
  date: string;
  isToday: boolean;
  hasActivity: boolean;
  tasks: CalendarDayTask[];
  total: number;
  correct: number;
  accuracy: number | null;
  weakModules: Array<{ module: string; accuracy: number }>;
}
