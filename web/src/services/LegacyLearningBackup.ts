import type { TransactionContext } from '@/capabilities/database/public';
import type { TutorDatabaseRuntime } from '@/composition-root/database/TutorDatabaseRuntime';
import type { ExamCycleId, LearningThreadId } from '@/kernel/public';
import type { CommittedQuestionSetBundle } from '@/modules/content/public';
import type { ErrorDiagnosisRecord, ObjectiveSessionFacts } from '@/modules/evidence/public';
import type { LearningThreadAggregate } from '@/modules/teaching/public';
import type { LegacyLearningRecords } from './DataBackupFormat';

export type LegacyLearningRuntime = Pick<
  TutorDatabaseRuntime,
  | 'dataMaintenance'
  | 'contentRepository'
  | 'generationRepository'
  | 'learningThreadRepository'
  | 'learningSessionRepository'
  | 'errorDiagnosisRepository'
  | 'learningEvidenceRepository'
  | 'masteryRepository'
  | 'dailyPlanRepository'
  | 'learningAssetRepository'
>;

/** The business view a v2 backup carried; still what the data summary counts. */
export async function collectLegacyLearningRecords(
  runtime: LegacyLearningRuntime,
  examCycleId: ExamCycleId
): Promise<LegacyLearningRecords> {
  const [questionSets, sessions, masteryTracks, reviewQueue, assets] = await Promise.all([
    runtime.contentRepository.listAllQuestionSets(examCycleId),
    runtime.learningSessionRepository.listAll(examCycleId),
    runtime.masteryRepository.listAllTracks(examCycleId),
    runtime.masteryRepository.listAllReviews(examCycleId),
    runtime.learningAssetRepository.listAll(examCycleId)
  ]);
  const [threads, diagnoses, evidence, dailyPlans] = await Promise.all([
    collectThreads(runtime, questionSets, sessions),
    collectDiagnoses(runtime, sessions),
    runtime.learningEvidenceRepository.listAllValid(examCycleId),
    runtime.dailyPlanRepository.listAll(examCycleId)
  ]);
  return {
    threads,
    questionSets: [...questionSets],
    sessions: [...sessions],
    diagnoses,
    evidence: [...evidence],
    masteryTracks: [...masteryTracks],
    reviewQueue: [...reviewQueue],
    dailyPlans: [...dailyPlans],
    assets: [...assets]
  };
}

/**
 * Writes a v2 backup through the repositories into a cycle holding no learning
 * data. Its sets keep their practice status and retirement, and the generation
 * spec and workflow each set was committed from are written first.
 */
export function restoreLegacyLearningRecords(
  runtime: LegacyLearningRuntime,
  examCycleId: ExamCycleId,
  learning: LegacyLearningRecords,
  context: TransactionContext
): Promise<number> {
  return runtime.dataMaintenance.restoreLegacyRecords(examCycleId, context, async () => {
    let count = 0;
    for (const aggregate of learning.threads) {
      if (!aggregate.events.length) continue;
      await runtime.learningThreadRepository.restore(aggregate, context);
      count += 1;
    }
    const generationSpecs = new Set<string>();
    for (const bundle of learning.questionSets) {
      if (!generationSpecs.has(bundle.generationSpec.id)) {
        generationSpecs.add(bundle.generationSpec.id);
        await runtime.generationRepository.create(
          { spec: bundle.generationSpec, workflow: bundle.generationWorkflow },
          context
        );
      }
      await runtime.contentRepository.restoreQuestionSet(bundle, context);
      count += bundle.questions.length + 1;
    }
    for (const facts of learning.sessions) {
      await runtime.learningSessionRepository.commitObjectiveSession(facts, context);
      count += facts.attempts.length + 1;
    }
    if (learning.diagnoses.length) {
      await runtime.errorDiagnosisRepository.append(learning.diagnoses, context);
      count += learning.diagnoses.length;
    }
    if (learning.evidence.length) {
      await runtime.learningEvidenceRepository.append(
        learning.evidence,
        learning.evidence.map((item) => ({
          evidenceId: item.id,
          validityStatus: 'valid',
          updatedAt: item.occurredAt,
          version: 1
        })),
        context
      );
      count += learning.evidence.length;
    }
    for (const track of learning.masteryTracks) {
      await runtime.masteryRepository.upsertTrack(track, undefined, context);
      count += 1;
    }
    for (const item of learning.reviewQueue) {
      await runtime.masteryRepository.scheduleReview(item, context);
      count += 1;
    }
    for (const plan of learning.dailyPlans) {
      await runtime.dailyPlanRepository.replaceCurrent(plan, undefined, context);
      count += plan.items.length + 1;
    }
    for (const asset of learning.assets) {
      await runtime.learningAssetRepository.save(asset, context);
      count += 1;
    }
    return count;
  });
}

async function collectThreads(
  runtime: LegacyLearningRuntime,
  questionSets: readonly CommittedQuestionSetBundle[],
  sessions: readonly ObjectiveSessionFacts[]
): Promise<LearningThreadAggregate[]> {
  const ids = new Set<string>();
  questionSets.forEach((bundle) => {
    if (bundle.questionSet.learningThreadId) ids.add(bundle.questionSet.learningThreadId);
  });
  sessions.forEach((facts) => ids.add(facts.session.learningThreadId));
  const values = await Promise.all([...ids].map((id) => runtime.learningThreadRepository.findById(id as LearningThreadId)));
  return values.filter((item): item is LearningThreadAggregate => Boolean(item));
}

async function collectDiagnoses(
  runtime: LegacyLearningRuntime,
  sessions: readonly ObjectiveSessionFacts[]
): Promise<ErrorDiagnosisRecord[]> {
  const groups = await Promise.all(sessions.map((facts) => runtime.errorDiagnosisRepository.listBySession(facts.session.id)));
  return groups.flatMap((items) => [...items]);
}
