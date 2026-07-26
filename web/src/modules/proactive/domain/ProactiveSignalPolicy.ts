import { ProactiveLevel, type LearningPreferences } from '@/modules/candidate/public';
import type { ProactiveSignal, ProactiveSignalRepository } from '../contracts/ProactiveSignalRepository';
import type { ProactiveSignalType } from './ProactiveSignalCodes';

const HOUR_MS = 60 * 60 * 1_000;

export interface ProactivePolicyDecision {
  readonly allowed: boolean;
  readonly availableAt: number;
  readonly reason: 'allowed' | 'cooldown' | 'quiet_level' | 'quiet_hours';
}

export async function decideProactiveDelivery(input: {
  readonly preferences: LearningPreferences;
  readonly signalType: ProactiveSignalType;
  readonly priority: number;
  readonly now: number;
  readonly repository: Pick<ProactiveSignalRepository, 'findLatestByType'>;
}): Promise<ProactivePolicyDecision> {
  if (input.preferences.proactiveLevel === ProactiveLevel.Quiet && input.priority < 80) {
    return { allowed: false, availableAt: input.now, reason: 'quiet_level' };
  }
  const latest = await input.repository.findLatestByType(input.preferences.examCycleId, input.signalType);
  const cooldown = cooldownMs(input.preferences.proactiveLevel);
  if (latest && input.now - latest.createdAt < cooldown) {
    return { allowed: false, availableAt: latest.createdAt + cooldown, reason: 'cooldown' };
  }
  const quietEnd = quietHoursEnd(input.now, input.preferences.quietHours);
  if (quietEnd !== undefined) {
    return { allowed: true, availableAt: quietEnd, reason: 'quiet_hours' };
  }
  return { allowed: true, availableAt: input.now, reason: 'allowed' };
}

export function selectHighestPriority(signals: readonly ProactiveSignal[], limit: number): readonly ProactiveSignal[] {
  return [...signals]
    .sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt)
    .slice(0, Math.max(0, limit));
}

function cooldownMs(level: LearningPreferences['proactiveLevel']): number {
  if (level === ProactiveLevel.Active) return 2 * HOUR_MS;
  if (level === ProactiveLevel.Balanced) return 6 * HOUR_MS;
  return 24 * HOUR_MS;
}

function quietHoursEnd(now: number, values: LearningPreferences['quietHours']): number | undefined {
  const current = new Date(now);
  const minuteOfDay = current.getHours() * 60 + current.getMinutes();
  for (const value of values) {
    const start = parseMinute(value.start);
    const end = parseMinute(value.end);
    if (start === undefined || end === undefined) continue;
    const inside = start <= end
      ? minuteOfDay >= start && minuteOfDay < end
      : minuteOfDay >= start || minuteOfDay < end;
    if (!inside) continue;
    const minutesUntilEnd = start <= end || minuteOfDay < end
      ? end - minuteOfDay
      : 24 * 60 - minuteOfDay + end;
    return now + Math.max(1, minutesUntilEnd) * 60_000;
  }
  return undefined;
}

function parseMinute(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}
