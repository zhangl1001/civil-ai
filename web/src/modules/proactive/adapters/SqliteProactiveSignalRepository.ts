import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs, JsonObject } from '@/kernel/public';
import type { ProactiveSignal, ProactiveSignalRepository } from '../contracts/ProactiveSignalRepository';
import type { ProactiveSignalStatus, ProactiveSignalType } from '../domain/ProactiveSignalCodes';

interface SignalRow extends SqlRow {
  id:string;exam_cycle_id:string;signal_type:ProactiveSignalType;status:ProactiveSignalStatus;priority:number;
  title:string;content:string;evidence_json:string;action_route:string|null;action_params_json:string;dedup_key:string;
  available_at:number;expires_at:number|null;delivered_at:number|null;acted_at:number|null;dismissed_at:number|null;created_at:number;
}

export class SqliteProactiveSignalRepository implements ProactiveSignalRepository {
  constructor(private readonly database:SqlDatabase,private readonly scope:SqlTransactionScope){}

  async append(signal:ProactiveSignal,context:TransactionContext):Promise<ProactiveSignal>{
    await this.scope.resolve(context).run(
      `INSERT INTO proactive_signals(id,exam_cycle_id,signal_type,status,priority,title,content,evidence_json,action_route,action_params_json,dedup_key,available_at,expires_at,delivered_at,acted_at,dismissed_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [signal.id,signal.examCycleId,signal.signalType,signal.status,signal.priority,signal.title,signal.content,JSON.stringify(signal.evidence),signal.actionRoute??null,JSON.stringify(signal.actionParams),signal.dedupKey,signal.availableAt,signal.expiresAt??null,signal.deliveredAt??null,signal.actedAt??null,signal.dismissedAt??null,signal.createdAt]
    );
    return signal;
  }

  async findByDedupKey(dedupKey:string):Promise<ProactiveSignal|undefined>{
    const rows=await this.database.query<SignalRow>('SELECT * FROM proactive_signals WHERE dedup_key=? LIMIT 1',[dedupKey]);
    return rows[0]?mapSignal(rows[0]):undefined;
  }

  async findLatestByType(examCycleId:ExamCycleId,signalType:ProactiveSignalType):Promise<ProactiveSignal|undefined>{
    const rows=await this.database.query<SignalRow>(
      'SELECT * FROM proactive_signals WHERE exam_cycle_id=? AND signal_type=? ORDER BY created_at DESC LIMIT 1',
      [examCycleId,signalType]
    );
    return rows[0]?mapSignal(rows[0]):undefined;
  }

  async listDeliverable(examCycleId:ExamCycleId,now:InstantMs,limit:number):Promise<readonly ProactiveSignal[]>{
    const rows=await this.database.query<SignalRow>(
      `SELECT * FROM proactive_signals
       WHERE exam_cycle_id=? AND status='pending' AND available_at<=? AND (expires_at IS NULL OR expires_at>?)
       ORDER BY priority DESC,created_at LIMIT ?`,
      [examCycleId,now,now,limit]
    );
    return rows.map(mapSignal);
  }

  async transition(signalId:string,status:ProactiveSignalStatus,at:InstantMs,context:TransactionContext):Promise<ProactiveSignal|undefined>{
    const transaction=this.scope.resolve(context);
    const rows=await transaction.query<SignalRow>('SELECT * FROM proactive_signals WHERE id=? LIMIT 1',[signalId]);
    if(!rows[0])return undefined;
    const deliveredAt=status==='delivered'?at:rows[0].delivered_at;
    const actedAt=status==='acted'?at:rows[0].acted_at;
    const dismissedAt=status==='dismissed'?at:rows[0].dismissed_at;
    await transaction.run(
      'UPDATE proactive_signals SET status=?,delivered_at=?,acted_at=?,dismissed_at=? WHERE id=?',
      [status,deliveredAt,actedAt,dismissedAt,signalId]
    );
    return mapSignal({...rows[0],status,delivered_at:deliveredAt,acted_at:actedAt,dismissed_at:dismissedAt});
  }
}

function mapSignal(row:SignalRow):ProactiveSignal{
  return {
    id:row.id,examCycleId:row.exam_cycle_id as ExamCycleId,signalType:row.signal_type,status:row.status,priority:row.priority,
    title:row.title,content:row.content,evidence:JSON.parse(row.evidence_json) as JsonObject,actionRoute:row.action_route??undefined,
    actionParams:JSON.parse(row.action_params_json) as JsonObject,dedupKey:row.dedup_key,availableAt:row.available_at as InstantMs,
    expiresAt:asInstant(row.expires_at),deliveredAt:asInstant(row.delivered_at),actedAt:asInstant(row.acted_at),
    dismissedAt:asInstant(row.dismissed_at),createdAt:row.created_at as InstantMs
  };
}

function asInstant(value:number|null):InstantMs|undefined{return value===null?undefined:value as InstantMs;}
