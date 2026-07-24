import type { InstantMs, JsonObject } from '@/kernel/public';
import type { GenerationWorkflowRecord } from '../contracts/ContentRepository';
import {
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  type GenerationWorkflowStep as GenerationWorkflowStepCode
} from './ContentCodes';

const orderedSteps: readonly GenerationWorkflowStepCode[] = [
  GenerationWorkflowStep.PrepareContext,
  GenerationWorkflowStep.CompilePrompt,
  GenerationWorkflowStep.InvokeModel,
  GenerationWorkflowStep.ParseStructure,
  GenerationWorkflowStep.ValidateSchema,
  GenerationWorkflowStep.ValidateDomain,
  GenerationWorkflowStep.QualityReview,
  GenerationWorkflowStep.StageResult,
  GenerationWorkflowStep.CommitResult,
  GenerationWorkflowStep.PublishOutbox,
  GenerationWorkflowStep.Complete
];

const terminalStatuses: ReadonlySet<GenerationWorkflowRecord['status']> = new Set([
  GenerationWorkflowStatus.Committed,
  GenerationWorkflowStatus.Failed,
  GenerationWorkflowStatus.Cancelled
]);

export interface WorkflowAdvancePatch {
  readonly stagedResult?: JsonObject;
  readonly validation?: JsonObject;
  readonly attemptIncrement?: number;
}

export class GenerationWorkflowMachine {
  startAttempt(current: GenerationWorkflowRecord, now: InstantMs): GenerationWorkflowRecord {
    assertActive(current);
    if (current.currentStep !== GenerationWorkflowStep.InvokeModel) {
      throw new Error(`Generation attempt cannot start from ${current.currentStep}`);
    }
    return {
      ...current,
      status: GenerationWorkflowStatus.Running,
      attemptCount: current.attemptCount + 1,
      updatedAt: now,
      version: current.version + 1
    };
  }

  retry(current: GenerationWorkflowRecord, now: InstantMs): GenerationWorkflowRecord {
    if (current.status !== GenerationWorkflowStatus.Failed) {
      throw new Error(`Only failed generation can retry: ${current.status}`);
    }
    return {
      ...current,
      status: GenerationWorkflowStatus.Queued,
      currentStep: GenerationWorkflowStep.PrepareContext,
      stagedResult: undefined,
      validation: {},
      errorCode: undefined,
      completedAt: undefined,
      updatedAt: now,
      version: current.version + 1
    };
  }

  advance(
    current: GenerationWorkflowRecord,
    nextStep: GenerationWorkflowStepCode,
    now: InstantMs,
    patch: WorkflowAdvancePatch = {}
  ): GenerationWorkflowRecord {
    assertActive(current);
    const currentIndex = orderedSteps.indexOf(current.currentStep);
    const nextIndex = orderedSteps.indexOf(nextStep);
    if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
      throw new Error(`Illegal generation step transition: ${current.currentStep} -> ${nextStep}`);
    }
    const nextStatus = statusForStep(nextStep);
    return {
      ...current,
      currentStep: nextStep,
      status: nextStatus,
      attemptCount: current.attemptCount + (patch.attemptIncrement ?? 0),
      stagedResult: patch.stagedResult ?? current.stagedResult,
      validation: patch.validation ?? current.validation,
      errorCode: undefined,
      completedAt: nextStatus === GenerationWorkflowStatus.Committed ? now : undefined,
      updatedAt: now,
      version: current.version + 1
    };
  }

  fail(current: GenerationWorkflowRecord, errorCode: string, now: InstantMs): GenerationWorkflowRecord {
    assertActive(current);
    if (!errorCode.trim()) throw new Error('Generation failure requires an error code');
    return {
      ...current,
      status: GenerationWorkflowStatus.Failed,
      errorCode,
      completedAt: now,
      updatedAt: now,
      version: current.version + 1
    };
  }

  cancel(current: GenerationWorkflowRecord, now: InstantMs): GenerationWorkflowRecord {
    assertActive(current);
    return {
      ...current,
      status: GenerationWorkflowStatus.Cancelled,
      errorCode: undefined,
      completedAt: now,
      updatedAt: now,
      version: current.version + 1
    };
  }
}

function assertActive(workflow: GenerationWorkflowRecord): void {
  if (terminalStatuses.has(workflow.status)) {
    throw new Error(`Generation workflow ${workflow.id} is already terminal: ${workflow.status}`);
  }
}

function statusForStep(step: GenerationWorkflowStepCode): GenerationWorkflowRecord['status'] {
  if (
    step === GenerationWorkflowStep.ParseStructure
    || step === GenerationWorkflowStep.ValidateSchema
    || step === GenerationWorkflowStep.ValidateDomain
    || step === GenerationWorkflowStep.QualityReview
  ) return GenerationWorkflowStatus.Validating;
  if (
    step === GenerationWorkflowStep.StageResult
    || step === GenerationWorkflowStep.CommitResult
    || step === GenerationWorkflowStep.PublishOutbox
  ) return GenerationWorkflowStatus.Staged;
  if (step === GenerationWorkflowStep.Complete) return GenerationWorkflowStatus.Committed;
  return GenerationWorkflowStatus.Running;
}
