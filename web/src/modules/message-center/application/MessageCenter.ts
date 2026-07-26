import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject } from '@/kernel/public';
import type {
  MessageCenterRepository,
  MessageQuery,
  SystemMessageRecord
} from '../contracts/MessageCenterRepository';
import {
  MessageStatus,
  type MessageBusinessLine,
  type MessageCategory,
  type MessageSeverity
} from '../domain/MessageCenterCodes';

export interface PublishSystemMessageCommand {
  readonly businessLine: MessageBusinessLine;
  readonly category: MessageCategory;
  readonly eventCode: string;
  readonly severity: MessageSeverity;
  readonly title: string;
  readonly content: string;
  readonly sourceType: string;
  readonly sourceId?: string;
  readonly actionRoute?: string;
  readonly actionParams?: JsonObject;
  readonly dedupKey: string;
}

/** Stable application port used by every business line; UI never writes message records directly. */
export class MessageCenter {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: MessageCenterRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async publish(command: PublishSystemMessageCommand): Promise<SystemMessageRecord> {
    assertText(command.eventCode, 'Message event code');
    assertText(command.title, 'Message title');
    assertText(command.content, 'Message content');
    assertText(command.sourceType, 'Message source type');
    assertText(command.dedupKey, 'Message dedup key');
    const existing = await this.repository.findByDedupKey(command.dedupKey);
    if (existing) return existing;
    const message: SystemMessageRecord = {
      id: this.ids.next('SystemMessageId'),
      businessLine: command.businessLine,
      category: command.category,
      eventCode: command.eventCode.trim(),
      severity: command.severity,
      status: MessageStatus.Unread,
      title: command.title.trim(),
      content: command.content.trim(),
      sourceType: command.sourceType.trim(),
      sourceId: command.sourceId?.trim() || undefined,
      actionRoute: command.actionRoute?.trim() || undefined,
      actionParams: command.actionParams ?? {},
      dedupKey: command.dedupKey.trim(),
      createdAt: this.clock.now()
    };
    try {
      return await this.unitOfWork.runAutocommit((context) => this.repository.append(message, context));
    } catch (error) {
      const concurrent = await this.repository.findByDedupKey(command.dedupKey);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  list(query: MessageQuery): Promise<readonly SystemMessageRecord[]> {
    return this.repository.list(query);
  }

  countUnread(): Promise<number> {
    return this.repository.countUnread();
  }

  markRead(messageId: string): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => this.repository.markRead(messageId, this.clock.now(), context));
  }

  markAllRead(): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => this.repository.markAllRead(this.clock.now(), context));
  }

  archive(messageId: string): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => this.repository.archive(messageId, this.clock.now(), context));
  }

  archiveAll(): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => this.repository.archiveAll(this.clock.now(), context));
  }
}

function assertText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required`);
}
