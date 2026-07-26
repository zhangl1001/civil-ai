import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs } from '@/kernel/public';
import type { ProactiveSignal, ProactiveSignalRepository } from '../contracts/ProactiveSignalRepository';
import type { ProactiveSignalStatus, ProactiveSignalType } from '../domain/ProactiveSignalCodes';
import { ProactiveSignalStatus as Status } from '../domain/ProactiveSignalCodes';

export class IndexedDbProactiveSignalRepository implements ProactiveSignalRepository {
  constructor(private readonly database:TutorIndexedDb,private readonly scope:IndexedDbTransactionScope){}

  async append(signal:ProactiveSignal,context:TransactionContext):Promise<ProactiveSignal>{
    this.scope.stage(context,{type:'add',store:TutorIndexedDbStore.ProactiveSignals,value:signal});
    return signal;
  }

  async findByDedupKey(dedupKey:string):Promise<ProactiveSignal|undefined>{
    return (await this.all()).find(signal=>signal.dedupKey===dedupKey);
  }

  async findLatestByType(examCycleId:ExamCycleId,signalType:ProactiveSignalType):Promise<ProactiveSignal|undefined>{
    return (await this.all()).filter(signal=>signal.examCycleId===examCycleId&&signal.signalType===signalType)
      .sort((left,right)=>right.createdAt-left.createdAt)[0];
  }

  async listDeliverable(examCycleId:ExamCycleId,now:InstantMs,limit:number):Promise<readonly ProactiveSignal[]>{
    return (await this.all())
      .filter(signal=>signal.examCycleId===examCycleId&&signal.status===Status.Pending&&signal.availableAt<=now&&(!signal.expiresAt||signal.expiresAt>now))
      .sort((left,right)=>right.priority-left.priority||left.createdAt-right.createdAt)
      .slice(0,limit);
  }

  async transition(signalId:string,status:ProactiveSignalStatus,at:InstantMs,context:TransactionContext):Promise<ProactiveSignal|undefined>{
    const signal=await this.database.get<ProactiveSignal>(TutorIndexedDbStore.ProactiveSignals,signalId);
    if(!signal)return undefined;
    const updated:ProactiveSignal={
      ...signal,status,
      deliveredAt:status===Status.Delivered?at:signal.deliveredAt,
      actedAt:status===Status.Acted?at:signal.actedAt,
      dismissedAt:status===Status.Dismissed?at:signal.dismissedAt
    };
    this.scope.stage(context,{type:'put',store:TutorIndexedDbStore.ProactiveSignals,value:updated});
    return updated;
  }

  private all():Promise<readonly ProactiveSignal[]>{
    return this.database.getAll<ProactiveSignal>(TutorIndexedDbStore.ProactiveSignals);
  }
}
