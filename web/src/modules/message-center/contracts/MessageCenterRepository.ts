import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, JsonObject } from '@/kernel/public';
import type {
  MessageBusinessLine,
  MessageCategory,
  MessageSeverity,
  MessageStatus
} from '../domain/MessageCenterCodes';

export interface SystemMessageRecord {
  readonly id: string;
  readonly businessLine: MessageBusinessLine;
  readonly category: MessageCategory;
  readonly eventCode: string;
  readonly severity: MessageSeverity;
  readonly status: MessageStatus;
  readonly title: string;
  readonly content: string;
  readonly sourceType: string;
  readonly sourceId?: string;
  readonly actionRoute?: string;
  readonly actionParams: JsonObject;
  readonly dedupKey: string;
  readonly createdAt: InstantMs;
  readonly readAt?: InstantMs;
  readonly archivedAt?: InstantMs;
}

export interface MessageQuery {
  readonly limit: number;
  readonly businessLine?: MessageBusinessLine;
  readonly category?: MessageCategory;
  readonly unreadOnly?: boolean;
}

export interface MessageCenterRepository {
  append(message: SystemMessageRecord, context: TransactionContext): Promise<SystemMessageRecord>;
  findByDedupKey(dedupKey: string): Promise<SystemMessageRecord | undefined>;
  list(query: MessageQuery): Promise<readonly SystemMessageRecord[]>;
  countUnread(): Promise<number>;
  markRead(messageId: string, readAt: InstantMs, context: TransactionContext): Promise<void>;
  markAllRead(readAt: InstantMs, context: TransactionContext): Promise<void>;
  archive(messageId: string, archivedAt: InstantMs, context: TransactionContext): Promise<void>;
  archiveAll(archivedAt: InstantMs, context: TransactionContext): Promise<void>;
}
