import type { UnitOfWork } from '@/capabilities/database/public';
import type {
  AssessmentPolicyVersionId,
  Clock,
  CurriculumVersionId,
  SubjectCode
} from '@/kernel/public';
import type {
  CandidateCycleBundle,
  CandidateRepository,
  ExamCyclePolicyBinding
} from '../contracts/CandidateRepository';

export interface CandidateCurriculumAlignmentTarget {
  readonly curriculum: {
    readonly id: CurriculumVersionId;
  };
  readonly assessmentPolicies: readonly {
    readonly id: AssessmentPolicyVersionId;
    readonly subject: SubjectCode;
    readonly policyType: string;
    readonly status: string;
  }[];
}

export class AlignCandidateCurriculum {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly candidateRepository: CandidateRepository,
    private readonly clock: Clock
  ) {}

  async execute(target: CandidateCurriculumAlignmentTarget): Promise<CandidateCycleBundle | undefined> {
    const current = await this.candidateRepository.findCurrentCycle();
    if (!current || current.examCycle.curriculumVersionId === target.curriculum.id) return current;

    const now = this.clock.now();
    const examCycle = {
      ...current.examCycle,
      curriculumVersionId: target.curriculum.id,
      updatedAt: now,
      version: current.examCycle.version + 1
    };
    const policyBindings: readonly ExamCyclePolicyBinding[] = target.assessmentPolicies
      .filter((policy) => policy.status === 'published')
      .map((policy) => ({
        examCycleId: current.examCycle.id,
        subject: policy.subject,
        policyType: policy.policyType,
        assessmentPolicyVersionId: policy.id,
        boundAt: now
      }));

    await this.unitOfWork.run((context) => this.candidateRepository.replaceCurriculumBinding(
      examCycle,
      policyBindings,
      current.examCycle.version,
      context
    ));
    return this.candidateRepository.findCycle(current.examCycle.id);
  }
}
