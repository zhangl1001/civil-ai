export const LearningResourceType = {
  Lecture: 'lecture',
  Digest: 'digest'
} as const;

export type LearningResourceType = typeof LearningResourceType[keyof typeof LearningResourceType];

export const LearningProgressStatus = {
  Started: 'started',
  Completed: 'completed'
} as const;

export type LearningProgressStatus = typeof LearningProgressStatus[keyof typeof LearningProgressStatus];
