import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, JsonObject } from '@/kernel/public';
import type {
  MessageCenterRepository,
  MessageQuery,
  SystemMessageRecord
} from '../contracts/MessageCenterRepository';

interface MessageRow extends SqlRow {
  id:string; business_line:SystemMessageRecord['businessLine']; category:SystemMessageRecord['category'];
  event_code:string; severity:SystemMessageRecord['severity']; status:SystemMessageRecord['status'];
  title:string; content:string; source_type:string; source_id:string|null; action_route:string|null;
  action_params_json:string; dedup_key:string; created_at:number; read_at:number|null; archived_at:number|null;
}

export class SqliteMessageCenterRepository implements MessageCenterRepository {
  constructor(private readonly database: SqlDatabase, private readonly scope: SqlTransactionScope) {}

  async append(message: SystemMessageRecord, context: TransactionContext): Promise<SystemMessageRecord> {
    await this.scope.resolve(context).run(
      `INSERT INTO system_messages(id,business_line,category,event_code,severity,status,title,content,source_type,source_id,action_route,action_params_json,dedup_key,created_at,read_at,archived_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [message.id,message.businessLine,message.category,message.eventCode,message.severity,message.status,message.title,message.content,message.sourceType,message.sourceId??null,message.actionRoute??null,JSON.stringify(message.actionParams),message.dedupKey,message.createdAt,message.readAt??null,message.archivedAt??null]
    );
    return message;
  }

  async findByDedupKey(dedupKey: string): Promise<SystemMessageRecord | undefined> {
    const rows = await this.database.query<MessageRow>('SELECT * FROM system_messages WHERE dedup_key=? LIMIT 1', [dedupKey]);
    return rows[0] ? mapMessage(rows[0]) : undefined;
  }

  async list(query: MessageQuery): Promise<readonly SystemMessageRecord[]> {
    const conditions = ["status <> 'archived'"];
    const parameters: Array<string | number> = [];
    if (query.businessLine) { conditions.push('business_line=?'); parameters.push(query.businessLine); }
    if (query.category) { conditions.push('category=?'); parameters.push(query.category); }
    if (query.unreadOnly) conditions.push("status='unread'");
    parameters.push(query.limit);
    const rows = await this.database.query<MessageRow>(
      `SELECT * FROM system_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`,
      parameters
    );
    return rows.map(mapMessage);
  }

  async countUnread(): Promise<number> {
    const rows = await this.database.query<{ total: number }>(
      "SELECT COUNT(*) AS total FROM system_messages WHERE status='unread'"
    );
    return rows[0]?.total ?? 0;
  }

  async markRead(messageId: string, readAt: InstantMs, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run("UPDATE system_messages SET status='read',read_at=? WHERE id=? AND status='unread'", [readAt,messageId]);
  }

  async markAllRead(readAt: InstantMs, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run("UPDATE system_messages SET status='read',read_at=? WHERE status='unread'", [readAt]);
  }

  async archive(messageId: string, archivedAt: InstantMs, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run("UPDATE system_messages SET status='archived',archived_at=? WHERE id=?", [archivedAt,messageId]);
  }

  async archiveAll(archivedAt: InstantMs, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      "UPDATE system_messages SET status='archived',archived_at=? WHERE status<>'archived'",
      [archivedAt]
    );
  }
}

function mapMessage(row: MessageRow): SystemMessageRecord {
  return {
    id:row.id,businessLine:row.business_line,category:row.category,eventCode:row.event_code,severity:row.severity,status:row.status,
    title:row.title,content:row.content,sourceType:row.source_type,sourceId:row.source_id??undefined,actionRoute:row.action_route??undefined,
    actionParams:JSON.parse(row.action_params_json) as JsonObject,dedupKey:row.dedup_key,createdAt:row.created_at as InstantMs,
    readAt:row.read_at as InstantMs|null??undefined,archivedAt:row.archived_at as InstantMs|null??undefined
  };
}
