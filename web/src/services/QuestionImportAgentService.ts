import type { JsonObject } from '@/kernel/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import {
  QuestionImportMethod,
  QuestionOriginType,
  type ScanQuestionImportDraft
} from '@/modules/content/public';
import type { CapabilityNode, CurriculumRepository } from '@/modules/curriculum/public';

export interface QuestionImportAgentDependencies {
  readonly candidates: CandidateRepository;
  readonly curriculums: CurriculumRepository;
  readonly scanDraft: ScanQuestionImportDraft;
}

export interface QuestionImportAgentScanContext {
  readonly agentRunId: string;
  readonly callId: string;
  readonly ownerSessionId?: string;
  readonly importedBy: 'chat_agent' | 'research_agent';
}

/** Shared boundary between Agent tool arguments and the typed question-import application layer. */
export class QuestionImportAgentService {
  constructor(private readonly dependencies: QuestionImportAgentDependencies) {}

  async scan(argumentsValue: Record<string, unknown>, context: QuestionImportAgentScanContext) {
    const cycle = await this.dependencies.candidates.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案，再导入题目。');
    const curriculum = await this.dependencies.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
    if (!curriculum) throw new Error('当前备考大纲暂时无法读取。');
    const capabilityText = String(argumentsValue.capability || '').trim();
    const capability = resolveCapability(curriculum.capabilityNodes, capabilityText);
    if (!capability) {
      const possible = curriculum.capabilityNodes
        .filter((node) => node.status === 'active' && fuzzyMatch(node.code, node.name, capabilityText))
        .slice(0, 5)
        .map((node) => ({ code: node.code, name: node.name, module: node.module }));
      throw new Error(`无法唯一确定能力节点，请缩小到一个明确考点。候选：${JSON.stringify(possible)}`);
    }
    const sourceMetadata = asRecord(argumentsValue.sourceMetadata);
    const questions = asRecordArray(argumentsValue.questions, 'questions');
    const materialGroups = Array.isArray(argumentsValue.materialGroups)
      ? asRecordArray(argumentsValue.materialGroups, 'materialGroups').map((group) => ({
          id: String(group.id || ''),
          markdown: String(group.markdown || '')
        }))
      : [];
    const importMethod = String(argumentsValue.importMethod || '') as typeof QuestionImportMethod[keyof typeof QuestionImportMethod];
    const view = await this.dependencies.scanDraft.execute({
      idempotencyKey: `agent:${context.agentRunId}:${context.callId}:question-scan`,
      examCycleId: cycle.examCycle.id,
      capabilityNodeId: capability.id,
      capabilityCode: capability.code,
      module: String(argumentsValue.module || capability.module),
      ownerSessionId: context.ownerSessionId,
      sourceType: String(argumentsValue.sourceType || '') as typeof QuestionOriginType[keyof typeof QuestionOriginType],
      importMethod,
      sourceMetadata: {
        provider: optionalString(sourceMetadata.provider),
        examType: optionalString(sourceMetadata.examType),
        examYear: optionalNumber(sourceMetadata.examYear),
        province: optionalString(sourceMetadata.province),
        examBatch: optionalString(sourceMetadata.examBatch),
        paperName: optionalString(sourceMetadata.paperName),
        sectionName: optionalString(sourceMetadata.sectionName),
        sourceVersion: optionalString(sourceMetadata.sourceVersion),
        provenance: {
          importedBy: context.importedBy,
          ownerSessionId: context.ownerSessionId ?? null,
          agentRunId: context.agentRunId,
          acquisitionChannel: importMethod === QuestionImportMethod.WebResearch
            ? 'agent_web_search'
            : 'user_import',
          sourceUrl: optionalString(sourceMetadata.sourceUrl) ?? null,
          sourceDomain: optionalString(sourceMetadata.sourceDomain) ?? null,
          searchQuery: optionalString(sourceMetadata.searchQuery) ?? null,
          fetchedAt: optionalNumber(sourceMetadata.fetchedAt) ?? null
        }
      },
      materialGroups,
      candidates: questions.map((question) => ({
        raw: question,
        difficulty: optionalNumber(question.difficulty)
      }))
    });
    return view;
  }
}

function resolveCapability(
  nodes: readonly CapabilityNode[],
  value: string
) {
  const active = nodes.filter((node) => node.status === 'active');
  const exact = active.filter((node) => (
    node.code.toLocaleLowerCase() === value.toLocaleLowerCase() || node.name === value
  ));
  if (exact.length === 1) return exact[0];
  const fuzzy = active.filter((node) => fuzzyMatch(node.code, node.name, value));
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

function fuzzyMatch(code: string, name: string, value: string): boolean {
  if (!value) return false;
  const normalized = value.toLocaleLowerCase();
  return code.toLocaleLowerCase().includes(normalized)
    || name.includes(value)
    || value.includes(name);
}

function asRecord(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('工具参数必须是对象。');
  }
  return value as JsonObject;
}

function asRecordArray(value: unknown, field: string): readonly JsonObject[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} 必须是数组。`);
  return value.map((item) => asRecord(item));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}
