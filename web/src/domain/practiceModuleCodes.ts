export const PracticeModuleCode = {
  Judgment: 'judgment',
  Verbal: 'verbal',
  DataAnalysis: 'data_analysis',
  Quantity: 'quantity',
  CommonSense: 'common_sense',
  Aptitude: 'aptitude',
  Essay: 'essay',
  Interview: 'interview'
} as const;

export type PracticeModuleCode = typeof PracticeModuleCode[keyof typeof PracticeModuleCode];
