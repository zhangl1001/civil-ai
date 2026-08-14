/**
 * The objective grading rule a question set was published under.
 *
 * Frozen at publish time rather than read from the active package at grading
 * time: a set answered after a package upgrade must still be marked by the rule
 * its questions were written for. The policy identity travels with it so a
 * stored score stays explainable once the package has moved on.
 *
 * Declared here rather than imported from the curriculum projection so the two
 * modules stay independent — this is the shape content persists, not the shape
 * a package publishes.
 */
export interface QuestionSetGradingPolicy {
  /** Fraction of the proportional score kept for an under-selected answer. */
  readonly underSelectionCreditWeight: number;
  readonly policyVersion: string;
  readonly policyHash: string;
}

/**
 * Reads a stored snapshot back, in the form storage holds it.
 *
 * Undefined for anything malformed, and for sets published before snapshots
 * existed, which grade against the active package rule exactly as they always
 * did. Owning the decode here keeps every caller from having to know whether
 * the column holds text or an object.
 */
export function parseQuestionSetGradingPolicy(stored: unknown): QuestionSetGradingPolicy | undefined {
  const value = typeof stored === 'string' ? tryParseJson(stored) : stored;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const weight = record.underSelectionCreditWeight;
  const policyVersion = record.policyVersion;
  const policyHash = record.policyHash;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) return undefined;
  if (typeof policyVersion !== 'string' || !policyVersion) return undefined;
  if (typeof policyHash !== 'string' || !policyHash) return undefined;
  return { underSelectionCreditWeight: weight, policyVersion, policyHash };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
