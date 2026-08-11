import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, LocalDate } from '@/kernel/public';
import type {
  DailyPlanAggregate,
  DailyPlanBlockRecord,
  DailyPlanItemRecord,
  DailyPlanItemStatusPatch,
  DailyPlanRecord,
  DailyPlanRepository
} from '../contracts/DailyPlanRepository';

interface PlanRow extends SqlRow {
  id:string; exam_cycle_id:string; plan_date:string; version:number; status:DailyPlanRecord['status']; phase:string;
  available_minutes:number; decision_summary:string; decision_factors_json:string; created_by:DailyPlanRecord['createdBy'];
  created_at:number; supersedes_plan_id:string|null;
}

interface ItemRow extends SqlRow {
  id:string; daily_plan_id:string; daily_plan_block_id:string|null; learning_thread_id:string|null;
  capability_node_id:string; review_queue_item_id:string|null; item_category:DailyPlanItemRecord['category']; item_type:DailyPlanItemRecord['itemType'];
  sequence:number; target_minutes:number; target_count:number|null; priority:number; required:number;
  dependency_ids_json:string; exit_criteria_json:string; reason:string;
  status:DailyPlanItemRecord['status']; actual_minutes:number; result_summary_json:string|null;
  failure_code:string|null; failure_message:string|null; finished_at:number|null;
}

interface BlockRow extends SqlRow {
  id:string; daily_plan_id:string; capability_node_id:string; subject:DailyPlanBlockRecord['subject']; module:string;
  teaching_goal_code:string; sequence:number; priority:number; required:number;
}

export class SqliteDailyPlanRepository implements DailyPlanRepository {
  constructor(private readonly db: SqlDatabase, private readonly scope: SqlTransactionScope) {}

  async findCurrent(cycle: ExamCycleId, date: LocalDate): Promise<DailyPlanAggregate | undefined> {
    const rows = await this.db.query<PlanRow>(
      "SELECT * FROM daily_plans WHERE exam_cycle_id=? AND plan_date=? AND status='active' ORDER BY version DESC LIMIT 1",
      [cycle, date]
    );
    if (!rows[0]) return undefined;
    return this.loadAggregate(rows[0]);
  }

  async listAll(cycle: ExamCycleId): Promise<readonly DailyPlanAggregate[]> {
    const rows = await this.db.query<PlanRow>(
      'SELECT * FROM daily_plans WHERE exam_cycle_id=? ORDER BY created_at DESC,version DESC,id DESC',
      [cycle]
    );
    return Promise.all(rows.map((row) => this.loadAggregate(row)));
  }

  async replaceCurrent(next: DailyPlanAggregate, previous: DailyPlanRecord | undefined, context: TransactionContext): Promise<void> {
    const tx = this.scope.resolve(context);
    if (previous) {
      const result = await tx.run("UPDATE daily_plans SET status='superseded' WHERE id=? AND status='active'", [previous.id]);
      if (result.changes !== 1) throw new Error(`Daily plan version conflict: ${previous.id}`);
    }
    const p = next.plan;
    await tx.run(
      'INSERT INTO daily_plans(id,exam_cycle_id,plan_date,version,status,phase,available_minutes,decision_summary,decision_factors_json,created_by,created_at,supersedes_plan_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [p.id,p.examCycleId,p.planDate,p.version,p.status,p.phase,p.availableMinutes,p.decisionSummary,JSON.stringify(p.decisionFactors),p.createdBy,p.createdAt,p.supersedesPlanId??null]
    );
    for (const block of next.blocks) {
      await tx.run(
        'INSERT INTO daily_plan_blocks(id,daily_plan_id,capability_node_id,subject,module,teaching_goal_code,sequence,priority,required) VALUES (?,?,?,?,?,?,?,?,?)',
        [block.id,block.dailyPlanId,block.capabilityNodeId,block.subject,block.module,block.teachingGoalCode,block.sequence,block.priority,block.required?1:0]
      );
    }
    for (const i of next.items) {
      await tx.run(
        'INSERT INTO daily_plan_items(id,daily_plan_id,daily_plan_block_id,learning_thread_id,capability_node_id,review_queue_item_id,item_category,item_type,sequence,target_minutes,target_count,priority,required,dependency_ids_json,exit_criteria_json,reason,status,actual_minutes,result_summary_json,failure_code,failure_message,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [i.id,i.dailyPlanId,i.dailyPlanBlockId,i.learningThreadId??null,i.capabilityNodeId,i.reviewQueueItemId??null,i.category,i.itemType,i.sequence,i.targetMinutes,i.targetCount??null,i.priority,i.required?1:0,JSON.stringify(i.dependencyIds),JSON.stringify(i.exitCriteria),i.reason,i.status,i.actualMinutes,i.resultSummary?JSON.stringify(i.resultSummary):null,i.failureCode??null,i.failureMessage??null,i.finishedAt??null]
      );
    }
  }

  async updateItemById(dailyPlanItemId: string, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    const transaction = this.scope.resolve(context);
    const rows = await transaction.query<ItemRow>(
      "SELECT i.* FROM daily_plan_items i JOIN daily_plans p ON p.id=i.daily_plan_id WHERE i.id=? AND p.status='active' LIMIT 1",
      [dailyPlanItemId]
    );
    return this.updateItem(rows[0], patch, context);
  }

  async updateItemByReviewQueueId(reviewQueueItemId: string, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    const transaction = this.scope.resolve(context);
    const rows = await transaction.query<ItemRow>(
      "SELECT i.* FROM daily_plan_items i JOIN daily_plans p ON p.id=i.daily_plan_id WHERE i.review_queue_item_id=? AND p.status='active' ORDER BY p.version DESC, i.sequence LIMIT 1",
      [reviewQueueItemId]
    );
    return this.updateItem(rows[0], patch, context);
  }

  private async updateItem(row: ItemRow | undefined, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    if (!row) return undefined;
    const current = item(row);
    const actualMinutes = patch.actualMinutes ?? current.actualMinutes;
    const resultSummary = patch.resultSummary ?? current.resultSummary;
    const tx = this.scope.resolve(context);
    await tx.run(
      'UPDATE daily_plan_items SET status=?, actual_minutes=?, result_summary_json=?, failure_code=?, failure_message=?, finished_at=? WHERE id=?',
      [patch.status,actualMinutes,resultSummary?JSON.stringify(resultSummary):null,patch.failureCode??null,patch.failureMessage??null,patch.finishedAt??null,current.id]
    );
    return {
      ...current,
      status:patch.status,
      actualMinutes,
      resultSummary,
      failureCode:patch.failureCode,
      failureMessage:patch.failureMessage,
      finishedAt:patch.finishedAt
    };
  }

  private async loadAggregate(row: PlanRow): Promise<DailyPlanAggregate> {
    const [blocks, items] = await Promise.all([
      this.db.query<BlockRow>('SELECT * FROM daily_plan_blocks WHERE daily_plan_id=? ORDER BY sequence', [row.id]),
      this.db.query<ItemRow>('SELECT * FROM daily_plan_items WHERE daily_plan_id=? ORDER BY sequence', [row.id])
    ]);
    return { plan:plan(row), blocks:blocks.map(block), items:items.map(item) };
  }
}

function plan(r: PlanRow): DailyPlanRecord {
  return {
    id:r.id, examCycleId:r.exam_cycle_id as DailyPlanRecord['examCycleId'], planDate:r.plan_date as DailyPlanRecord['planDate'],
    version:r.version, status:r.status, phase:r.phase, availableMinutes:r.available_minutes, decisionSummary:r.decision_summary,
    decisionFactors:JSON.parse(r.decision_factors_json), createdBy:r.created_by, createdAt:r.created_at as DailyPlanRecord['createdAt'],
    supersedesPlanId:r.supersedes_plan_id??undefined
  };
}

function item(r: ItemRow): DailyPlanItemRecord {
  return {
    id:r.id, dailyPlanId:r.daily_plan_id, dailyPlanBlockId:r.daily_plan_block_id??`DailyPlanBlockId:legacy:${r.daily_plan_id}:${r.sequence}`,
    learningThreadId:r.learning_thread_id??undefined, capabilityNodeId:r.capability_node_id as DailyPlanItemRecord['capabilityNodeId'],
    reviewQueueItemId:r.review_queue_item_id??undefined, category:r.item_category, itemType:r.item_type, sequence:r.sequence, targetMinutes:r.target_minutes,
    targetCount:r.target_count??undefined, priority:r.priority, required:r.required===1,
    dependencyIds:JSON.parse(r.dependency_ids_json), exitCriteria:JSON.parse(r.exit_criteria_json), reason:r.reason, status:r.status,
    actualMinutes:r.actual_minutes, resultSummary:r.result_summary_json?JSON.parse(r.result_summary_json):undefined,
    failureCode:r.failure_code??undefined, failureMessage:r.failure_message??undefined,
    finishedAt:r.finished_at as DailyPlanItemRecord['finishedAt']??undefined
  };
}

function block(r: BlockRow): DailyPlanBlockRecord {
  return {
    id:r.id,
    dailyPlanId:r.daily_plan_id,
    capabilityNodeId:r.capability_node_id as DailyPlanBlockRecord['capabilityNodeId'],
    subject:r.subject,
    module:r.module,
    teachingGoalCode:r.teaching_goal_code,
    sequence:r.sequence,
    priority:r.priority,
    required:r.required===1
  };
}
