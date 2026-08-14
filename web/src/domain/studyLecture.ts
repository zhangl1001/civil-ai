export const STUDY_LECTURE_DEFAULT_MODULE = '公考';

/**
 * Identity of a lecture in the learning-asset store.
 *
 * One knowledge point owns one lecture, so this key is what lets an already
 * generated lecture be reused instead of regenerated. It is built from the
 * module *code* rather than its display label, because labels are presentation
 * and may be reworded without invalidating stored content.
 *
 * The generator and every reader must derive the key the same way; keeping the
 * format in one place is what stops the two sides from drifting apart into a
 * silent cache miss that quietly regenerates on every visit.
 */
export function studyLectureBusinessKey(moduleCode: string, topic: string): string {
  const normalizedModule = moduleCode.trim() || STUDY_LECTURE_DEFAULT_MODULE;
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) throw new TypeError('Study lecture identity requires a topic');
  return `study:${normalizedModule}:${normalizedTopic}`;
}
