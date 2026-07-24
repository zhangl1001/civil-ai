import type { PracticeMode } from '@/domain/practice';
import { generationTaskService } from './GenerationTaskService';
import type { EnqueueResult } from '@/tasks/taskTypes';

export interface PracticeStartContext {
  module: string;
  knowledgePoint?: string;
  knowledgePoints?: string[];
  date: string;
  mode: PracticeMode;
  source: 'plan' | 'calendar' | 'practice-center' | 'error-report' | 'knowledge-graph' | 'quality-dashboard' | 'sprint';
  questionCount: number;
  sourceRef?: string;
  questionIds?: string[];
  needsGeneration?: boolean;
  questionType?: string;
  difficulty?: string;
  sourceStyle?: string;
  practicePurpose?: string;
  timeLimitMinutes?: number;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function modeFromLegacy(value: string | null): PracticeMode {
  if (value === 'review') return 'review';
  if (value === 'mock') return 'mock';
  if (value === 'smart') return 'diagnostic';
  return 'practice';
}

export class PracticeFlowService {
  generationSourceId(context: PracticeStartContext): string {
    return `${context.mode}:${context.module}:${context.knowledgePoint || context.knowledgePoints?.join('-') || 'all'}:${context.date}:${context.questionType || 'all'}:${context.difficulty || 'mixed'}:${context.sourceStyle || 'ai'}`;
  }

  readStartContext(): PracticeStartContext {
    const module = localStorage.getItem('mp-target-module') || '资料分析';
    const knowledgePoint = localStorage.getItem('mp-target-kp') || undefined;
    const date = localStorage.getItem('mp-practice-date') || today();
    const toolSource = localStorage.getItem('mp-from-tool') as PracticeStartContext['source'] | null;
    const source = localStorage.getItem('mp-from-plan') ? 'plan' : (toolSource || 'practice-center');
    const sourceRef = localStorage.getItem('mp-source-ref') || undefined;
    const needsGeneration = localStorage.getItem('mp-needs-generation') === '1';
    const knowledgePoints = readStringArray('mp-target-kps');
    const questionIds = readStringArray('mp-question-ids');
    return {
      module,
      knowledgePoint,
      knowledgePoints,
      date,
      mode: modeFromLegacy(localStorage.getItem('mp-practice-mode')),
      source,
      questionCount: Number(localStorage.getItem('mp-question-count') || 10),
      sourceRef,
      questionIds,
      needsGeneration,
      questionType: localStorage.getItem('mp-question-type') || undefined,
      difficulty: localStorage.getItem('mp-difficulty') || undefined,
      sourceStyle: localStorage.getItem('mp-source-style') || undefined,
      practicePurpose: localStorage.getItem('mp-practice-purpose') || undefined,
      timeLimitMinutes: Number(localStorage.getItem('mp-time-limit-minutes') || 0) || undefined
    };
  }

  writeStartContext(patch: Partial<PracticeStartContext>): PracticeStartContext {
    const next = { ...this.readStartContext(), ...patch };
    localStorage.setItem('mp-target-module', next.module);
    if (next.knowledgePoint) localStorage.setItem('mp-target-kp', next.knowledgePoint);
    else localStorage.removeItem('mp-target-kp');
    if (next.knowledgePoints?.length) localStorage.setItem('mp-target-kps', JSON.stringify(next.knowledgePoints));
    else localStorage.removeItem('mp-target-kps');
    localStorage.setItem('mp-practice-date', next.date);
    localStorage.setItem('mp-practice-mode', next.mode === 'diagnostic' ? 'smart' : next.mode);
    if (next.source === 'plan') localStorage.setItem('mp-from-plan', '1');
    else localStorage.removeItem('mp-from-plan');
    if (next.source !== 'plan' && next.source !== 'practice-center' && next.source !== 'calendar') localStorage.setItem('mp-from-tool', next.source);
    else localStorage.removeItem('mp-from-tool');
    localStorage.setItem('mp-question-count', String(next.questionCount));
    if (next.sourceRef) localStorage.setItem('mp-source-ref', next.sourceRef);
    else localStorage.removeItem('mp-source-ref');
    if (next.questionIds?.length) localStorage.setItem('mp-question-ids', JSON.stringify(next.questionIds));
    else localStorage.removeItem('mp-question-ids');
    if (next.needsGeneration && !next.sourceRef) localStorage.setItem('mp-needs-generation', '1');
    else localStorage.removeItem('mp-needs-generation');
    writeOptionalString('mp-question-type', next.questionType);
    writeOptionalString('mp-difficulty', next.difficulty);
    writeOptionalString('mp-source-style', next.sourceStyle);
    writeOptionalString('mp-practice-purpose', next.practicePurpose);
    if (next.timeLimitMinutes) localStorage.setItem('mp-time-limit-minutes', String(next.timeLimitMinutes));
    else localStorage.removeItem('mp-time-limit-minutes');
    return next;
  }

  async enqueueGeneration(context = this.readStartContext()): Promise<EnqueueResult> {
    const result = await generationTaskService.enqueue({
      intent: context.mode === 'review' ? 'redo' : 'practice',
      title: context.mode === 'review' ? '生成错题重练' : '生成专项练习',
      detail: context.knowledgePoint
        ? `${context.module} · ${context.knowledgePoint} · ${context.questionCount} 题`
        : `${context.module} · ${context.questionCount} 题${context.difficulty ? ` · ${context.difficulty}` : ''}`,
      module: context.module,
      sourceId: this.generationSourceId(context),
      payload: {
        module: context.module,
        knowledgePoint: context.knowledgePoint,
        knowledgePoints: context.knowledgePoints,
        date: context.date,
        mode: context.mode,
        questionCount: context.questionCount,
        questionType: context.questionType,
        difficulty: context.difficulty,
        sourceStyle: context.sourceStyle,
        practicePurpose: context.practicePurpose,
        timeLimitMinutes: context.timeLimitMinutes
      }
    });
    this.writeStartContext({ ...context, sourceRef: result.task.id, questionIds: undefined, needsGeneration: false });
    return result;
  }

  async enqueueExtraPractice(context = this.readStartContext()): Promise<EnqueueResult> {
    const extraContext: PracticeStartContext = {
      ...context,
      mode: 'practice',
      source: 'practice-center',
      questionCount: context.questionCount || 10
    };
    const result = await generationTaskService.enqueue({
      intent: 'practice',
      title: '生成加练题',
      detail: extraContext.knowledgePoint
        ? `${extraContext.module} · ${extraContext.knowledgePoint} · 加练 ${extraContext.questionCount} 题`
        : `${extraContext.module} · 加练 ${extraContext.questionCount} 题`,
      module: extraContext.module,
      sourceId: `extra:${extraContext.module}:${extraContext.knowledgePoint || 'all'}:${extraContext.date}`,
      payload: {
        module: extraContext.module,
        knowledgePoint: extraContext.knowledgePoint,
        knowledgePoints: extraContext.knowledgePoints,
        date: extraContext.date,
        mode: extraContext.mode,
        questionCount: extraContext.questionCount,
        questionType: extraContext.questionType,
        difficulty: extraContext.difficulty,
        sourceStyle: extraContext.sourceStyle,
        practicePurpose: extraContext.practicePurpose,
        timeLimitMinutes: extraContext.timeLimitMinutes
      }
    });
    this.writeStartContext({ ...extraContext, sourceRef: result.task.id, questionIds: undefined, needsGeneration: false });
    return result;
  }
}

export const practiceFlowService = new PracticeFlowService();

function readStringArray(key: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    const values = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    return values.length ? values : undefined;
  } catch {
    return undefined;
  }
}

function writeOptionalString(key: string, value?: string): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}
