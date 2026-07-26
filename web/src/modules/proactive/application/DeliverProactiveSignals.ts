import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ExamCycleId } from '@/kernel/public';
import {
  MessageBusinessLine,
  MessageCategory,
  MessageEventCode,
  MessageSeverity,
  MessageSourceType,
  type MessageCenter
} from '@/modules/message-center/public';
import type { ProactiveSignal, ProactiveSignalRepository } from '../contracts/ProactiveSignalRepository';
import { ProactiveSignalStatus } from '../domain/ProactiveSignalCodes';
import { selectHighestPriority } from '../domain/ProactiveSignalPolicy';

export class DeliverProactiveSignals {
  constructor(
    private readonly unitOfWork:UnitOfWork,
    private readonly repository:ProactiveSignalRepository,
    private readonly messages:MessageCenter,
    private readonly clock:Clock
  ) {}

  async execute(examCycleId:ExamCycleId,limit=2):Promise<readonly ProactiveSignal[]> {
    const now=this.clock.now();
    const deliverable=selectHighestPriority(await this.repository.listDeliverable(examCycleId,now,Math.max(1,limit*2)),limit);
    const delivered:ProactiveSignal[]=[];
    for(const signal of deliverable){
      await this.messages.publish({
        businessLine:MessageBusinessLine.Tutor,
        category:MessageCategory.Reminder,
        eventCode:MessageEventCode.ReminderDue,
        severity:signal.priority>=80?MessageSeverity.Warning:MessageSeverity.Info,
        title:signal.title,
        content:signal.content,
        sourceType:MessageSourceType.ExamCycle,
        sourceId:signal.examCycleId,
        actionRoute:signal.actionRoute,
        actionParams:signal.actionParams,
        dedupKey:`message:${signal.dedupKey}`
      });
      const updated=await this.unitOfWork.run(context=>this.repository.transition(signal.id,ProactiveSignalStatus.Delivered,now,context));
      if(updated)delivered.push(updated);
    }
    return delivered;
  }
}
