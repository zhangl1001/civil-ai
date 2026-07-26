import type { CapabilityNodeId, ExamCycleId, JsonObject } from '@/kernel/public';
import type { GenerationLearningContextPort } from '@/modules/content/application/GenerationContextCompiler';
import type {
  ErrorDiagnosisRepository,
  LearningSessionRepository
} from '@/modules/evidence/public';
import type { MasteryRepository } from '@/modules/mastery/public';

export function createGenerationLearningContextPort(
  mastery: MasteryRepository,
  sessions: LearningSessionRepository,
  diagnoses: ErrorDiagnosisRepository
): GenerationLearningContextPort {
  return {
    async build(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<JsonObject> {
      const [track, recentSessions] = await Promise.all([
        mastery.findTrack(examCycleId, capabilityNodeId),
        sessions.listRecent(examCycleId, 40)
      ]);
      const relevantSessions = recentSessions
        .filter((facts) => facts.attempts.some((attempt) => attempt.capabilityNodeId === capabilityNodeId))
        .slice(0, 8);
      const recentErrors: JsonObject[] = [];
      for (const facts of relevantSessions) {
        const sessionDiagnoses = await diagnoses.listBySession(facts.session.id);
        for (const attempt of facts.attempts) {
          if (attempt.capabilityNodeId !== capabilityNodeId || attempt.result !== 'incorrect') continue;
          const candidates = sessionDiagnoses
            .filter((diagnosis) => diagnosis.attemptId === attempt.id)
            .sort((left, right) => sourcePriority(right.source) - sourcePriority(left.source) || right.createdAt - left.createdAt);
          const diagnosis = candidates[0];
          const current = diagnosis ? await diagnoses.findCurrentProjection(diagnosis.id) : undefined;
          recentErrors.push({
            causeCode: current?.effectiveCauseCode ?? diagnosis?.causeCode ?? 'unknown',
            detail: current?.effectiveDetail ?? diagnosis?.detail ?? '错因证据不足',
            confirmationStatus: current?.confirmationStatus ?? diagnosis?.confirmationStatus ?? 'pending',
            elapsedMs: attempt.elapsedMs ?? null,
            answerChangeCount: attempt.answerChangeCount,
            occurredAt: attempt.submittedAt
          });
        }
      }
      return {
        hasMasteryProjection: Boolean(track),
        mastery: track ? {
          state: track.state,
          concept: track.concept,
          recognition: track.recognition,
          method: track.method,
          accuracy: track.accuracy,
          speed: track.speed,
          retention: track.retention,
          transfer: track.transfer,
          stability: track.stability,
          confidence: track.confidence,
          effectiveSample: track.effectiveSample,
          algorithmVersion: track.algorithmVersion,
          updatedAt: track.updatedAt
        } : null,
        recentErrors: recentErrors.slice(0, 8),
        recentSessions: relevantSessions.map((facts) => ({
          assessmentRole: facts.session.assessmentRole,
          questionCount: facts.session.questionCount,
          correctCount: facts.session.correctCount,
          elapsedMs: facts.session.elapsedMs,
          completedAt: facts.session.completedAt
        }))
      };
    }
  };
}

function sourcePriority(source: string): number {
  if (source === 'user') return 3;
  if (source === 'tutor_ai') return 2;
  return 1;
}
