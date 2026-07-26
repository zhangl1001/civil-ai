import type { ErrorDiagnosisId, ExamCycleId, LearningSessionId } from '@/kernel/public';
import type { QuestionRecord } from '@/modules/content/public';
import type { ErrorDiagnosisRepository, LearningSessionRepository } from '../contracts/LearningRepositories';
import type {
  AttemptRecord,
  ErrorDiagnosisCurrentProjection,
  ErrorDiagnosisRecord,
  GradingResultRecord,
  LearningSessionRecord
} from '../contracts/LearningFacts';
import { AttemptResult, type ErrorCauseCode } from '../domain/EvidenceCodes';
import type { ContentRepository } from '@/modules/content/public';

/**
 * Read model for the review experience. It never mutates source attempts or
 * diagnoses: UI state must be derived from immutable learning facts.
 */
export interface WrongBookEntry {
  readonly id: string;
  readonly module: string;
  readonly session: LearningSessionRecord;
  readonly question: QuestionRecord;
  readonly attempt: AttemptRecord;
  readonly grading: GradingResultRecord;
  readonly diagnoses: readonly WrongBookDiagnosis[];
}

export interface WrongBookDiagnosis {
  readonly diagnosis: ErrorDiagnosisRecord;
  readonly current?: ErrorDiagnosisCurrentProjection;
  readonly causeCode: ErrorCauseCode;
  readonly detail: string;
}

export class GetWrongBookEntries {
  constructor(
    private readonly sessions: LearningSessionRepository,
    private readonly diagnoses: ErrorDiagnosisRepository,
    private readonly content: ContentRepository
  ) {}

  async execute(command: { readonly examCycleId: ExamCycleId; readonly limit: number }): Promise<readonly WrongBookEntry[]> {
    assertLimit(command.limit);
    const sessions = await this.sessions.listRecent(
      command.examCycleId,
      Math.min(500, Math.max(100, command.limit * 5))
    );
    const relevantSessions = sessions.filter((facts) => (
      facts.attempts.some((attempt) => attempt.result === AttemptResult.Incorrect)
    ));
    const questionSetIds = [...new Set(relevantSessions.map((facts) => facts.session.questionSetId))];
    const [bundles, diagnoses] = await Promise.all([
      Promise.all(questionSetIds.map((id) => this.content.findQuestionSet(id))),
      this.diagnoses.listBySessions(relevantSessions.map((facts) => facts.session.id as LearningSessionId))
    ]);
    const projections = await this.diagnoses.listCurrentProjections(
      diagnoses.map((diagnosis) => diagnosis.id as ErrorDiagnosisId)
    );
    const bundlesById = new Map(bundles.flatMap((bundle) => (
      bundle ? [[bundle.questionSet.id, bundle] as const] : []
    )));
    const diagnosesBySession = groupBySession(diagnoses);
    const projectionsById = new Map(projections.map((projection) => [projection.diagnosisId, projection]));
    const entries: WrongBookEntry[] = [];

    for (const facts of relevantSessions) {
      if (entries.length >= command.limit) break;
      const incorrectAttempts = facts.attempts.filter((attempt) => attempt.result === AttemptResult.Incorrect);
      const bundle = bundlesById.get(facts.session.questionSetId);
      if (!bundle) continue;
      const questions = new Map(bundle.questions.map((question) => [question.id, question]));
      const gradings = new Map(facts.gradings.map((grading) => [grading.attemptId, grading]));
      const diagnosesByAttempt = groupByAttempt(diagnosesBySession.get(facts.session.id) ?? []);

      for (const attempt of incorrectAttempts) {
        if (entries.length >= command.limit) break;
        const question = questions.get(attempt.questionId);
        const grading = gradings.get(attempt.id);
        if (!question || !grading) continue;
        const relevantDiagnoses = diagnosesByAttempt.get(attempt.id) ?? [];
        const resolved = relevantDiagnoses.map((diagnosis) => {
          const current = projectionsById.get(diagnosis.id);
          return {
            diagnosis,
            current,
            causeCode: current?.effectiveCauseCode ?? diagnosis.causeCode,
            detail: current?.effectiveDetail ?? diagnosis.detail
          };
        });
        entries.push({
          id: `${facts.session.id}:${attempt.id}`,
          module: bundle.questionSet.module,
          session: facts.session,
          question,
          attempt,
          grading,
          diagnoses: resolved
        });
      }
    }
    return entries;
  }
}

function groupBySession(
  diagnoses: readonly ErrorDiagnosisRecord[]
): ReadonlyMap<string, readonly ErrorDiagnosisRecord[]> {
  const grouped = new Map<string, ErrorDiagnosisRecord[]>();
  diagnoses.forEach((diagnosis) => {
    const items = grouped.get(diagnosis.sessionId) ?? [];
    items.push(diagnosis);
    grouped.set(diagnosis.sessionId, items);
  });
  return grouped;
}

function groupByAttempt(diagnoses: readonly ErrorDiagnosisRecord[]): ReadonlyMap<string, readonly ErrorDiagnosisRecord[]> {
  const grouped = new Map<string, ErrorDiagnosisRecord[]>();
  diagnoses.forEach((diagnosis) => {
    const items = grouped.get(diagnosis.attemptId) ?? [];
    items.push(diagnosis);
    grouped.set(diagnosis.attemptId, items);
  });
  return grouped;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Wrong-book query limit must be between 1 and 100');
  }
}
