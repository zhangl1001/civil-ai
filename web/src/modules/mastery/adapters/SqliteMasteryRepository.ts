import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, EvidenceId, ExamCycleId, InstantMs, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, MasterySnapshot, MasteryTrack, ReviewQueueItem } from '../contracts/MasteryRepository';
import type { MasteryState, ReviewStatus, ReviewType } from '../domain/MasteryCodes';

interface TrackRow extends SqlRow { id:string; exam_cycle_id:string; capability_node_id:string; state:MasteryState; concept:number; recognition:number; method:number; accuracy:number; speed:number; retention:number; transfer:number; stability:number; confidence:number; effective_sample:number; last_evidence_at:number|null; last_state_change_at:number; algorithm_version:string; version:number; created_at:number; updated_at:number; }
interface ReviewRow extends SqlRow { id:string; exam_cycle_id:string; capability_node_id:string; mastery_track_id:string; review_type:ReviewType; due_at:number; priority:number; interval_days:number; stability_before:number; status:ReviewStatus; reason:string; source_evidence_id:string|null; claimed_at:number|null; completed_at:number|null; failure_code:string|null; version:number; updated_at:number; }

export class SqliteMasteryRepository implements MasteryRepository {
  constructor(private readonly database: SqlDatabase, private readonly scope: SqlTransactionScope) {}

  async findTrack(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<MasteryTrack | undefined> {
    const rows = await this.database.query<TrackRow>('SELECT * FROM mastery_tracks WHERE exam_cycle_id = ? AND capability_node_id = ? LIMIT 1', [examCycleId, capabilityNodeId]);
    return rows[0] ? track(rows[0]) : undefined;
  }

  async upsertTrack(value: MasteryTrack, expectedVersion: number | undefined, context: TransactionContext): Promise<void> {
    const transaction = this.scope.resolve(context);
    if (expectedVersion === undefined) {
      await transaction.run('INSERT INTO mastery_tracks(id,exam_cycle_id,capability_node_id,state,concept,recognition,method,accuracy,speed,retention,transfer,stability,confidence,effective_sample,last_evidence_at,last_state_change_at,algorithm_version,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [value.id,value.examCycleId,value.capabilityNodeId,value.state,value.concept,value.recognition,value.method,value.accuracy,value.speed,value.retention,value.transfer,value.stability,value.confidence,value.effectiveSample,value.lastEvidenceAt ?? null,value.lastStateChangeAt,value.algorithmVersion,value.version,value.createdAt,value.updatedAt]);
      return;
    }
    const result = await transaction.run('UPDATE mastery_tracks SET state=?,concept=?,recognition=?,method=?,accuracy=?,speed=?,retention=?,transfer=?,stability=?,confidence=?,effective_sample=?,last_evidence_at=?,last_state_change_at=?,algorithm_version=?,version=?,updated_at=? WHERE id=? AND version=?', [value.state,value.concept,value.recognition,value.method,value.accuracy,value.speed,value.retention,value.transfer,value.stability,value.confidence,value.effectiveSample,value.lastEvidenceAt ?? null,value.lastStateChangeAt,value.algorithmVersion,value.version,value.updatedAt,value.id,expectedVersion]);
    if (result.changes !== 1) throw new Error(`Mastery track version conflict: ${value.id}`);
  }

  async appendSnapshot(value: MasterySnapshot, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run('INSERT INTO mastery_snapshots(id,mastery_track_id,exam_cycle_id,snapshot_json,algorithm_version,evidence_cutoff_at,created_at) VALUES (?,?,?,?,?,?,?)', [value.id,value.masteryTrackId,value.examCycleId,JSON.stringify(value.snapshot),value.algorithmVersion,value.evidenceCutoffAt,value.createdAt]);
  }

  async scheduleReview(value: ReviewQueueItem, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run('INSERT OR IGNORE INTO review_queue(id,exam_cycle_id,capability_node_id,mastery_track_id,review_type,due_at,priority,interval_days,stability_before,status,reason,source_evidence_id,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [value.id,value.examCycleId,value.capabilityNodeId,value.masteryTrackId,value.reviewType,value.dueAt,value.priority,value.intervalDays,value.stabilityBefore,value.status,value.reason,value.sourceEvidenceId ?? null,value.version,value.updatedAt]);
  }

  async findReview(reviewQueueItemId: ReviewQueueItemId): Promise<ReviewQueueItem | undefined> {
    const rows = await this.database.query<ReviewRow>('SELECT * FROM review_queue WHERE id = ? LIMIT 1', [reviewQueueItemId]);
    return rows[0] ? review(rows[0]) : undefined;
  }

  async replaceReview(value: ReviewQueueItem, expectedVersion: number, context: TransactionContext): Promise<void> {
    if (value.version !== expectedVersion + 1) throw new Error('Review queue version must advance by one');
    const result = await this.scope.resolve(context).run('UPDATE review_queue SET status=?,claimed_at=?,completed_at=?,failure_code=?,version=?,updated_at=? WHERE id=? AND version=?', [value.status,value.claimedAt ?? null,value.completedAt ?? null,value.failureCode ?? null,value.version,value.updatedAt,value.id,expectedVersion]);
    if (result.changes !== 1) throw new Error(`Review queue version conflict: ${value.id}`);
  }

  async listDueReviews(examCycleId: ExamCycleId, now: InstantMs, limit: number): Promise<readonly ReviewQueueItem[]> {
    assertLimit(limit, 'Review');
    const rows = await this.database.query<ReviewRow>("SELECT * FROM review_queue WHERE exam_cycle_id = ? AND status = 'scheduled' AND due_at <= ? ORDER BY priority DESC, due_at, id LIMIT ?", [examCycleId, now, limit]);
    return rows.map(review);
  }

  async listReviews(examCycleId: ExamCycleId, limit: number): Promise<readonly ReviewQueueItem[]> {
    assertLimit(limit, 'Review');
    return (await this.listAllReviews(examCycleId)).slice(0, limit);
  }

  async listAllReviews(examCycleId: ExamCycleId): Promise<readonly ReviewQueueItem[]> {
    const rows = await this.database.query<ReviewRow>(
      'SELECT * FROM review_queue WHERE exam_cycle_id = ? ORDER BY updated_at DESC, id',
      [examCycleId]
    );
    return rows.map(review);
  }

  async listPriorityTracks(examCycleId: ExamCycleId, limit: number): Promise<readonly MasteryTrack[]> {
    assertLimit(limit, 'Track');
    const rows = await this.database.query<TrackRow>("SELECT * FROM mastery_tracks WHERE exam_cycle_id = ? ORDER BY CASE state WHEN 'regressed' THEN 0 WHEN 'learning' THEN 1 WHEN 'practicing' THEN 2 WHEN 'consolidating' THEN 3 ELSE 4 END, stability ASC, confidence ASC, updated_at ASC LIMIT ?", [examCycleId, limit]);
    return rows.map(track);
  }

  async listTracks(examCycleId: ExamCycleId, limit: number): Promise<readonly MasteryTrack[]> {
    assertLimit(limit, 'Track');
    return (await this.listAllTracks(examCycleId)).slice(0, limit);
  }

  async listAllTracks(examCycleId: ExamCycleId): Promise<readonly MasteryTrack[]> {
    const rows = await this.database.query<TrackRow>(
      'SELECT * FROM mastery_tracks WHERE exam_cycle_id = ? ORDER BY updated_at DESC, id',
      [examCycleId]
    );
    return rows.map(track);
  }
}

function track(row: TrackRow): MasteryTrack { return { id:row.id,examCycleId:row.exam_cycle_id as ExamCycleId,capabilityNodeId:row.capability_node_id as CapabilityNodeId,state:row.state,concept:row.concept,recognition:row.recognition,method:row.method,accuracy:row.accuracy,speed:row.speed,retention:row.retention,transfer:row.transfer,stability:row.stability,confidence:row.confidence,effectiveSample:row.effective_sample,lastEvidenceAt:row.last_evidence_at as InstantMs|null ?? undefined,lastStateChangeAt:row.last_state_change_at as InstantMs,algorithmVersion:row.algorithm_version,version:row.version,createdAt:row.created_at as InstantMs,updatedAt:row.updated_at as InstantMs}; }
function review(row: ReviewRow): ReviewQueueItem { return { id:row.id as ReviewQueueItemId,examCycleId:row.exam_cycle_id as ExamCycleId,capabilityNodeId:row.capability_node_id as CapabilityNodeId,masteryTrackId:row.mastery_track_id,reviewType:row.review_type,dueAt:row.due_at as InstantMs,priority:row.priority,intervalDays:row.interval_days,stabilityBefore:row.stability_before,status:row.status,reason:row.reason,sourceEvidenceId:row.source_evidence_id as EvidenceId|null ?? undefined,claimedAt:row.claimed_at as InstantMs|null ?? undefined,completedAt:row.completed_at as InstantMs|null ?? undefined,failureCode:row.failure_code ?? undefined,version:row.version,updatedAt:row.updated_at as InstantMs}; }
function assertLimit(limit: number, label: string): void { if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError(`${label} limit must be 1 to 100`); }
