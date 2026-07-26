import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs } from '@/kernel/public';
import type {
  MessageCenterRepository,
  MessageQuery,
  SystemMessageRecord
} from '../contracts/MessageCenterRepository';
import { MessageStatus } from '../domain/MessageCenterCodes';

export class IndexedDbMessageCenterRepository implements MessageCenterRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly scope: IndexedDbTransactionScope) {}

  async append(message: SystemMessageRecord, context: TransactionContext): Promise<SystemMessageRecord> {
    this.scope.stage(context, { type:'add', store:TutorIndexedDbStore.SystemMessages, value:message });
    return message;
  }

  async findByDedupKey(dedupKey: string): Promise<SystemMessageRecord | undefined> {
    return (await this.database.getAll<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages)).find((item) => item.dedupKey === dedupKey);
  }

  async list(query: MessageQuery): Promise<readonly SystemMessageRecord[]> {
    return (await this.database.getAll<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages))
      .filter((item) => item.status !== MessageStatus.Archived)
      .filter((item) => !query.businessLine || item.businessLine === query.businessLine)
      .filter((item) => !query.category || item.category === query.category)
      .filter((item) => !query.unreadOnly || item.status === MessageStatus.Unread)
      .sort((left,right) => right.createdAt-left.createdAt || right.id.localeCompare(left.id))
      .slice(0,query.limit);
  }

  async countUnread(): Promise<number> {
    return (await this.database.getAll<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages))
      .filter((item) => item.status === MessageStatus.Unread)
      .length;
  }

  markRead(messageId: string, readAt: InstantMs, context: TransactionContext): Promise<void> {
    return this.update(messageId, (item) => item.status === MessageStatus.Unread ? { ...item,status:MessageStatus.Read,readAt } : item, context);
  }

  async markAllRead(readAt: InstantMs, context: TransactionContext): Promise<void> {
    const items = await this.database.getAll<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages);
    items.filter((item) => item.status === MessageStatus.Unread).forEach((item) => {
      this.scope.stage(context, { type:'put', store:TutorIndexedDbStore.SystemMessages, value:{ ...item,status:MessageStatus.Read,readAt } });
    });
  }

  archive(messageId: string, archivedAt: InstantMs, context: TransactionContext): Promise<void> {
    return this.update(messageId, (item) => ({ ...item,status:MessageStatus.Archived,archivedAt }), context);
  }

  async archiveAll(archivedAt: InstantMs, context: TransactionContext): Promise<void> {
    const items = await this.database.getAll<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages);
    items.filter((item) => item.status !== MessageStatus.Archived).forEach((item) => {
      this.scope.stage(context, {
        type: 'put',
        store: TutorIndexedDbStore.SystemMessages,
        value: { ...item, status: MessageStatus.Archived, archivedAt }
      });
    });
  }

  private async update(messageId:string, update:(item:SystemMessageRecord)=>SystemMessageRecord, context:TransactionContext):Promise<void> {
    const item=await this.database.get<SystemMessageRecord>(TutorIndexedDbStore.SystemMessages,messageId);
    if(item)this.scope.stage(context,{type:'put',store:TutorIndexedDbStore.SystemMessages,value:update(item)});
  }
}
