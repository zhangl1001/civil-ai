import fixture from './civil-service-national-v2.json';
import { curriculumBundleFromFixture, type CurriculumFixture } from './curriculumBundleFromFixture';
import type { CurriculumBundle } from '../contracts/CurriculumRepository';

export function createBundledNationalCurriculum(): CurriculumBundle {
  return curriculumBundleFromFixture(fixture as CurriculumFixture);
}
