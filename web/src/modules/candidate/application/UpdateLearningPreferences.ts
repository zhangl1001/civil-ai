import type { UnitOfWork } from '@/capabilities/database/public';
import type { CapabilityNodeId, Clock, ExamCycleId, InstantMs, JsonObject, JsonValue } from '@/kernel/public';
import type { CandidateRepository, LearningPreferences } from '../contracts/CandidateRepository';
import { ProactiveLevel } from '../domain/LearningPreferenceCodes';

export interface CapabilityRecommendationPreferenceCommand {
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly mode: 'normal' | 'deprioritized' | 'paused';
  readonly reason?: string;
  readonly pausedUntil?: InstantMs;
}

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

  async setCapabilityRecommendation(
    command: CapabilityRecommendationPreferenceCommand
  ): Promise<LearningPreferences> {
    const cycle = await this.repository.findCycle(command.examCycleId);
    if (!cycle) throw new Error('Candidate cycle does not exist');
    const current = cycle.learningPreferences;
    const existing = asObject(current.extension.capabilityRecommendations);
    const capabilityRecommendations: Record<string, JsonValue> = { ...existing };
    if (command.mode === 'normal') {
      delete capabilityRecommendations[command.capabilityNodeId];
    } else {
      capabilityRecommendations[command.capabilityNodeId] = {
        mode: command.mode,
        reason: command.reason?.trim() || (command.mode === 'paused' ? 'user_paused' : 'user_claimed_mastery'),
        pausedUntil: command.pausedUntil ?? null,
        updatedAt: this.clock.now()
      };
    }
    const updated: LearningPreferences = {
      ...current,
      extension: { ...current.extension, capabilityRecommendations },
      updatedAt: this.clock.now(),
      version: current.version + 1
    };
    await this.unitOfWork.run((context) => this.repository.replaceLearningPreferences(updated, current.version, context));
    return updated;
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
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
