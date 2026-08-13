import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { CurriculumVersionId } from '@/kernel/public';
import { GetExamSubjects, type ExamSubjectView } from '@/modules/curriculum/public';

/** One selectable exam track, with everything the profile form needs to render it. */
export interface ExamPackOption {
  readonly examType: string;
  readonly examName: string;
  readonly regionScoped: boolean;
  readonly curriculumVersionId: CurriculumVersionId;
  /** Subjects the track sets score targets on, in package order. */
  readonly scoredSubjects: readonly ExamSubjectView[];
}

/**
 * Projects the installed exam packs for the profile form. Loading every track
 * up front keeps switching synchronous — there are only as many tracks as the
 * app ships with.
 */
export class ExamPackSelectionFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(): Promise<readonly ExamPackOption[]> {
    const getExamSubjects = new GetExamSubjects(this.runtime.curriculumRepository);
    return Promise.all(this.runtime.curriculumPacks.map(async (pack) => {
      const curriculumVersionId = pack.bundle.curriculum.id;
      const subjects = await getExamSubjects.execute(curriculumVersionId);
      return {
        examType: pack.examType,
        examName: pack.examName,
        regionScoped: pack.regionScoped,
        curriculumVersionId,
        scoredSubjects: subjects.filter((subject) => subject.score !== undefined)
      };
    }));
  }
}
