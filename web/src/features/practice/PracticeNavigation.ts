export interface PracticeDetailTarget {
  readonly mode: 'tutor' | 'self';
  readonly module?: string;
  readonly knowledgePoint?: string;
  readonly capabilityNodeId?: string;
  readonly dailyPlanItemId?: string;
}

export function practiceDetailLocation(target: PracticeDetailTarget) {
  return {
    path: '/vue/practice',
    query: Object.fromEntries(
      Object.entries(target).filter(([, value]) => typeof value === 'string' && value.trim())
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
