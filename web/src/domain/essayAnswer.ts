export interface EssayWordLimit {
  readonly min?: number;
  readonly max?: number;
}

export type EssayWordCountTone = 'neutral' | 'warning' | 'danger';

export interface EssayWordCountStatus {
  readonly count: number;
  readonly limit: EssayWordLimit;
  readonly label: string;
  readonly tone: EssayWordCountTone;
}

/**
 * Matches every字数 constraint a 申论 requirement can state, in one pass so a single
 * number span is never counted twice (a `200-300字` range must not also read as `300字`).
 */
const WORD_LIMIT_PATTERN = new RegExp([
  '(\\d{2,5})\\s*[-~—–至到]\\s*(\\d{2,5})\\s*字',
  '(?:不超过|不多于|至多|最多)\\s*(\\d{2,5})\\s*字',
  '(\\d{2,5})\\s*字(?:以内|之内|以下)',
  '(?:不少于|不低于|至少)\\s*(\\d{2,5})\\s*字',
  '(\\d{2,5})\\s*字左右'
].map((part) => `(?:${part})`).join('|'), 'gu');

/** 申论 answers are graded on characters; whitespace and line breaks never count. */
export function countEssayWords(content: string): number {
  return content.replace(/\s+/gu, '').length;
}

/**
 * One answer sheet holds every task of the set, so per-task budgets add up into the
 * budget the writer actually has to respect.
 */
export function parseEssayWordLimit(requirement: string): EssayWordLimit {
  let min = 0;
  let max = 0;
  for (const match of requirement.matchAll(WORD_LIMIT_PATTERN)) {
    const [, rangeMin, rangeMax, atMost, within, atLeast, around] = match;
    if (rangeMin && rangeMax) {
      min += Number(rangeMin);
      max += Number(rangeMax);
      continue;
    }
    if (atMost || within) {
      max += Number(atMost || within);
      continue;
    }
    if (atLeast) {
      min += Number(atLeast);
      continue;
    }
    if (around) {
      min += Math.round(Number(around) * 0.9);
      max += Math.round(Number(around) * 1.1);
    }
  }
  return {
    ...(min > 0 ? { min } : {}),
    ...(max > 0 ? { max } : {})
  };
}

export function describeEssayWordCount(content: string, requirement: string): EssayWordCountStatus {
  const count = countEssayWords(content);
  const limit = parseEssayWordLimit(requirement);
  return { count, limit, label: limitLabel(count, limit), tone: limitTone(count, limit) };
}

function limitLabel(count: number, limit: EssayWordLimit): string {
  if (limit.max && count > limit.max) return `${count} / ${limit.max} 字 · 超出 ${count - limit.max} 字`;
  if (limit.max) return `${count} / ${limit.max} 字`;
  if (limit.min) return `${count} 字 · 不少于 ${limit.min} 字`;
  return `${count} 字`;
}

function limitTone(count: number, limit: EssayWordLimit): EssayWordCountTone {
  if (limit.max && count > limit.max) return 'danger';
  if (limit.min && count > 0 && count < limit.min) return 'warning';
  return 'neutral';
}
