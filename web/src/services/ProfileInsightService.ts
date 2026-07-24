import { aiEngine } from '@/ai/AIEngine';
import type { ProfileInsightKind } from '@/domain/profileAnalysis';
import { abilityDiagnosisService } from './AbilityDiagnosisService';
import { examProfileRepository } from './ExamProfileRepository';
import { profileAnalysisRepository } from './ProfileAnalysisRepository';
import { projectRepository } from './ProjectRepository';

function buildInsightPrompt(input: {
  kind: ProfileInsightKind;
  projectName: string;
  profile: unknown;
  diagnosis: unknown;
}): string {
  return [
    '# 公考备考画像洞察',
    '你是一个严格、温和、目标驱动的公考备考教练。',
    '只能基于给定的结构化画像和诊断输出建议，不要编造不存在的数据。',
    '输出 Markdown，手机端阅读友好，控制在 260 字以内。',
    '',
    `洞察类型：${input.kind}`,
    `工程：${input.projectName}`,
    '',
    '## 建档信息',
    JSON.stringify(input.profile, null, 2),
    '',
    '## 确定性诊断',
    JSON.stringify(input.diagnosis, null, 2),
    '',
    '## 输出要求',
    '- 先说当前阶段和最重要矛盾。',
    '- 再给 2-3 条可执行建议。',
    '- 如果建档信息包含岗位、报考要求、时间预算、优势、阻碍或偏好，建议必须体现这些约束。',
    '- 最后一小句给备考人稳定感和行动感。',
    '- 不要输出虚假的分数或未给出的考试信息。'
  ].join('\n');
}

export class ProfileInsightService {
  async generate(kind: ProfileInsightKind = 'summary') {
    const project = await projectRepository.getActiveProject();
    const profile = await examProfileRepository.getActiveProfile(project.id);
    const diagnosis = await abilityDiagnosisService.refreshProject(project.id);
    const diagnosisRecord = await profileAnalysisRepository.latestDiagnosis(project.id, profile?.id);
    const content = await aiEngine.complete([
      { role: 'system', content: '你是公考备考教练。输出简洁 Markdown，不要编造数据。' },
      { role: 'user', content: buildInsightPrompt({ kind, projectName: project.name, profile, diagnosis }) }
    ], undefined, { temperature: 0.35 });
    return profileAnalysisRepository.saveInsight({
      projectId: project.id,
      profileId: profile?.id,
      diagnosisId: diagnosisRecord?.id,
      kind,
      content,
      expiresAt: Date.now() + 3 * 86400000
    });
  }

  async latest(kind: ProfileInsightKind = 'summary') {
    const project = await projectRepository.getActiveProject();
    const profile = await examProfileRepository.getActiveProfile(project.id);
    return profileAnalysisRepository.latestInsight(project.id, kind, profile?.id);
  }
}

export const profileInsightService = new ProfileInsightService();
