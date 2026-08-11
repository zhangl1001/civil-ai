export const MasteryState={Unassessed:'unassessed',Diagnosed:'diagnosed',Learning:'learning',Practicing:'practicing',Consolidating:'consolidating',Mastered:'mastered',Maintaining:'maintaining',Regressed:'regressed'} as const;
export type MasteryState=typeof MasteryState[keyof typeof MasteryState];
export const ReviewType={Retention:'retention',Transfer:'transfer',Anchor:'anchor',Repair:'repair'} as const;
export type ReviewType=typeof ReviewType[keyof typeof ReviewType];
export const ReviewStatus={Scheduled:'scheduled',InProgress:'in_progress',Completed:'completed',Cancelled:'cancelled',Failed:'failed'} as const;
export type ReviewStatus=typeof ReviewStatus[keyof typeof ReviewStatus];
export const ReviewReasonCode={RecentPerformanceRegression:'recent_performance_regression',SpacedRetentionMaintenance:'spaced_retention_maintenance',MasteryEvidenceIncomplete:'mastery_evidence_incomplete'} as const;
export type ReviewReasonCode=typeof ReviewReasonCode[keyof typeof ReviewReasonCode];
