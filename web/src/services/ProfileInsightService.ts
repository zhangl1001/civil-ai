import { configuredAIClient, initializeTutorRuntime } from '@/composition-root/public';
import type { ProfileInsight, ProfileInsightKind } from '@/domain/profileAnalysis';
import type { JsonObject } from '@/kernel/public';
import { LearningAssetKind } from '@/modules/content/public';
import { qualityDashboardService } from './QualityDashboardService';

function buildInsightPrompt(input: {
  kind: ProfileInsightKind;
  candidate: unknown;
  diagnosis: unknown;
}): string {
  return [
    '# 公考备考画像洞察',
    '你是一个严格、温和、目标驱动的公考备考教练。',
    '只能基于给定的结构化画像和诊断输出建议，不要编造不存在的数据。',
    '输出 Markdown，手机端阅读友好，控制在 260 字以内。',
    '',
    `洞察类型：${input.kind}`,
    '',
    '## 建档信息',
    JSON.stringify(input.candidate, null, 2),
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
  async generate(kind: ProfileInsightKind = 'summary'): Promise<ProfileInsight> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const [candidate, dashboard] = await Promise.all([
      runtime.getCandidateHome.execute(),
      qualityDashboardService.dashboard()
    ]);
    const content = await configuredAIClient.complete([
      { role: 'system', content: '你是公考备考教练。输出简洁 Markdown，不要编造数据。' },
      { role: 'user', content: buildInsightPrompt({ kind, candidate, diagnosis: dashboard.diagnosis }) }
    ], undefined, { temperature: 0.35 });
    const expiresAt = Date.now() + 3 * 86_400_000;
    const asset = await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.ProfileInsight,
      businessKey: insightBusinessKey(kind),
      title: 'AI 教练洞察',
      payload: {
        kind,
        content,
        expiresAt,
        diagnosisAlgorithmVersion: dashboard.diagnosis.algorithmVersion
      }
    });
    return toProfileInsight(asset.id, cycle.project.id, cycle.profile.id, kind, content, asset.updatedAt, expiresAt);
  }

  async latest(kind: ProfileInsightKind = 'summary'): Promise<ProfileInsight | undefined> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    const asset = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.ProfileInsight,
      insightBusinessKey(kind)
    );
    if (!asset) return undefined;
    const content = textField(asset.payload.content);
    if (!content) return undefined;
    const expiresAt = numberField(asset.payload.expiresAt);
    return toProfileInsight(
      asset.id,
      cycle.project.id,
      cycle.profile.id,
      kind,
      content,
      asset.updatedAt,
      expiresAt
    );
  }
}

export const profileInsightService = new ProfileInsightService();

function insightBusinessKey(kind: ProfileInsightKind): string {
  return `candidate-insight:${kind}`;
}

function toProfileInsight(
  id: string,
  projectId: string,
  profileId: string,
  kind: ProfileInsightKind,
  content: string,
  generatedAt: number,
  expiresAt?: number
): ProfileInsight {
  return { id, projectId, profileId, kind, content, generatedAt, expiresAt };
}

function textField(value: JsonObject[string]): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: JsonObject[string]): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
