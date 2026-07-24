import type { LearningSessionId } from '@/kernel/public';
import type { ContentRepository, QuestionRecord } from '@/modules/content/public';
import type { ErrorDiagnosisRepository, LearningSessionRepository } from '../contracts/LearningRepositories';
import type { AttemptRecord, ErrorDiagnosisRecord, GradingResultRecord, LearningSessionRecord } from '../contracts/LearningFacts';

export interface ObjectiveSessionReviewItem {
  readonly question: QuestionRecord;
  readonly attempt: AttemptRecord;
  readonly grading: GradingResultRecord;
  readonly diagnoses: readonly ErrorDiagnosisRecord[];
}

export interface ObjectiveSessionReview {
  readonly session: LearningSessionRecord;
  readonly items: readonly ObjectiveSessionReviewItem[];
}

export class GetObjectiveSessionReview {
  constructor(
    private readonly sessionRepository: LearningSessionRepository,
    private readonly diagnosisRepository: ErrorDiagnosisRepository,
    private readonly contentRepository: ContentRepository
  ) {}

  async execute(sessionId: LearningSessionId): Promise<ObjectiveSessionReview | undefined> {
    const facts = await this.sessionRepository.findById(sessionId);
    if (!facts) return undefined;
    const [content, diagnoses] = await Promise.all([
      this.contentRepository.findQuestionSet(facts.session.questionSetId),
      this.diagnosisRepository.listBySession(sessionId)
    ]);
    if (!content) throw new Error(`Question set no longer exists for session: ${sessionId}`);
    const questionsById = new Map(content.questions.map((question) => [question.id, question]));
    const gradingsByAttemptId = new Map(facts.gradings.map((grading) => [grading.attemptId, grading]));
    const diagnosesByAttemptId = new Map<string, ErrorDiagnosisRecord[]>();
    diagnoses.forEach((diagnosis) => {
      const items = diagnosesByAttemptId.get(diagnosis.attemptId) ?? [];
      items.push(diagnosis);
      diagnosesByAttemptId.set(diagnosis.attemptId, items);
    });
    const items = facts.attempts.map((attempt) => {
      const question = questionsById.get(attempt.questionId);
      const grading = gradingsByAttemptId.get(attempt.id);
      if (!question || !grading) throw new Error(`Objective session has incomplete attempt aggregate: ${attempt.id}`);
      return { question, attempt, grading, diagnoses: diagnosesByAttemptId.get(attempt.id) ?? [] };
    });
    return { session: facts.session, items };
  }
}
