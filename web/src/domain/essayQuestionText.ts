const MATERIAL_PREFIX = /^给定资料[:：]\s*/u;
const MATERIAL_SPLIT = /\n{2,}|(?=材料[一二三四五六七八九十\d]+[:：])|(?=资料[一二三四五六七八九十\d]+[:：])/u;
const REQUIREMENT_PREFIX = /^要求[:：]\s*/u;

/**
 * Task markers are consumed whole rather than matched by lookahead: an optional opening
 * bracket makes a lookahead fire twice on `(1)`, once before the bracket and once before
 * the digit, which strands the bracket as its own task.
 */
const TASK_MARKER = /(^|[\s；;。，,])\s*(?:[（(]\s*\d+\s*[）)]|\d+\s*[.、)]|[一二三四五六七八九十]+\s*[、.．])\s*/gu;
/** Generated requirement text never carries a control character, so splitting on one is safe. */
const TASK_SEPARATOR = '\u0000';

/** Splits 给定资料 into the paragraphs a reader scans one at a time. */
export function splitEssayMaterial(material: string): string[] {
  const clean = material.trim();
  if (!clean) return [];
  return clean
    .replace(MATERIAL_PREFIX, '')
    .split(MATERIAL_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Splits 作答要求 into individual tasks, keeping a single-task requirement whole. */
export function splitEssayRequirement(requirement: string): string[] {
  const clean = requirement.trim().replace(REQUIREMENT_PREFIX, '');
  if (!clean) return [];
  const parts = clean
    .replace(TASK_MARKER, (_match, lead: string) => `${lead}${TASK_SEPARATOR}`)
    .replace(/\n+/gu, TASK_SEPARATOR)
    .split(TASK_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts : [clean];
}
