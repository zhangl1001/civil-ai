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

/**
 * Module codes baked into AI tool schemas, which are built at import time and
 * therefore cannot read the installed exam package. Only codes live here —
 * display names come from the package. Kept in a package-free file so tool
 * catalogs never pull in the reactive label registry.
 */
export const APTITUDE_MODULE_CODES: readonly string[] = [
  PracticeModuleCode.Judgment,
  PracticeModuleCode.Verbal,
  PracticeModuleCode.DataAnalysis,
  PracticeModuleCode.Quantity,
  PracticeModuleCode.CommonSense
];
