export const ProjectStatus = {
  Active: 'active',
  Archived: 'archived'
} as const;

export type ProjectStatus = typeof ProjectStatus[keyof typeof ProjectStatus];
