import type { AssessmentRole } from './AssessmentRole';
import {
  objectiveEvidenceOriginReliability,
  type ObjectiveEvidenceOrigin as ObjectiveEvidenceOriginCode
} from './ObjectiveEvidenceOrigin';

export const objectiveEvidencePolicyV2 = {
  version: 'aptitude-objective:v2',
  correctnessWeight(role: AssessmentRole, hintLevel: number, origin: ObjectiveEvidenceOriginCode): number {
    if (!Number.isInteger(hintLevel) || hintLevel < 0 || hintLevel > 5) {
      throw new RangeError('Hint level must be an integer between 0 and 5');
    }
    const base: Record<AssessmentRole, number> = {
      teaching: 0.1,
      guided: 0.25,
      practice: 0.6,
      retention: 0.85,
      transfer: 0.9,
      anchor: 1
    };
    return round(Math.max(
      0.05,
      base[role] * objectiveEvidenceOriginReliability(origin) * (1 - hintLevel * 0.15)
    ));
  },
  quality(hintLevel: number): number {
    if (!Number.isInteger(hintLevel) || hintLevel < 0 || hintLevel > 5) {
      throw new RangeError('Hint level must be an integer between 0 and 5');
    }
    return round(Math.max(0.1, 1 - hintLevel * 0.18));
  }
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
