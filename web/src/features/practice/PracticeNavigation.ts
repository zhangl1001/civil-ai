export interface PracticeDetailTarget {
  readonly mode: 'tutor' | 'self';
  readonly subject?: 'aptitude' | 'essay';
  readonly module?: string;
  readonly knowledgePoint?: string;
  readonly capabilityNodeId?: string;
  readonly dailyPlanItemId?: string;
  readonly count?: number;
  readonly autoStart?: boolean;
  readonly source?: string;
}

export function practiceDetailLocation(target: PracticeDetailTarget) {
  const { autoStart, count, ...identity } = target;
  return {
    path: '/vue/practice',
    query: Object.fromEntries(
      Object.entries({
        ...identity,
        ...(count ? { count: String(count) } : {}),
        ...(autoStart ? { start: '1' } : {})
      }).filter(([, value]) => typeof value === 'string' && value.trim())
    )
  };
}

export function objectivePracticeLocation(target: {
  readonly questionSetId: string;
  readonly learningThreadId?: string;
}) {
  return {
    path: '/vue/practice/objective-session',
    query: {
      questionSetId: target.questionSetId,
      ...(target.learningThreadId?.trim() ? { learningThreadId: target.learningThreadId } : {})
    }
  };
}
