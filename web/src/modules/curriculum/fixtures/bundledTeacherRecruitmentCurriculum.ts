import fixture from './teacher-recruitment-v1.json';
import { curriculumBundleFromFixture, type CurriculumFixture } from './curriculumBundleFromFixture';
import type { CurriculumBundle } from '../contracts/CurriculumRepository';

/**
 * A deliberately small second track. Two objective subjects, no prompt overrides
 * and no written formats — enough to exercise onboarding, generation, practice
 * and grading against a package whose subjects are not the civil-service ones.
 */
export function createBundledTeacherRecruitmentCurriculum(): CurriculumBundle {
  return curriculumBundleFromFixture(fixture as CurriculumFixture);
}
