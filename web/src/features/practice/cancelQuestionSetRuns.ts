import type { TutorDatabaseRuntime } from '@/composition-root/public';

/** Stops unfinished work for a question set before the set leaves the practice library. */
export async function cancelQuestionSetRuns(
  runtime: TutorDatabaseRuntime,
  questionSetId: string
): Promise<void> {
  try {
    const runs = await runtime.getAgentRunViews.execute({ limit: 100 });
    const matching = runs.filter((run) => (
      run.isActive
      && (
        run.questionSetId === questionSetId
        || run.targetResourceId === questionSetId
        || run.actionParams.questionSetId === questionSetId
      )
    ));
    await Promise.allSettled(matching.map((run) => runtime.cancelAgentRun.execute({
      agentRunId: run.id,
      reason: 'question_set_retired'
    })));
  } catch {
    // Retirement remains authoritative. Enrichment and practice entry both reject retired sets.
  }
}
