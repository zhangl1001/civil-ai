import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, LearningSessionId } from '@/kernel/public';
import type { TutorCycleConclusion, TutorCycleRepository } from '../contracts/TutorCycleRepository';

export class IndexedDbTutorCycleRepository implements TutorCycleRepository {
  constructor(private readonly database:TutorIndexedDb,private readonly scope:IndexedDbTransactionScope) {}

  async findByIdempotencyKey(idempotencyKey:string):Promise<TutorCycleConclusion|undefined> {
    return (await this.database.getAllByIndex<TutorCycleConclusion>(TutorIndexedDbStore.TutorCycleConclusions,'by_idempotency_key',idempotencyKey))[0];
  }

  async findLatestBySession(sessionId:LearningSessionId):Promise<TutorCycleConclusion|undefined> {
    return [...await this.database.getAll<TutorCycleConclusion>(TutorIndexedDbStore.TutorCycleConclusions)]
      .filter((item)=>item.learningSessionId===sessionId)
      .sort((left,right)=>right.createdAt-left.createdAt||right.id.localeCompare(left.id))[0];
  }

  async listRecent(examCycleId:ExamCycleId,limit:number):Promise<readonly TutorCycleConclusion[]> {
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new RangeError('Tutor cycle limit must be 1 to 50');
    return [...await this.database.getAllByIndex<TutorCycleConclusion>(TutorIndexedDbStore.TutorCycleConclusions,'by_exam_cycle',examCycleId)]
      .sort((left,right)=>right.createdAt-left.createdAt||right.id.localeCompare(left.id)).slice(0,limit);
  }

  async append(value:TutorCycleConclusion,context:TransactionContext):Promise<void> {
    this.scope.stage(context,{type:'add',store:TutorIndexedDbStore.TutorCycleConclusions,value});
  }
}
