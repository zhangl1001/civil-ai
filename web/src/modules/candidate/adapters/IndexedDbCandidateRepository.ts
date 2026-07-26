import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ProjectId } from '@/kernel/public';
import type {
  CandidateCycleBundle,
  CandidateRepository,
  ExamCycle,
  ExamCyclePolicyBinding,
  LearningPreferences,
  OnboardingDraft,
  ScoreTarget
} from '../contracts/CandidateRepository';
import { ScoreTargetStatus } from '../domain/ScoreTargetStatus';

interface StoredCandidateCycleBundle {
  readonly projectId: string;
  readonly status: string;
  readonly updatedAt: number;
  readonly bundle: CandidateCycleBundle;
}

export class IndexedDbCandidateRepository implements CandidateRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async createCycleBundle(bundle: CandidateCycleBundle, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.CandidateCycleBundles,
      value: {
        projectId: bundle.project.id,
        status: bundle.examCycle.status,
        updatedAt: bundle.examCycle.updatedAt,
        bundle
      } satisfies StoredCandidateCycleBundle
    });
  }

  async replaceActiveScoreTargets(targets: readonly ScoreTarget[], context: TransactionContext): Promise<void> {
    if (!targets.length) return;
    const current = await this.findCycle(targets[0].examCycleId);
    if (!current) throw new Error('Candidate cycle does not exist');
    const replacedIds = new Set(targets.map((target) => target.supersedesTargetId));
    if (replacedIds.has(undefined)) throw new Error('Replacement score target must reference its predecessor');
    for (const target of targets) {
      const predecessor = current.scoreTargets.find((item) => item.id === target.supersedesTargetId);
      if (!predecessor || predecessor.status !== ScoreTargetStatus.Active || predecessor.subject !== target.subject) {
        throw new Error(`Active score target conflict for ${target.subject}`);
      }
    }
    const bundle: CandidateCycleBundle = {
      ...current,
      examCycle: { ...current.examCycle, updatedAt: targets[0].effectiveFrom },
      scoreTargets: [
        ...current.scoreTargets.map((target) => replacedIds.has(target.id)
          ? { ...target, status: ScoreTargetStatus.Superseded }
          : target),
        ...targets
      ]
    };
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.CandidateCycleBundles,
      value: {
        projectId: bundle.project.id,
        status: bundle.examCycle.status,
        updatedAt: bundle.examCycle.updatedAt,
        bundle
      } satisfies StoredCandidateCycleBundle
    });
  }

  async replaceLearningPreferences(preferences:LearningPreferences,expectedVersion:number,context:TransactionContext):Promise<void>{
    const current=await this.findCycle(preferences.examCycleId);
    if(!current||current.learningPreferences.version!==expectedVersion)throw new Error('Learning preferences version conflict');
    const bundle:CandidateCycleBundle={
      ...current,
      examCycle:{...current.examCycle,updatedAt:preferences.updatedAt},
      learningPreferences:preferences
    };
    this.transactionScope.stage(context,{
      type:'put',store:TutorIndexedDbStore.CandidateCycleBundles,
      value:{projectId:bundle.project.id,status:bundle.examCycle.status,updatedAt:bundle.examCycle.updatedAt,bundle} satisfies StoredCandidateCycleBundle
    });
  }

  async replaceCurriculumBinding(
    examCycle: ExamCycle,
    policyBindings: readonly ExamCyclePolicyBinding[],
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.findCycle(examCycle.id);
    if (!current || current.examCycle.version !== expectedVersion) {
      throw new Error('Candidate curriculum binding version conflict');
    }
    const bundle: CandidateCycleBundle = {
      ...current,
      examCycle,
      policyBindings: [...policyBindings]
    };
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.CandidateCycleBundles,
      value: {
        projectId: bundle.project.id,
        status: bundle.examCycle.status,
        updatedAt: bundle.examCycle.updatedAt,
        bundle
      } satisfies StoredCandidateCycleBundle
    });
  }

  async findActiveCycle(projectId: ProjectId): Promise<CandidateCycleBundle | undefined> {
    const stored = await this.database.get<StoredCandidateCycleBundle>(
      TutorIndexedDbStore.CandidateCycleBundles,
      projectId
    );
    return stored?.status === 'active' ? stored.bundle : undefined;
  }

  async findCurrentCycle(): Promise<CandidateCycleBundle | undefined> {
    const stored = await this.database.getAll<StoredCandidateCycleBundle>(TutorIndexedDbStore.CandidateCycleBundles);
    const current = stored
      .filter((candidate) => candidate.status === 'active')
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return current?.bundle;
  }

  async findCycle(examCycleId: CandidateCycleBundle['examCycle']['id']): Promise<CandidateCycleBundle | undefined> {
    const stored = await this.database.getAll<StoredCandidateCycleBundle>(TutorIndexedDbStore.CandidateCycleBundles);
    return stored.find((candidate) => candidate.bundle.examCycle.id === examCycleId)?.bundle;
  }

  async saveOnboardingDraft(draft: OnboardingDraft): Promise<void> {
    await this.database.writeBatch([{
      type: 'put',
      store: TutorIndexedDbStore.OnboardingDrafts,
      value: draft
    }]);
  }

  findOnboardingDraft(draftId: string): Promise<OnboardingDraft | undefined> {
    return this.database.get<OnboardingDraft>(TutorIndexedDbStore.OnboardingDrafts, draftId);
  }

  async deleteOnboardingDraft(draftId: string, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'delete',
      store: TutorIndexedDbStore.OnboardingDrafts,
      key: draftId
    });
  }
}
