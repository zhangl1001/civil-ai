import type { Component } from 'vue';

export interface SwipeActionRowAction {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly icon?: Component;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
}
