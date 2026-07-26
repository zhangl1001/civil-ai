import type { ErrorCauseCode } from './EvidenceCodes';

/** Stable user-facing vocabulary for the structured error-cause taxonomy. */
export const errorCauseLabel: Readonly<Record<ErrorCauseCode, string>> = {
  concept_gap: '概念理解不牢',
  recognition_error: '题型识别偏差',
  method_selection_error: '方法选择不当',
  reasoning_error: '推理链条偏差',
  calculation_error: '计算过程失误',
  evidence_extraction_error: '材料定位遗漏',
  trap_misjudgment: '干扰项判断偏差',
  time_management_error: '时间分配不足',
  careless_error: '审题或操作疏漏',
  transfer_failure: '变式迁移不足',
  retention_failure: '间隔复习遗忘',
  unknown: '需要补充证据'
};
