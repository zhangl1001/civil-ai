import type { GenerationIntent } from '@/services/GenerationTaskService';

export type HomeActionKind = 'route' | 'task' | 'toast';

export interface HomeAction {
  kind: HomeActionKind;
  route?: string;
  intent?: GenerationIntent;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface HomeFeatureEntry {
  id: string;
  name: string;
  sub: string;
  icon: string;
  color: 'blue' | 'green' | 'orange' | 'red' | 'purple';
  actionLabel: string;
  ready: boolean;
  disabledReason?: string;
  action: HomeAction;
}

export interface HomeFeatureGroup {
  id: string;
  title: string;
  sub: string;
  items: HomeFeatureEntry[];
}
