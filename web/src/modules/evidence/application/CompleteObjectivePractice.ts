import type { JsonObject } from '@/kernel/public';
import type { SubmitObjectiveSessionCommand, ObjectiveSessionSubmissionResult } from './SubmitObjectiveSession';
import { GetObjectiveSessionReview } from './GetObjectiveSessionReview';
import { RequestAiErrorDiagnosis } from './RequestAiErrorDiagnosis';
import { SubmitObjectiveSession } from './SubmitObjectiveSession';

interface MasteryRefreshPort {
  execute(command: { readonly examCycleId: string; readonly capabilityNodeId: string }): Promise<unknown>;
}
interface ReviewCompletionPort { execute(reviewQueueItemId: string): Promise<unknown>; }
interface DailyPlanItemStatusPort { execute(command: { readonly reviewQueueItemId: string; readonly status: 'completed'; readonly actualMinutes: number }): Promise<unknown>; }

export interface CompleteObjectivePracticeResult extends ObjectiveSessionSubmissionResult {
  readonly diagnosisRunIds: readonly string[];
}
/** Feature-facing orchestration: deterministic grading first, asynchronous AI diagnosis second. */
export class CompleteObjectivePractice {
  constructor(private readonly submit:SubmitObjectiveSession,private readonly review:GetObjectiveSessionReview,private readonly requestDiagnosis:RequestAiErrorDiagnosis,private readonly refreshMastery?:MasteryRefreshPort,private readonly completeReview?:ReviewCompletionPort,private readonly updateDailyPlanItem?:DailyPlanItemStatusPort){}
  async execute(command:SubmitObjectiveSessionCommand,contexts:Readonly<Record<string,JsonObject>>={}):Promise<CompleteObjectivePracticeResult>{
    const result=await this.submit.execute(command);if(command.reviewQueueItemId){await this.completeReview?.execute(command.reviewQueueItemId);await this.updateDailyPlanItem?.execute({reviewQueueItemId:command.reviewQueueItemId,status:'completed',actualMinutes:Math.max(1,Math.round(command.elapsedMs/60000))});}await this.refreshMastery?.execute({examCycleId:result.examCycleId,capabilityNodeId:result.capabilityNodeId});const review=await this.review.execute(result.sessionId);if(!review)throw new Error(`Objective session review is unavailable: ${result.sessionId}`);
    const runs=await Promise.all(review.items.filter(item=>item.grading.result==='incorrect').flatMap(item=>item.diagnoses.filter(diagnosis=>diagnosis.source==='deterministic'&&diagnosis.causeCode==='unknown').map(diagnosis=>this.requestDiagnosis.execute({idempotencyKey:`${command.idempotencyKey}:ai-diagnosis:${diagnosis.id}`,provisionalDiagnosisId:diagnosis.id,evidenceContext:contexts[item.question.id]??{}}))));
    return {...result,diagnosisRunIds:runs.map(run=>run.run.id)};
  }
}
