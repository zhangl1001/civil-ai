import type { CreateTaskInput } from './taskTypes';

export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function taskInputHash(value: unknown): string {
  return stableHash(JSON.stringify(value));
}

export function defaultLockKey(input: Pick<CreateTaskInput, 'projectId' | 'type' | 'detail' | 'inputHash'>): string {
  return [input.projectId, input.type, input.inputHash || input.detail || ''].join(':');
}
