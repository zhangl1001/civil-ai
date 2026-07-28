import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  LearningSessionId,
  LearningThreadId,
  QuestionSetId,
  TutorCycleConclusionId
} from '@/kernel/public';
import type { TutorCycleConclusion, TutorCycleRepository } from '../contracts/TutorCycleRepository';
import type { TutorCycleConclusionType, TutorDecisionScope } from '../domain/TutorCycleCodes';

interface TutorCycleRow extends SqlRow {
  id:string;exam_cycle_id:string;learning_thread_id:string;learning_session_id:string;question_set_id:string;
  capability_node_ids_json:string;conclusion_type:string;decision_scope:string;observation_json:string;
  diagnosis_json:string;proposal_json:string;execution_json:string;assessment_json:string;schedule_json:string;
  policy_version:string;idempotency_key:string;created_at:number;
}

export class SqliteTutorCycleRepository implements TutorCycleRepository {
  constructor(private readonly database:SqlDatabase,private readonly scope:SqlTransactionScope) {}

  async findByIdempotencyKey(idempotencyKey:string):Promise<TutorCycleConclusion|undefined> {
    const rows=await this.database.query<TutorCycleRow>('SELECT * FROM tutor_cycle_conclusions WHERE idempotency_key = ? LIMIT 1',[idempotencyKey]);
    return rows[0]?mapRow(rows[0]):undefined;
  }

  async findLatestBySession(sessionId:LearningSessionId):Promise<TutorCycleConclusion|undefined> {
    const rows=await this.database.query<TutorCycleRow>(
      'SELECT * FROM tutor_cycle_conclusions WHERE learning_session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [sessionId]
    );
    return rows[0]?mapRow(rows[0]):undefined;
  }

  async listRecent(examCycleId:ExamCycleId,limit:number):Promise<readonly TutorCycleConclusion[]> {
    assertLimit(limit);
    const rows=await this.database.query<TutorCycleRow>('SELECT * FROM tutor_cycle_conclusions WHERE exam_cycle_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',[examCycleId,limit]);
    return rows.map(mapRow);
  }

  async append(value:TutorCycleConclusion,context:TransactionContext):Promise<void> {
    await this.scope.resolve(context).run(`INSERT INTO tutor_cycle_conclusions(
      id,exam_cycle_id,learning_thread_id,learning_session_id,question_set_id,capability_node_ids_json,
      conclusion_type,decision_scope,observation_json,diagnosis_json,proposal_json,execution_json,
      assessment_json,schedule_json,policy_version,idempotency_key,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      value.id,value.examCycleId,value.learningThreadId,value.learningSessionId,value.questionSetId,
      JSON.stringify(value.capabilityNodeIds),value.conclusionType,value.decisionScope,JSON.stringify(value.observation),
      JSON.stringify(value.diagnosis),JSON.stringify(value.proposal),JSON.stringify(value.execution),
      JSON.stringify(value.assessment),JSON.stringify(value.schedule),value.policyVersion,value.idempotencyKey,value.createdAt
    ]);
  }
}

function mapRow(row:TutorCycleRow):TutorCycleConclusion {
  return {
    id:row.id as TutorCycleConclusionId,examCycleId:row.exam_cycle_id as ExamCycleId,
    learningThreadId:row.learning_thread_id as LearningThreadId,learningSessionId:row.learning_session_id as LearningSessionId,
    questionSetId:row.question_set_id as QuestionSetId,
    capabilityNodeIds:parseArray<string>(row.capability_node_ids_json,'capability_node_ids_json') as CapabilityNodeId[],
    conclusionType:row.conclusion_type as TutorCycleConclusionType,decisionScope:row.decision_scope as TutorDecisionScope,
    observation:parseObject(row.observation_json,'observation_json'),diagnosis:parseObject(row.diagnosis_json,'diagnosis_json'),
    proposal:parseObject(row.proposal_json,'proposal_json'),execution:parseObject(row.execution_json,'execution_json'),
    assessment:parseObject(row.assessment_json,'assessment_json'),schedule:parseObject(row.schedule_json,'schedule_json'),
    policyVersion:row.policy_version,idempotencyKey:row.idempotency_key,createdAt:row.created_at as InstantMs
  };
}

function parseObject(value:string,field:string):JsonObject { const parsed:unknown=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new TypeError(`${field} must be an object`);return parsed as JsonObject; }
function parseArray<T>(value:string,field:string):T[] { const parsed:unknown=JSON.parse(value);if(!Array.isArray(parsed))throw new TypeError(`${field} must be an array`);return parsed as T[]; }
function assertLimit(limit:number):void { if(!Number.isInteger(limit)||limit<1||limit>50)throw new RangeError('Tutor cycle limit must be 1 to 50'); }
