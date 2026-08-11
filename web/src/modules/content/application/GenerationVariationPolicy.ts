import type { JsonObject } from '@/kernel/public';

export const GenerationVariationKind = {
  DailyNews: 'daily_news',
  DailyKnowledge: 'daily_knowledge',
  StudyLecture: 'study_lecture',
  ObjectiveQuestions: 'objective_questions',
  MonthlyDigest: 'monthly_digest',
  EssayQuestion: 'essay_question'
} as const;

export type GenerationVariationKind = typeof GenerationVariationKind[keyof typeof GenerationVariationKind];

export interface RecentGeneratedContent {
  readonly title: string;
  readonly content: string;
}

export interface GenerationVariationInput {
  readonly kind: GenerationVariationKind;
  readonly seed: string;
  readonly attempt?: number;
  readonly recentItems?: readonly RecentGeneratedContent[];
}

interface VariationDirection {
  readonly code: string;
  readonly directive: string;
}

const DIRECTIONS: Record<GenerationVariationKind, readonly VariationDirection[]> = {
  [GenerationVariationKind.DailyNews]: [
    { code: 'policy_chain', directive: '优先梳理事件背景、治理矛盾与政策工具之间的因果链。' },
    { code: 'stakeholder_view', directive: '优先比较不同治理主体的职责、利益与协同关系。' },
    { code: 'implementation_view', directive: '优先解释政策从目标到执行、监督和反馈的落地过程。' },
    { code: 'cross_topic_link', directive: '优先建立少量热点之间的共同治理主线和迁移表达。' },
    { code: 'exam_transfer', directive: '优先提炼可用于申论论证和行测常识判断的考试迁移点。' }
  ],
  [GenerationVariationKind.DailyKnowledge]: [
    { code: 'boundary_contrast', directive: '优先用相近概念对比建立清晰边界。' },
    { code: 'recognition_signals', directive: '优先提炼题干识别信号和方法选择条件。' },
    { code: 'misconception_repair', directive: '优先围绕典型误区解释错误发生在哪一步以及如何纠正。' },
    { code: 'scenario_transfer', directive: '优先通过新场景展示知识点迁移，而不是复述定义。' },
    { code: 'decision_process', directive: '优先呈现考场中的判断顺序、取舍依据和检查动作。' }
  ],
  [GenerationVariationKind.StudyLecture]: [
    { code: 'concept_map', directive: '从概念边界和前置知识关系组织本轮精讲。' },
    { code: 'method_selection', directive: '从识别题型到选择方法的决策过程组织本轮精讲。' },
    { code: 'worked_example', directive: '用一个完整例子串联识别、推理、结论和复盘。' },
    { code: 'trap_comparison', directive: '通过正确路径与典型错误路径对照组织本轮精讲。' },
    { code: 'transfer_ladder', directive: '按基础理解、变式辨析和迁移应用的递进关系组织本轮精讲。' }
  ],
  [GenerationVariationKind.ObjectiveQuestions]: [
    { code: 'core_recognition', directive: '本轮重点变化题干识别信号与核心关系表达。' },
    { code: 'boundary_distractors', directive: '本轮重点变化概念边界和干扰项形成机制。' },
    { code: 'realistic_scenarios', directive: '本轮重点变化材料场景和信息组织方式。' },
    { code: 'method_transfer', directive: '本轮重点变化方法迁移与相邻知识辨析。' },
    { code: 'time_pressure', directive: '本轮重点变化考场限时决策和信息取舍。' }
  ],
  [GenerationVariationKind.MonthlyDigest]: [
    { code: 'governance_threads', directive: '按本月治理主线归并事件，突出共同机制。' },
    { code: 'policy_evolution', directive: '按政策目标、工具和执行变化组织复盘。' },
    { code: 'exam_transfer', directive: '按申论论证、行测常识和复习动作组织复盘。' },
    { code: 'cross_event_comparison', directive: '通过跨事件比较提炼差异、关联和可迁移结论。' }
  ],
  [GenerationVariationKind.EssayQuestion]: [
    { code: 'governance_conflict', directive: '优先通过真实治理矛盾和多主体关系构造材料。' },
    { code: 'policy_execution', directive: '优先通过政策执行、反馈与改进链条构造材料。' },
    { code: 'case_comparison', directive: '优先通过正反案例或地区差异构造分析空间。' },
    { code: 'problem_solution', directive: '优先通过问题成因、影响和解决路径构造作答信息。' }
  ]
};

/**
 * Supplies bounded creative guidance without changing the structural contract.
 * The model keeps authority over concrete content while recent outlines prevent
 * repeated high-probability answers from becoming the default curriculum.
 */
export function buildGenerationVariationContext(input: GenerationVariationInput): JsonObject {
  const directions = DIRECTIONS[input.kind];
  const attempt = Math.max(0, Math.floor(input.attempt ?? 0));
  const direction = directions[(stableHash(input.seed) + attempt) % directions.length]!;
  const recentOutlines = summarizeRecentItems(input.recentItems ?? []);
  return {
    mode: 'guided_diversity',
    directionCode: direction.code,
    direction: direction.directive,
    recentOutlinesToAvoid: recentOutlines,
    boundary: '保持目标知识点、事实证据和输出结构合同不变；变化具体案例、材料关系、讲解视角或干扰项设计，不得只替换名称和数字。'
  };
}

export function isNearDuplicateGeneratedContent(
  candidate: string,
  recentItems: readonly RecentGeneratedContent[],
  threshold = 0.84
): boolean {
  const normalizedCandidate = normalizeForSimilarity(candidate);
  if (!normalizedCandidate) return false;
  return recentItems.some((item) => {
    const normalizedPrevious = normalizeForSimilarity(item.content);
    if (normalizedCandidate === normalizedPrevious) return normalizedCandidate.length >= 20;
    if (normalizedCandidate.length < 80 || normalizedPrevious.length < 80) return false;
    return shingleSimilarity(normalizedCandidate, normalizedPrevious) >= threshold;
  });
}

function summarizeRecentItems(items: readonly RecentGeneratedContent[]): string[] {
  const summaries: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const outline = summarizeItem(item);
    const key = normalizeForSimilarity(outline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    summaries.push(outline);
    if (summaries.length >= 8) break;
  }
  return summaries;
}

function summarizeItem(item: RecentGeneratedContent): string {
  const lines = item.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headings = lines
    .filter((line) => line.startsWith('#'))
    .map((line) => line.replace(/^#{1,6}\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const firstBodyLine = lines.find((line) => !line.startsWith('#')) ?? '';
  return [item.title.trim(), ...headings, stripMarkdown(firstBodyLine)]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 320);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/[`*_>~]/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForSimilarity(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 6000);
}

function shingleSimilarity(left: string, right: string): number {
  const leftShingles = shingles(left);
  const rightShingles = shingles(right);
  if (!leftShingles.size || !rightShingles.size) return 0;
  let intersection = 0;
  leftShingles.forEach((value) => {
    if (rightShingles.has(value)) intersection += 1;
  });
  return intersection / (leftShingles.size + rightShingles.size - intersection);
}

function shingles(value: string): Set<string> {
  const result = new Set<string>();
  if (value.length <= 3) {
    if (value) result.add(value);
    return result;
  }
  for (let index = 0; index <= value.length - 3; index += 1) {
    result.add(value.slice(index, index + 3));
  }
  return result;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
