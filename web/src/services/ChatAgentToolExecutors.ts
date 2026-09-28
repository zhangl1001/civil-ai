import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type {
  QuestionImportCandidateId,
  QuestionImportDraftId,
  SubjectCode
} from '@/kernel/public';
import {
  agentExternalToolCatalog,
  RegisteredAgentToolExecutor
} from '@/modules/agent/public';
import { aiBusinessTools, type AIBusinessToolName } from './AIBusinessTools';
import { AIPracticeLibraryService } from './AIPracticeLibraryService';
import {
  agentRunCompletionExpectation,
  agentRunCompletionVerification
} from './AgentCompletionEvidence';
import { agentConversationMemoryService, type RememberAgentPreferenceInput } from './AgentConversationMemoryService';
import { agentFileReader } from './AgentFileReader';
import { readDeviceClock } from './AgentSystemTools';
import { agentWorkspaceQueryService } from './AgentWorkspaceQueryService';
import { chatAgentBusinessTools, chatAgentMemoryTools } from './ChatAgentCapabilities';
import {
  asJsonRecord,
  isWeekend,
  normalizeFreshness,
  optionalNumber,
  optionalString
} from './ChatAgentRuntimeSupport';
import { registerChatAgentSkillSelector } from './ChatAgentSkillSelector';
import { QuestionImportAgentService } from './QuestionImportAgentService';
import { registerQuestionImportRepairTool } from './RegisterQuestionImportRepairTool';
import { webResearchService } from './WebResearchService';

/** Registers every chat Agent tool handler for one chat session. */
export function createChatAgentToolExecutor(
  runtime: TutorDatabaseRuntime,
  sessionId: string
): RegisteredAgentToolExecutor {
  const executor = new RegisteredAgentToolExecutor();
  const practiceLibrary = new AIPracticeLibraryService();
  const questionImport = new QuestionImportAgentService({
    candidates: runtime.candidateRepository,
    curriculums: runtime.curriculumRepository,
    scanDraft: runtime.scanQuestionImportDraft
  });
  registerChatAgentSkillSelector(executor);
  chatAgentBusinessTools.forEach((definition) => {
    executor.register(definition.name, async (call, context) => {
      const result = await aiBusinessTools.execute({
        name: call.name as AIBusinessToolName,
        arguments: call.arguments
      }, { sessionId, idempotencyKey: context.businessIdempotencyKey });
      return {
        content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
        resultRef: result.taskId,
        ...agentRunCompletionExpectation(result.taskId)
      };
    });
  });
  agentExternalToolCatalog.forEach((definition) => {
    if (definition.name === 'web.search') {
      executor.register(definition.name, async (call, context) => {
        const result = await webResearchService.searchForAgentRun({
          agentRunId: context.agentRunId,
          query: String(call.arguments.query || ''),
          freshness: normalizeFreshness(call.arguments.freshness),
          limit: Number(call.arguments.limit || 5),
          signal: context.signal
        });
        return {
          content: JSON.stringify({
            query: result.query,
            fetchedAt: result.fetchedAt,
            results: result.hits.map((hit) => ({
              title: hit.title,
              url: hit.url,
              domain: hit.domain,
              snippet: (hit.snippet || hit.content || '').slice(0, 1_800),
              publishedAt: hit.publishedAt ?? null
            }))
          }),
          resultRef: result.hits[0]?.url,
          madeProgress: result.hits.length > 0
        };
      });
      return;
    }
    executor.register(definition.name, async (call, context) => {
      const page = await webResearchService.readPageForAgentRun({
        agentRunId: context.agentRunId,
        url: String(call.arguments.url || ''),
        focus: optionalString(call.arguments.focus),
        offset: optionalNumber(call.arguments.offset),
        signal: context.signal
      });
      return {
        content: JSON.stringify(page),
        resultRef: page.url
      };
    });
  });
  chatAgentMemoryTools.forEach((definition) => {
    if (definition.name === 'memory.remember') {
      executor.register(definition.name, async (call) => {
        const record = await agentConversationMemoryService.remember(runtime, sessionId, {
          memoryCode: String(call.arguments.memoryCode || '') as RememberAgentPreferenceInput['memoryCode'],
          statement: String(call.arguments.statement || ''),
          scope: String(call.arguments.scope || '') as RememberAgentPreferenceInput['scope'],
          confidence: optionalNumber(call.arguments.confidence)
        });
        return {
          content: JSON.stringify({ remembered: true, memoryCode: record.memoryCode }),
          resultRef: record.id,
          madeProgress: true
        };
      });
      return;
    }
    executor.register(definition.name, async (call) => {
      const forgotten = await agentConversationMemoryService.forget(
        runtime,
        sessionId,
        String(call.arguments.memoryCode || '') as RememberAgentPreferenceInput['memoryCode'],
        String(call.arguments.scope || '') as RememberAgentPreferenceInput['scope']
      );
      return {
        content: JSON.stringify({ forgotten }),
        madeProgress: true
      };
    });
  });
  executor.register('system.read_clock', async () => readDeviceClock());
  executor.register('tutor.read_daily_context', async () => {
    const context = await runtime.buildTutorDailyContext.execute();
    if (!context) throw new Error('请先建立备考档案。');
    return {
      content: JSON.stringify(context),
      resultRef: String(context.profile.examCycleId || '') || undefined
    };
  });
  executor.register('student.read_profile', async () => {
    const [home, cycle] = await Promise.all([
      runtime.getCandidateHome.execute(),
      runtime.candidateRepository.findCurrentCycle()
    ]);
    const tracks = cycle ? await runtime.masteryRepository.listPriorityTracks(cycle.examCycle.id, 8) : [];
    return {
      content: JSON.stringify({
        candidate: home,
        priorityCapabilities: tracks.map((track) => ({
          capabilityNodeId: track.capabilityNodeId,
          state: track.state,
          accuracy: track.accuracy,
          stability: track.stability,
          confidence: track.confidence,
          effectiveSample: track.effectiveSample
        }))
      }),
      resultRef: home?.examCycleId
    };
  });
  executor.register('workspace.discover', async (call) => ({
    content: JSON.stringify(await agentWorkspaceQueryService.discover(runtime, {
      resourceType: String(call.arguments.resourceType || '') as Parameters<typeof agentWorkspaceQueryService.discover>[1]['resourceType'],
      scope: String(call.arguments.scope || '') as Parameters<typeof agentWorkspaceQueryService.discover>[1]['scope'],
      keyword: optionalString(call.arguments.keyword),
      limit: optionalNumber(call.arguments.limit)
    }))
  }));
  executor.register('task.read_status', async (call) => {
    const result = await agentWorkspaceQueryService.readTaskStatus(runtime, {
      taskId: optionalString(call.arguments.taskId),
      scope: optionalString(call.arguments.scope) as Parameters<typeof agentWorkspaceQueryService.readTaskStatus>[1]['scope'],
      intent: optionalString(call.arguments.intent),
      limit: optionalNumber(call.arguments.limit)
    });
    const task = result.task && typeof result.task === 'object' && !Array.isArray(result.task)
      ? result.task as Record<string, unknown>
      : undefined;
    return {
      content: JSON.stringify(result),
      resultRef: typeof task?.taskId === 'string' ? task.taskId : undefined,
      madeProgress: true,
      completionVerification: agentRunCompletionVerification(result, optionalString(call.arguments.taskId))
    };
  });
  executor.register('practice.read_library', async (call) => {
    const snapshot = await practiceLibrary.read(runtime, {
      scope: String(call.arguments.scope || '') as Parameters<AIPracticeLibraryService['read']>[1]['scope'],
      entryMode: String(call.arguments.entryMode || 'all') as Parameters<AIPracticeLibraryService['read']>[1]['entryMode'],
      module: String(call.arguments.module || ''),
      capabilityKeyword: String(call.arguments.capabilityKeyword || ''),
      limit: Number(call.arguments.limit || 5)
    });
    return {
      content: JSON.stringify(snapshot),
      resultRef: snapshot.sets[0]?.questionSetId || snapshot.activeTasks[0]?.taskId
    };
  });
  executor.register('practice.read_question_set', async (call) => {
    const result = await practiceLibrary.readQuestionSet(runtime, {
      questionSetId: String(call.arguments.questionSetId || ''),
      section: String(call.arguments.section || '') as Parameters<AIPracticeLibraryService['readQuestionSet']>[1]['section'],
      offset: Number(call.arguments.offset || 0),
      limit: Number(call.arguments.limit || 3)
    });
    return {
      content: JSON.stringify(result),
      resultRef: String(call.arguments.questionSetId || '')
    };
  });
  executor.register('learning.review_session', async (call) => {
    const sessionId = String(call.arguments.sessionId || '').trim();
    if (!sessionId) throw new Error('读取练习复盘需要明确 sessionId。');
    const review = await runtime.getObjectiveSessionReview.execute(
      sessionId as Parameters<TutorDatabaseRuntime['getObjectiveSessionReview']['execute']>[0]
    );
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!review || !cycle || review.session.examCycleId !== cycle.examCycle.id) {
      throw new Error('当前备考档案中没有找到该练习记录。');
    }
    return {
      content: JSON.stringify({
        session: {
          sessionId: review.session.id,
          questionSetId: review.session.questionSetId,
          completedAt: review.session.completedAt,
          questionCount: review.session.questionCount,
          answeredCount: review.session.answeredCount,
          correctCount: review.session.correctCount
        },
        items: review.items.map((item) => ({
          questionId: item.question.id,
          sequence: item.question.sequence,
          result: item.grading.result,
          diagnoses: item.diagnoses
            .filter((diagnosis) => diagnosis.source === 'tutor_ai' || diagnosis.source === 'user')
            .map((diagnosis) => ({
              causeCode: diagnosis.causeCode,
              detail: diagnosis.detail,
              confidence: diagnosis.confidence,
              confirmationStatus: diagnosis.confirmationStatus
            }))
        }))
      }),
      resultRef: review.session.id
    };
  });
  executor.register('teaching.request_practice', async (call, context) => {
    const result = await aiBusinessTools.execute({
      name: 'generate_practice',
      arguments: {
        module: call.arguments.module,
        knowledgePoint: call.arguments.knowledgePoint,
        questionCount: call.arguments.questionCount,
        difficulty: call.arguments.difficulty
      }
    }, { sessionId, idempotencyKey: context.businessIdempotencyKey });
    return {
      content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
      resultRef: result.taskId,
      ...agentRunCompletionExpectation(result.taskId)
    };
  });
  executor.register('file.read_text', (call) => agentFileReader.read(call.arguments));
  executor.register('question_bank.scan', async (call, context) => {
    context.signal?.throwIfAborted();
    const view = await questionImport.scan(call.arguments, {
      agentRunId: context.agentRunId,
      callId: call.id,
      ownerSessionId: sessionId,
      importedBy: 'chat_agent'
    });
    return { content: JSON.stringify(view), resultRef: view.draftId };
  });
  executor.register('question_bank.resume', async () => {
    const aggregate = await runtime.questionImportDraftRepository.findLatestPendingByOwner(sessionId);
    if (!aggregate) {
      return { content: JSON.stringify({ found: false }), terminalText: '上一次没有生成可继续的题库草稿，且历史图片已失效。请重新选择原 PDF 或题目图片后再导入。' };
    }
    return {
      content: JSON.stringify({
        found: true,
        draftId: aggregate.draft.id,
        status: aggregate.draft.status,
        version: aggregate.draft.version,
        source: {
          sourceType: aggregate.draft.sourceType,
          examYear: aggregate.draft.sourceMetadata.examYear ?? null,
          paperName: aggregate.draft.sourceMetadata.paperName ?? null
        },
        candidates: aggregate.candidates.map((candidate) => ({
          candidateId: candidate.id,
          sequence: candidate.sequence,
          status: candidate.status,
          issues: candidate.issues
        }))
      }),
      resultRef: aggregate.draft.id
    };
  });
  registerQuestionImportRepairTool(executor, runtime);
  executor.register('question_bank.confirm', async (call, context) => {
    context.signal?.throwIfAborted();
    const replacements = Array.isArray(call.arguments.replacements)
      ? call.arguments.replacements.map((item) => {
          const row = asJsonRecord(item);
          return {
            candidateId: String(row.candidateId || '') as QuestionImportCandidateId,
            raw: asJsonRecord(row.question),
            difficulty: optionalNumber(asJsonRecord(row.question).difficulty)
          };
        })
      : [];
    const rejectedCandidateIds = Array.isArray(call.arguments.rejectedCandidateIds)
      ? call.arguments.rejectedCandidateIds.map((id) => String(id) as QuestionImportCandidateId)
      : [];
    const view = await runtime.confirmQuestionImportDraft.execute({
      draftId: String(call.arguments.draftId || '') as QuestionImportDraftId,
      expectedVersion: Number(call.arguments.expectedVersion),
      replacements,
      rejectedCandidateIds
    });
    return { content: JSON.stringify(view), resultRef: view.draftId };
  });
  executor.register('question_bank.publish', async (call, context) => {
    context.signal?.throwIfAborted();
    const result = await runtime.publishQuestionImportDraft.execute({
      draftId: String(call.arguments.draftId || '') as QuestionImportDraftId,
      expectedVersion: Number(call.arguments.expectedVersion),
      idempotencyKey: context.businessIdempotencyKey ?? `chat-agent:${context.agentRunId}:${call.id}:question-publish`
    });
    return { content: JSON.stringify(result), resultRef: result.questionSetId };
  });
  executor.register('planning.propose_daily_plan', async () => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const minutes = isWeekend() ? cycle.studyConstraints.weekendMinutes : cycle.studyConstraints.weekdayMinutes;
    const proposal = await runtime.buildDailyPlanProposal.execute({
      examCycleId: cycle.examCycle.id,
      availableMinutes: Math.max(5, minutes),
      examDate: cycle.examCycle.examDate,
      phase: cycle.examCycle.phase
    });
    return { content: JSON.stringify(proposal), resultRef: cycle.examCycle.id };
  });
  executor.register('candidate.change_target', async (call, context) => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const subject = String(call.arguments.subject || '') as SubjectCode;
    const previous = cycle.scoreTargets.find((target) => target.subject === subject && target.status === 'active');
    if (!previous) throw new Error('没有找到对应科目的当前目标。');
    const targetScore = Number(call.arguments.targetScore);
    await runtime.updateScoreTargets.execute({
      idempotencyKey: context.businessIdempotencyKey ?? `chat-agent:${sessionId}:target:${subject}:${targetScore}`,
      examCycleId: cycle.examCycle.id,
      changes: [{
        subject,
        targetScore,
        maxScore: previous.maxScore,
        reason: '用户在 AI 对话中确认修改'
      }]
    });
    return {
      content: JSON.stringify({ subject, targetScore, updated: true }),
      resultRef: cycle.examCycle.id
    };
  });
  return executor;
}
