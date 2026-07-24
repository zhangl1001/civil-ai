import type { Brand } from './ids';

export type InstantMs = Brand<number, 'InstantMs'>;
export type DurationMs = Brand<number, 'DurationMs'>;
export type LocalDate = Brand<string, 'LocalDate'>;
export type TimeZoneId = Brand<string, 'TimeZoneId'>;

export interface Clock {
  now(): InstantMs;
  monotonicNowMs(): DurationMs;
}
