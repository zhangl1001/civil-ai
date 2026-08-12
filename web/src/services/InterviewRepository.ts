import { initializeTutorRuntime } from '@/composition-root/public';
import type { JsonObject } from '@/kernel/public';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import type {
  InterviewAnswer,
  InterviewDifficulty,
  InterviewQuestion,
  InterviewQuestionType,
  InterviewSession,
  InterviewStats,
  InterviewType
} from '@/domain/interview';
import {
  INTERVIEW_QUESTION_TYPES,
  pickInterviewQuestions,
  prepareInterviewAnswers
} from '@/domain/interview';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';

export { INTERVIEW_QUESTION_TYPES } from '@/domain/interview';

const BANK: Record<InterviewQuestionType, Array<{ text: string; hint: string }>> = {
  综合分析: [
    { text: '有人说“细节决定成败”，也有人说“成大事者不拘小节”，你怎么看？', hint: '从辩证角度分析，说明不同情境下的适用性。' },
    { text: '如何看待人工智能对就业市场的影响？', hint: '分析机遇与挑战，提出个人和社会应对策略。' },
    { text: '当前很多年轻人选择“躺平”，你如何看待？', hint: '从社会压力、价值观多元和个人奋斗角度分析。' }
  ],
  计划组织: [
    { text: '领导让你组织一次单位内部读书分享活动，你会怎么做？', hint: '按事前准备、事中实施、事后总结展开。' },
    { text: '社区要开展环保宣传活动，请制定活动方案。', hint: '明确目标、对象、形式、资源和效果评估。' },
    { text: '单位要组织新员工培训，你会如何策划？', hint: '从需求调研、课程设计、组织保障和反馈评估展开。' }
  ],
  人际沟通: [
    { text: '领导安排你和一位与你有矛盾的同事合作完成项目，你怎么办？', hint: '以大局为重，主动沟通，明确分工。' },
    { text: '群众来办事时情绪激动，对你大声指责，你怎么办？', hint: '保持冷静、倾听诉求、依法依规处理。' },
    { text: '你的同事工作失误却把责任推给你，你怎么办？', hint: '先解决问题，再澄清事实，维护团队关系。' }
  ],
  应急应变: [
    { text: '你正在主持重要会议，突然停电了，你怎么办？', hint: '保持镇定、安抚参会者、启动应急预案。' },
    { text: '窗口值班时，一位群众突然晕倒，你怎么办？', hint: '立即施救、呼叫急救、维护秩序、报告领导。' },
    { text: '网上出现关于你单位的负面舆情，领导让你处理，你怎么办？', hint: '快速核实、及时回应、正面引导、总结改进。' }
  ],
  岗位匹配: [
    { text: '你为什么报考公务员？', hint: '结合个人理想、能力匹配和服务意愿真诚回答。' },
    { text: '你认为自己有哪些优势和不足？', hint: '优势要具体，不足要真诚且有改进措施。' },
    { text: '你如何理解“为人民服务”？', hint: '结合岗位实际，体现服务意识和责任感。' }
  ]
};

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function businessKey(sessionId: string): string {
  return `interview:${sessionId}`;
}

export class InterviewRepository {
  pickQuestions(
    types: InterviewQuestionType[],
    count = 3,
    excludedIds: ReadonlySet<string> = new Set(),
    generatedQuestions: readonly InterviewQuestion[] = []
  ): InterviewQuestion[] {
    const selected: InterviewQuestionType[] = types.length ? types : ['综合分析'];
    const builtInPool = selected.flatMap((type) => BANK[type].map((item, index) => ({
      id: `${type}:${index}`,
      type,
      text: item.text,
      hint: item.hint
    })));
    return pickInterviewQuestions({
      selectedTypes: selected,
      count,
      excludedIds,
      generatedQuestions,
      fallbackQuestions: builtInPool
    });
  }

  async questionPool(limit = 160): Promise<InterviewQuestion[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return [];
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.InterviewQuestionPool],
      status: LearningAssetStatus.Ready,
      limit: 20
    });
    const seen = new Set<string>();
    return assets.flatMap((asset) => {
      const payload = asset.payload as { questions?: unknown };
      if (!Array.isArray(payload.questions)) return [];
      return payload.questions.flatMap((value) => {
        const question = value as Partial<InterviewQuestion>;
        const fingerprint = typeof question.text === 'string' ? question.text.replace(/\s+/g, '') : '';
        if (
          !question.id
          || !question.type
          || !INTERVIEW_QUESTION_TYPES.includes(question.type)
          || !question.text
          || !question.hint
          || !fingerprint
          || seen.has(fingerprint)
        ) return [];
        seen.add(fingerprint);
        return [question as InterviewQuestion];
      });
    }).slice(0, limit);
  }

  async ensureQuestionPool(
    types: InterviewQuestionType[],
    difficulty: InterviewDifficulty,
    excludedIds: ReadonlySet<string>
  ): Promise<AgentTaskEnqueueResult | undefined> {
    const generatedQuestions = await this.questionPool();
    const selectedTypes = types.length ? types : INTERVIEW_QUESTION_TYPES;
    const reusableCount = generatedQuestions.filter((question) => (
      selectedTypes.includes(question.type) && !excludedIds.has(question.id)
    )).length;
    if (reusableCount >= 12) return undefined;
    return generationTaskService.enqueue({
      intent: 'interviewQuestions',
      title: '补充面试题库',
      detail: '后台准备新的结构化面试训练题',
      sourceId: 'interview-question-pool',
      payload: {
        questionTypes: selectedTypes,
        difficulty,
        questionCount: 15,
        recentQuestions: generatedQuestions.slice(0, 40).map((question) => question.text)
      }
    });
  }

  prepareAnswers(answers: InterviewAnswer[]): InterviewAnswer[] {
    return prepareInterviewAnswers(answers);
  }

  async saveSession(input: {
    interviewType: InterviewType;
    difficulty: InterviewDifficulty;
    questionTypes: InterviewQuestionType[];
    answers: InterviewAnswer[];
  }): Promise<InterviewSession> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const now = Date.now();
    const preparedAnswers = this.prepareAnswers(input.answers);
    const session: InterviewSession = {
      id: id('interview_session'),
      projectId: cycle.project.id,
      date: today(),
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      questionTypes: input.questionTypes,
      questionCount: input.answers.length,
      answers: preparedAnswers,
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now
    };
    await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.InterviewSession,
      businessKey: businessKey(session.id),
      title: `面试训练 · ${session.date}`,
      payload: session as unknown as JsonObject
    });
    return session;
  }

  async getSession(sessionId: string): Promise<InterviewSession | undefined> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    const asset = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.InterviewSession,
      businessKey(sessionId)
    );
    return asset?.payload as unknown as InterviewSession | undefined;
  }

  async updateReviewState(
    sessionId: string,
    reviewStatus: InterviewSession['reviewStatus'],
    reviewTaskId?: string
  ): Promise<InterviewSession | undefined> {
    const current = await this.getSession(sessionId);
    if (!current) return undefined;
    const next: InterviewSession = {
      ...current,
      reviewStatus,
      ...(reviewTaskId ? { reviewTaskId } : {}),
      updatedAt: Date.now()
    };
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.InterviewSession,
      businessKey: businessKey(sessionId),
      title: `面试训练 · ${next.date}`,
      payload: next as unknown as JsonObject
    });
    return next;
  }

  async enqueueAiReview(session: InterviewSession): Promise<AgentTaskEnqueueResult> {
    const result = await generationTaskService.enqueue({
      intent: 'interviewReview',
      title: '面试深度点评',
      detail: `${session.date} · ${session.questionCount} 题`,
      sourceId: session.id,
      payload: {
        sessionId: session.id
      }
    });
    await this.attachReviewTask(session.id, result.task.id);
    return result;
  }

  private async attachReviewTask(sessionId: string, reviewTaskId: string): Promise<void> {
    const current = await this.getSession(sessionId);
    if (!current || current.reviewTaskId === reviewTaskId) return;
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const next: InterviewSession = {
      ...current,
      reviewTaskId,
      updatedAt: Date.now()
    };
    await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.InterviewSession,
      businessKey: businessKey(sessionId),
      title: `面试训练 · ${next.date}`,
      payload: next as unknown as JsonObject
    });
  }

  async latest(limit = 5): Promise<InterviewSession[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return [];
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.InterviewSession],
      status: LearningAssetStatus.Ready,
      limit: Math.min(500, Math.max(limit * 4, 20))
    });
    const latest = new Map<string, InterviewSession>();
    assets.forEach((asset) => {
      if (!latest.has(asset.businessKey)) {
        latest.set(asset.businessKey, asset.payload as unknown as InterviewSession);
      }
    });
    return Array.from(latest.values())
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  }

  async stats(): Promise<InterviewStats> {
    const sessions = await this.latest(500);
    const reviewed = sessions.filter((session) => session.reviewStatus === 'completed' && session.score);
    const averageScore = reviewed.length
      ? Math.round(reviewed.reduce((sum, session) => sum + (session.score?.total ?? 0), 0) / reviewed.length)
      : 0;
    return {
      totalSessions: sessions.length,
      averageScore,
      latest: sessions[0]
    };
  }
}

export const interviewRepository = new InterviewRepository();
