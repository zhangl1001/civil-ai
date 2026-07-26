import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ExamCycleId, InstantMs, JsonObject, LocalDate } from '@/kernel/public';
import type { DailyPlanItemStatus, DailyPlanItemType, DailyPlanStatus } from '../domain/DailyPlanCodes';

export interface DailyPlanRecord { readonly id:string;readonly examCycleId:ExamCycleId;readonly planDate:LocalDate;readonly version:number;readonly status:DailyPlanStatus;readonly phase:string;readonly availableMinutes:number;readonly decisionSummary:string;readonly decisionFactors:JsonObject;readonly createdBy:'system'|'tutor_ai'|'user';readonly createdAt:InstantMs;readonly supersedesPlanId?:string; }
export interface DailyPlanItemRecord {
  readonly id:string;
  readonly dailyPlanId:string;
  readonly capabilityNodeId:CapabilityNodeId;
  readonly reviewQueueItemId?:string;
  readonly itemType:DailyPlanItemType;
  readonly sequence:number;
  readonly targetMinutes:number;
  readonly targetCount?:number;
  readonly exitCriteria:JsonObject;
  readonly reason:string;
  readonly status:DailyPlanItemStatus;
  readonly actualMinutes:number;
  readonly resultSummary?:JsonObject;
  readonly failureCode?:string;
  readonly failureMessage?:string;
  readonly finishedAt?:InstantMs;
}
export interface DailyPlanAggregate { readonly plan:DailyPlanRecord;readonly items:readonly DailyPlanItemRecord[]; }
export interface DailyPlanRepository {
  findCurrent(examCycleId:ExamCycleId,planDate:LocalDate):Promise<DailyPlanAggregate|undefined>;
  listAll(examCycleId:ExamCycleId):Promise<readonly DailyPlanAggregate[]>;
  replaceCurrent(next:DailyPlanAggregate,previous:DailyPlanRecord|undefined,context:TransactionContext):Promise<void>;
  updateItemById(dailyPlanItemId:string,patch:DailyPlanItemStatusPatch,context:TransactionContext):Promise<DailyPlanItemRecord|undefined>;
  updateItemByReviewQueueId(reviewQueueItemId:string,patch:DailyPlanItemStatusPatch,context:TransactionContext):Promise<DailyPlanItemRecord|undefined>;
}
export interface DailyPlanItemStatusPatch {
  readonly status:DailyPlanItemStatus;
  readonly actualMinutes?:number;
  readonly resultSummary?:JsonObject;
  readonly failureCode?:string;
  readonly failureMessage?:string;
  readonly finishedAt?:InstantMs;
}
