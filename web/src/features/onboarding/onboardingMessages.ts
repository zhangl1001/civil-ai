export const OnboardingMessage = {
  SaveFailed: '暂时无法保存建档草稿',
  CreateFailed: '建档失败，请检查信息后重试',
  ActiveCycleExists: '当前已有进行中的备考周期',
  CurriculumUnavailable: '本地课程元数据不可用，请重新启动应用',
  InvalidScore: '分数必须在 0 到满分之间',
  InvalidDate: '请填写有效的考试日期',
  RequiredField: '请补全本步骤的必要信息',
  ExamPackUnavailable: '当前备考方向暂不可用，请重新选择'
} as const;

export function resolveOnboardingError(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return OnboardingMessage.CreateFailed;
  const code = String(error.code);
  if (code.includes('active_cycle')) return OnboardingMessage.ActiveCycleExists;
  if (code.includes('curriculum') || code.includes('policy_missing')) return OnboardingMessage.CurriculumUnavailable;
  if (code.includes('score')) return OnboardingMessage.InvalidScore;
  if (code.includes('date')) return OnboardingMessage.InvalidDate;
  if (code.includes('required') || code.includes('invalid')) return OnboardingMessage.RequiredField;
  return OnboardingMessage.CreateFailed;
}
