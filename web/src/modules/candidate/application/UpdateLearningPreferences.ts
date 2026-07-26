import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ExamCycleId, JsonObject } from '@/kernel/public';
import type { CandidateRepository, LearningPreferences } from '../contracts/CandidateRepository';
import { ProactiveLevel } from '../domain/LearningPreferenceCodes';

export class UpdateLearningPreferences {
  constructor(
    private readonly unitOfWork:UnitOfWork,
    private readonly repository:CandidateRepository,
    private readonly clock:Clock
  ){}

  async execute(command:{
    readonly examCycleId:ExamCycleId;
    readonly proactiveLevel:LearningPreferences['proactiveLevel'];
    readonly quietHours:readonly JsonObject[];
  }):Promise<LearningPreferences>{
    if(!Object.values(ProactiveLevel).includes(command.proactiveLevel))throw new Error('Invalid proactive level');
    command.quietHours.forEach(validateQuietHours);
    const cycle=await this.repository.findCycle(command.examCycleId);
    if(!cycle)throw new Error('Candidate cycle does not exist');
    const current=cycle.learningPreferences;
    const updated:LearningPreferences={
      ...current,
      proactiveLevel:command.proactiveLevel,
      quietHours:[...command.quietHours],
      updatedAt:this.clock.now(),
      version:current.version+1
    };
    await this.unitOfWork.run(context=>this.repository.replaceLearningPreferences(updated,current.version,context));
    return updated;
  }
}

function validateQuietHours(value:JsonObject):void{
  if(typeof value.start!=='string'||typeof value.end!=='string'||!isTime(value.start)||!isTime(value.end)){
    throw new Error('Quiet hours must use HH:mm start and end');
  }
}

function isTime(value:string):boolean{
  if(!/^\d{2}:\d{2}$/.test(value))return false;
  const [hour,minute]=value.split(':').map(Number);
  return hour>=0&&hour<24&&minute>=0&&minute<60;
}
