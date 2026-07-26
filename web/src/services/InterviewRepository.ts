import { initializeTutorRuntime } from '@/composition-root/public';
import type { JsonObject } from '@/kernel/public';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import type {
  InterviewAnswer,
  InterviewDifficulty,
  InterviewQuestion,
  InterviewQuestionType,
  InterviewScore,
  InterviewSession,
  InterviewStats,
  InterviewType
} from '@/domain/interview';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';

export const INTERVIEW_QUESTION_TYPES: InterviewQuestionType[] = ['综合分析', '计划组织', '人际沟通', '应急应变', '岗位匹配'];

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

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function fluencyScore(answer: InterviewAnswer): number | undefined {
  if (!answer.speechMetrics) return undefined;
  const { wordsPerMinute, fillerCount, durationSeconds } = answer.speechMetrics;
  let score = 3;
  if (wordsPerMinute >= 120 && wordsPerMinute <= 220) score += 1;
  if (durationSeconds >= 45) score += 1;
  if (fillerCount >= 6) score -= 1;
  return Math.max(1, Math.min(5, score));
}

function scoreAnswer(answer: InterviewAnswer): InterviewScore {
  const fluency = fluencyScore(answer);
  const maxTotal = fluency ? 20 : 15;
  const rawAnswer = answer.transcript || answer.answer;
  const text = rawAnswer.trim();
  if (!text) return { content: 1, expression: 1, logic: 1, fluency, total: 3, feedback: '未作答，建议先按“观点-分析-对策-总结”补齐基本框架。' };
  const hasStructure = /首先|其次|再次|最后|第一|第二|第三|一方面|另一方面/.test(text);
  const hasExample = /比如|例如|举例|案例|经验|经历/.test(text);
  const hasSummary = /总之|综上|因此|所以|总的来说/.test(text);
  const content = Math.min(5, 2 + (text.length > 60 ? 1 : 0) + (text.length > 160 ? 1 : 0) + (hasExample ? 1 : 0));
  const expression = Math.min(5, 2 + (text.length > 40 ? 1 : 0) + (hasStructure ? 1 : 0) + (text.length > 120 && hasStructure ? 1 : 0));
  const logic = Math.min(5, 2 + (hasStructure ? 1 : 0) + (hasSummary ? 1 : 0) + (hasExample && hasStructure ? 1 : 0));
  const total = content + expression + logic + (fluency || 0);
  const feedback = total >= 12
    ? `作答优秀，内容充实、条理清晰${fluency ? '，语音表达可继续控制口头语。' : '，后续可继续提升表达亮点。'}`
    : total >= Math.round(maxTotal * 0.6)
      ? '作答良好，建议增加具体案例和结尾升华。'
      : '作答偏薄，建议加强结构化表达，并补充原因分析、对策和总结。';
  return { content, expression, logic, fluency, total, feedback };
}

function averageScore(scores: InterviewScore[]): InterviewScore {
  if (!scores.length) return { content: 1, expression: 1, logic: 1, total: 3, feedback: '暂无有效作答。' };
  const content = Math.round(scores.reduce((sum, score) => sum + score.content, 0) / scores.length);
  const expression = Math.round(scores.reduce((sum, score) => sum + score.expression, 0) / scores.length);
  const logic = Math.round(scores.reduce((sum, score) => sum + score.logic, 0) / scores.length);
  const fluencyScores = scores.map((score) => score.fluency).filter((score): score is number => typeof score === 'number');
  const fluency = fluencyScores.length ? Math.round(fluencyScores.reduce((sum, score) => sum + score, 0) / fluencyScores.length) : undefined;
  const total = content + expression + logic + (fluency || 0);
  const feedback = scores[scores.length - 1]?.feedback || '已完成本次面试模拟。';
  return { content, expression, logic, fluency, total, feedback };
}

export class InterviewRepository {
  pickQuestions(types: InterviewQuestionType[], count = 3): InterviewQuestion[] {
    const selected: InterviewQuestionType[] = types.length ? types : ['综合分析'];
    const pool = selected.flatMap((type) => BANK[type].map((item, index) => ({
      id: `${type}:${index}`,
      type,
      text: item.text,
      hint: item.hint
    })));
    return shuffle(pool).slice(0, count);
  }

  scoreAnswers(answers: InterviewAnswer[]): InterviewAnswer[] {
    return answers.map((answer) => ({
      ...answer,
      score: scoreAnswer(answer.skipped ? { ...answer, answer: '', transcript: '' } : answer)
    }));
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
    const scoredAnswers = this.scoreAnswers(input.answers);
    const score = averageScore(scoredAnswers.map((answer) => answer.score).filter(Boolean) as InterviewScore[]);
    const session: InterviewSession = {
      id: id('interview_session'),
      projectId: cycle.project.id,
      date: today(),
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      questionTypes: input.questionTypes,
      questionCount: input.answers.length,
      answers: scoredAnswers,
      score,
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

  async saveAiFeedback(sessionId: string, aiFeedback: string): Promise<InterviewSession | undefined> {
    const current = await this.getSession(sessionId);
    if (!current) return undefined;
    const next: InterviewSession = {
      ...current,
      aiFeedback,
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
    return generationTaskService.enqueue({
      intent: 'interviewReview',
      title: '面试深度点评',
      detail: `${session.date} · ${session.questionCount} 题 · ${session.score.total}分`,
      sourceId: session.id,
      payload: {
        sessionId: session.id
      }
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
    const averageScore = sessions.length ? Math.round(sessions.reduce((sum, session) => sum + session.score.total, 0) / sessions.length) : 0;
    return {
      totalSessions: sessions.length,
      averageScore,
      latest: sessions[0]
    };
  }
}

export const interviewRepository = new InterviewRepository();
