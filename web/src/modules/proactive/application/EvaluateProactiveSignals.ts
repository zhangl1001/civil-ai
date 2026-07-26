import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ExamCycleId, IdGenerator, JsonObject } from '@/kernel/public';
import type { CandidateCycleBundle } from '@/modules/candidate/public';
import { DailyPlanItemStatus, type DailyPlanAggregate } from '@/modules/planning/public';
import type { MasteryTrack, ReviewQueueItem } from '@/modules/mastery/public';
import type { ProactiveSignal, ProactiveSignalRepository } from '../contracts/ProactiveSignalRepository';
import { ProactiveSignalStatus, ProactiveSignalType, type ProactiveSignalType as SignalType } from '../domain/ProactiveSignalCodes';
import { decideProactiveDelivery } from '../domain/ProactiveSignalPolicy';

interface CandidatePort { findCycle(examCycleId:ExamCycleId):Promise<CandidateCycleBundle|undefined>; }
interface DailyPlanPort { findCurrent(examCycleId:ExamCycleId,planDate:string):Promise<DailyPlanAggregate|undefined>; }
interface MasteryPort {
  listDueReviews(examCycleId:ExamCycleId,now:number,limit:number):Promise<readonly ReviewQueueItem[]>;
  listPriorityTracks(examCycleId:ExamCycleId,limit:number):Promise<readonly MasteryTrack[]>;
}

interface SignalDraft {
  readonly type: SignalType;
  readonly priority: number;
  readonly title: string;
  readonly content: string;
  readonly evidence: JsonObject;
  readonly actionRoute: string;
  readonly actionParams: JsonObject;
  readonly scope: string;
}

export class EvaluateProactiveSignals {
  constructor(
    private readonly unitOfWork:UnitOfWork,
    private readonly candidates:CandidatePort,
    private readonly plans:DailyPlanPort,
    private readonly mastery:MasteryPort,
    private readonly repository:ProactiveSignalRepository,
    private readonly clock:Clock,
    private readonly ids:IdGenerator
  ) {}

  async execute(examCycleId:ExamCycleId):Promise<readonly ProactiveSignal[]> {
    const candidate=await this.candidates.findCycle(examCycleId);
    if(!candidate)return [];
    const now=this.clock.now();
    const date=localDate(now,candidate.examCycle.timeZone);
    const [plan,reviews,tracks]=await Promise.all([
      this.plans.findCurrent(examCycleId,date),
      this.mastery.listDueReviews(examCycleId,now,12),
      this.mastery.listPriorityTracks(examCycleId,8)
    ]);
    const drafts=buildDrafts(plan,reviews,tracks);
    const created:ProactiveSignal[]=[];
    for(const draft of drafts){
      const decision=await decideProactiveDelivery({
        preferences:candidate.learningPreferences,
        signalType:draft.type,
        priority:draft.priority,
        now,
        repository:this.repository
      });
      if(!decision.allowed)continue;
      const dedupKey=`proactive:${examCycleId}:${date}:${draft.type}:${draft.scope}`;
      const existing=await this.repository.findByDedupKey(dedupKey);
      if(existing){created.push(existing);continue;}
      const signal:ProactiveSignal={
        id:this.ids.next('ProactiveSignalId'),
        examCycleId,
        signalType:draft.type,
        status:ProactiveSignalStatus.Pending,
        priority:draft.priority,
        title:draft.title,
        content:draft.content,
        evidence:draft.evidence,
        actionRoute:draft.actionRoute,
        actionParams:draft.actionParams,
        dedupKey,
        availableAt:decision.availableAt as ProactiveSignal['availableAt'],
        expiresAt:(now+24*60*60*1_000) as ProactiveSignal['expiresAt'],
        createdAt:now
      };
      created.push(await this.unitOfWork.runAutocommit(context=>this.repository.append(signal,context)));
    }
    return created;
  }
}

function buildDrafts(plan:DailyPlanAggregate|undefined,reviews:readonly ReviewQueueItem[],tracks:readonly MasteryTrack[]):SignalDraft[]{
  const drafts:SignalDraft[]=[];
  if(reviews.length){
    drafts.push({
      type:ProactiveSignalType.ReviewDue,priority:85,title:'有内容到复习时间了',
      content:`今天有 ${reviews.length} 个知识点需要巩固，先做短复习能降低遗忘。`,
      evidence:{reviewCount:reviews.length},actionRoute:'/vue/plan',actionParams:{},scope:'due'
    });
  }
  const regressed=tracks.filter(track=>track.state==='regressed');
  if(regressed.length){
    drafts.push({
      type:ProactiveSignalType.MasteryRegressed,priority:90,title:'一个薄弱点需要及时修复',
      content:'最近证据显示已有知识点出现回退，私教计划会先降低难度并补齐前置方法。',
      evidence:{capabilityNodeIds:regressed.map(track=>track.capabilityNodeId)},
      actionRoute:'/vue/practice?mode=tutor',actionParams:{mode:'tutor'},scope:String(regressed[0].capabilityNodeId)
    });
  }
  if(plan){
    const active=plan.items.filter(item=>item.status===DailyPlanItemStatus.Pending||item.status===DailyPlanItemStatus.InProgress);
    const completed=plan.items.filter(item=>item.status===DailyPlanItemStatus.Completed);
    if(active.length&&completed.length===0){
      drafts.push({
        type:ProactiveSignalType.DailyCheckin,priority:45,title:'今日私教计划已经准备好',
        content:`已安排 ${active.length} 个学习动作，会优先处理到期复习和当前薄弱点。`,
        evidence:{dailyPlanId:plan.plan.id,itemCount:active.length},actionRoute:'/vue/plan',
        actionParams:{dailyPlanId:plan.plan.id},scope:plan.plan.id
      });
    }
    if(!active.length&&completed.length){
      drafts.push({
        type:ProactiveSignalType.Celebration,priority:55,title:'今天的训练闭环完成了',
        content:'今天的练习结果已写入能力画像，下一次安排会基于这次真实表现调整。',
        evidence:{dailyPlanId:plan.plan.id,completedCount:completed.length},actionRoute:'/vue/home',
        actionParams:{dailyPlanId:plan.plan.id},scope:plan.plan.id
      });
    }
  }
  return drafts;
}

function localDate(now:number,timeZone:string):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
