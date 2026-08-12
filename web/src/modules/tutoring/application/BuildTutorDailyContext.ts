import type { Clock, JsonObject, LocalDate } from '@/kernel/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { ContentRepository } from '@/modules/content/public';
import { QuestionOriginType } from '@/modules/content/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { LearningSessionRepository } from '@/modules/evidence/public';
import type { MasteryRepository } from '@/modules/mastery/public';
import type { DailyPlanRepository } from '@/modules/planning/public';
import type { LearningThreadRepository } from '@/modules/teaching/public';
import type { TutorCycleRepository } from '../contracts/TutorCycleRepository';
import { TUTOR_CONTEXT_POLICY_VERSION } from '../domain/TutorCycleCodes';
import type { LearnerPrioritySnapshot } from './BuildLearnerPrioritySnapshot';

const MAX_PRIORITY_TRACKS = 5;
const MAX_DUE_REVIEWS = 5;
const MAX_RECENT_SESSIONS = 3;
const MAX_OPEN_THREADS = 3;
const MAX_RECENT_CONCLUSIONS = 3;

interface AbilityCalibrationPort {
  execute(command: { readonly persist: false }): Promise<{
    readonly algorithmVersion: string;
    readonly baseline: unknown;
    readonly modules: unknown;
    readonly scoreForecasts: unknown;
    readonly changes: unknown;
  } | undefined>;
}

interface LearnerPriorityPort {
  execute(): Promise<LearnerPrioritySnapshot | undefined>;
}

export interface TutorDailyContext {
  readonly policyVersion: string;
  readonly generatedAt: number;
  readonly calendar: JsonObject;
  readonly profile: JsonObject;
  readonly todayPlan: JsonObject;
  readonly priorityCapabilities: readonly JsonObject[];
  readonly dueReviews: readonly JsonObject[];
  readonly activeThreads: readonly JsonObject[];
  readonly recentEvidence: readonly JsonObject[];
  readonly trueQuestionEvidence: JsonObject;
  readonly abilityCalibration: JsonObject;
  readonly recentTeachingConclusions: readonly JsonObject[];
  readonly confirmation: JsonObject;
}

export class BuildTutorDailyContext {
  constructor(
    private readonly candidates: CandidateRepository,
    private readonly curriculums: CurriculumRepository,
    private readonly mastery: MasteryRepository,
    private readonly learnerPriorities: LearnerPriorityPort,
    private readonly plans: DailyPlanRepository,
    private readonly sessions: LearningSessionRepository,
    private readonly content: ContentRepository,
    private readonly threads: LearningThreadRepository,
    private readonly conclusions: TutorCycleRepository,
    private readonly calibration: AbilityCalibrationPort,
    private readonly clock: Clock
  ) {}

  async execute(): Promise<TutorDailyContext | undefined> {
    const cycle = await this.candidates.findCurrentCycle();
    if (!cycle) return undefined;
    const now = this.clock.now();
    const planDate = localDate(now, cycle.examCycle.timeZone) as LocalDate;
    const daysUntilExam = daysBetweenLocalDates(planDate, cycle.examCycle.examDate);
    const [curriculum, prioritySnapshot, reviews, plan, recentSessions, conclusionRows, calibration] = await Promise.all([
      this.curriculums.findBundle(cycle.examCycle.curriculumVersionId),
      this.learnerPriorities.execute(),
      this.mastery.listDueReviews(cycle.examCycle.id, now, MAX_DUE_REVIEWS),
      this.plans.findCurrent(cycle.examCycle.id, planDate),
      this.sessions.listRecent(cycle.examCycle.id, MAX_RECENT_SESSIONS),
      this.conclusions.listRecent(cycle.examCycle.id, MAX_RECENT_CONCLUSIONS),
      this.calibration.execute({ persist: false })
    ]);
    const priorities = prioritySnapshot?.priorities.slice(0, MAX_PRIORITY_TRACKS) ?? [];
    const seenConclusionSessions = new Set<string>();
    const recentConclusions = conclusionRows.filter((item) => {
      if (seenConclusionSessions.has(item.learningSessionId)) return false;
      seenConclusionSessions.add(item.learningSessionId);
      return true;
    });
    const nodeById = new Map(curriculum?.capabilityNodes.map((node) => [node.id, node]) ?? []);
    const capabilityIds = [...new Set([
      ...priorities.map((priority) => priority.capabilityNodeId),
      ...reviews.map((review) => review.capabilityNodeId),
      ...(plan?.items.map((item) => item.capabilityNodeId) ?? [])
    ])].slice(0, MAX_OPEN_THREADS);
    const [openThreads, sessionBundles, trueQuestionSets] = await Promise.all([
      Promise.all(capabilityIds.map((id) => this.threads.findOpen(cycle.examCycle.id, id))),
      Promise.all(recentSessions.map((facts) => this.content.findQuestionSet(facts.session.questionSetId))),
      capabilityIds.length ? this.content.queryQuestionSetLibrary({
        examCycleId: cycle.examCycle.id,
        capabilityNodeIds: capabilityIds,
        originTypes: [QuestionOriginType.Official, QuestionOriginType.Imported, QuestionOriginType.UserCreated],
        limit: 12
      }) : Promise.resolve([])
    ]);
    const evidence = recentSessions.map((facts, index) => {
      const bundle = sessionBundles[index];
      const originType = bundle?.questionSet.originType ?? QuestionOriginType.AiGenerated;
      return {
        sessionId: facts.session.id,
        questionSetId: facts.session.questionSetId,
        capability: capabilityView(facts.attempts[0]?.capabilityNodeId, nodeById),
        assessmentRole: facts.session.assessmentRole,
        originType,
        completedAt: facts.session.completedAt,
        questionCount: facts.session.questionCount,
        answeredCount: facts.session.answeredCount,
        correctCount: facts.session.correctCount,
        accuracy: ratio(facts.session.correctCount, facts.session.answeredCount)
      };
    });
    const trueQuestionSessions = evidence.filter((item) => (
      item.originType === QuestionOriginType.Official
      || item.originType === QuestionOriginType.Imported
      || item.originType === QuestionOriginType.UserCreated
    ));
    const plannedModules = new Set((plan?.items ?? []).map((item) => nodeById.get(item.capabilityNodeId)?.module).filter(Boolean));
    return {
      policyVersion: TUTOR_CONTEXT_POLICY_VERSION,
      generatedAt: now,
      calendar: {
        today: planDate,
        timeZone: cycle.examCycle.timeZone,
        now: now as number,
        daysUntilExam,
        examDate: cycle.examCycle.examDate,
        examStatus: daysUntilExam < 0 ? 'passed' : daysUntilExam === 0 ? 'today' : 'upcoming'
      },
      profile: {
        examCycleId: cycle.examCycle.id,
        examName: cycle.examCycle.examName ?? cycle.examCycle.examType,
        examDate: cycle.examCycle.examDate,
        today: planDate,
        daysUntilExam,
        phase: cycle.examCycle.phase,
        availableMinutes: isWeekend(planDate) ? cycle.studyConstraints.weekendMinutes : cycle.studyConstraints.weekdayMinutes,
        scoreTargets: cycle.scoreTargets.filter((target) => target.status === 'active').map((target) => {
          const current = latestScore(cycle.scoreMeasurements, target.subject);
          return {
            subject: target.subject,
            currentScore: current?.score ?? null,
            targetScore: target.targetScore,
            maxScore: target.maxScore,
            gap: current ? Math.round((target.targetScore - current.score) * 10) / 10 : null,
            confidence: current?.confidence ?? 0
          };
        })
      },
      todayPlan: plan ? {
        planId: plan.plan.id,
        date: plan.plan.planDate,
        status: plan.plan.status,
        decisionSummary: plan.plan.decisionSummary,
        items: plan.items.slice(0, 8).map((item) => ({
          dailyPlanItemId: item.id,
          capability: capabilityView(item.capabilityNodeId, nodeById),
          itemType: item.itemType,
          targetMinutes: item.targetMinutes,
          targetCount: item.targetCount ?? null,
          reason: item.reason,
          status: item.status
        }))
      } : { status: 'missing', items: [] },
      priorityCapabilities: priorities.map((priority) => ({
        ...capabilityView(priority.capabilityNodeId, nodeById),
        priority: priority.priority,
        recommendedAction: priority.action,
        reasonCodes: [...priority.reasonCodes],
        state: priority.state,
        accuracy: priority.accuracy,
        speed: priority.speed,
        retention: priority.retention,
        transfer: priority.transfer,
        stability: priority.stability,
        confidence: priority.confidence,
        effectiveSample: priority.effectiveSample,
        evidenceAgeDays: priority.evidenceAgeDays ?? null,
        learningStatus: priority.learningStatus ?? null
      })),
      dueReviews: reviews.map((review) => ({
        reviewQueueItemId: review.id,
        capability: capabilityView(review.capabilityNodeId, nodeById),
        reviewType: review.reviewType,
        dueAt: review.dueAt,
        priority: review.priority,
        reason: review.reason
      })),
      activeThreads: openThreads.filter(Boolean).map((aggregate) => ({
        learningThreadId: aggregate!.thread.id,
        capability: capabilityView(aggregate!.thread.primaryCapabilityNodeId, nodeById),
        stage: aggregate!.thread.stage,
        goal: aggregate!.thread.goal,
        nextAction: aggregate!.thread.nextAction ?? null
      })),
      recentEvidence: evidence,
      trueQuestionEvidence: {
        recentSessionCount: trueQuestionSessions.length,
        latest: trueQuestionSessions[0] ?? null,
        availableSetCount: trueQuestionSets.length,
        availableQuestionCount: trueQuestionSets.reduce((sum, item) => sum + item.questionCount, 0),
        availableByCapability: capabilityIds.map((capabilityNodeId) => ({
          capabilityNodeId,
          setCount: trueQuestionSets.filter((item) => item.capabilityNodeId === capabilityNodeId).length,
          questionCount: trueQuestionSets.filter((item) => item.capabilityNodeId === capabilityNodeId).reduce((sum, item) => sum + item.questionCount, 0)
        })),
        note: trueQuestionSessions.length
          ? '存在近期真题或用户导入题作答证据。'
          : trueQuestionSets.length
            ? '当前优先能力有真题资源，但最小近期窗口内没有作答证据，不能宣称已完成真题校准。'
            : '当前优先能力没有可用真题资源，也没有近期真题作答证据。'
      },
      abilityCalibration: calibration ? {
        algorithmVersion: calibration.algorithmVersion,
        baseline: calibration.baseline,
        modules: calibration.modules,
        scoreForecasts: calibration.scoreForecasts,
        changes: calibration.changes
      } as JsonObject : { status: 'missing' },
      recentTeachingConclusions: recentConclusions.map((item) => ({
        conclusionId: item.id,
        learningSessionId: item.learningSessionId,
        capabilityNodeIds: [...item.capabilityNodeIds],
        diagnosis: item.diagnosis,
        assessment: item.assessment,
        schedule: item.schedule,
        createdAt: item.createdAt
      })),
      confirmation: {
        requiredWhen: ['missing_capability_scope', 'multiple_matching_capabilities', 'cross_module_action'],
        crossModulePlan: plannedModules.size > 1,
        instruction: '用户请求未明确能力范围或动作跨模块时，先列出最多三个候选并确认，不得静默替用户选择。'
      }
    };
  }
}

function capabilityView(id: string | undefined, nodes: ReadonlyMap<string, { readonly code:string;readonly name:string;readonly module:string;readonly subject:string }>): JsonObject {
  const node = id ? nodes.get(id) : undefined;
  return { capabilityNodeId: id ?? null, code: node?.code ?? null, name: node?.name ?? null, module: node?.module ?? null, subject: node?.subject ?? null };
}

function ratio(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 10_000) / 10_000 : null;
}

function localDate(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function daysBetweenLocalDates(start: string, end: string): number {
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.round((endMs - startMs) / 86_400_000);
}

function latestScore(
  measurements: readonly { readonly subject:string;readonly score:number;readonly confidence:number;readonly measuredAt:number }[],
  subject: string
) {
  return measurements.filter((item) => item.subject === subject)
    .sort((left, right) => right.measuredAt - left.measuredAt)[0];
}
