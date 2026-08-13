import { shallowRef } from 'vue';
import type { ExamSubjectView, ExamWrittenFormat } from '@/modules/curriculum/public';

/**
 * Answer formats the active exam package offers for its subjective subjects.
 *
 * Application code used to infer "is this a full essay?" by matching the topic
 * name against 申发论述 in six places. The package now states it, so a different
 * exam can name its long-form paper anything.
 *
 * Installed alongside the label catalog when a pack is activated; held in a
 * `shallowRef` so views re-render when the active pack changes.
 */
const formats = shallowRef<readonly ExamWrittenFormat[]>([]);

export function installWrittenFormats(subjects: readonly ExamSubjectView[]): void {
  formats.value = subjects.flatMap((subject) => subject.writtenFormats);
}

/** Offered formats, in package order. Drives topic pickers. */
export function writtenFormats(): readonly ExamWrittenFormat[] {
  return formats.value;
}

export function writtenFormatNames(): readonly string[] {
  return formats.value.map((format) => format.name);
}

/**
 * Whether a topic is answered as one long piece rather than several short ones.
 * Unknown topics are treated as short answers, matching the previous default.
 */
export function isLongFormTopic(topic?: string): boolean {
  const normalized = topic?.trim();
  if (!normalized) return false;
  return formats.value.find((format) => format.name === normalized)?.longForm ?? false;
}

/** Default topic for a subjective mock paper: the first short-answer format. */
export function defaultShortFormTopic(): string | undefined {
  return formats.value.find((format) => !format.longForm)?.name;
}

/** Default topic for long-form practice, when the package offers one. */
export function defaultLongFormTopic(): string | undefined {
  return formats.value.find((format) => format.longForm)?.name;
}
