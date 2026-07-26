import { initializeTutorRuntime } from '@/composition-root/public';
import type { CapabilityNode } from '@/modules/curriculum/public';

export type ErrorCategory = '概念性错误' | '理解性错误' | '执行性错误';

export interface ErrorDistribution {
  '概念性错误': number;
  '理解性错误': number;
  '执行性错误': number;
}

export interface ErrorKnowledgePoint {
  name: string;
  module: string;
  errorType: ErrorCategory;
  errorCount: number;
  proficiency: number;
  latestAt: number;
}

export interface ErrorModuleReport {
  name: string;
  totalErrors: number;
  distribution: ErrorDistribution;
  points: ErrorKnowledgePoint[];
}

export interface ErrorReport {
  totalErrors: number;
  distribution: ErrorDistribution;
  modules: ErrorModuleReport[];
  topCategory?: ErrorCategory;
  weakest?: ErrorKnowledgePoint;
  recommendations: string[];
}

function emptyDistribution(): ErrorDistribution {
  return { '概念性错误': 0, '理解性错误': 0, '执行性错误': 0 };
}

function normalizeCategory(causeCode?: string): ErrorCategory {
  if (causeCode === 'concept_gap' || causeCode === 'retention_failure') return '概念性错误';
  if (
    causeCode === 'recognition_error'
    || causeCode === 'method_selection_error'
    || causeCode === 'reasoning_error'
    || causeCode === 'transfer_failure'
  ) return '理解性错误';
  return '执行性错误';
}

export class ErrorReportService {
  async report(): Promise<ErrorReport> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return this.emptyReport();
    const [wrongItems, curriculum, tracks] = await Promise.all([
      runtime.getWrongBookEntries.execute({ examCycleId: cycle.examCycle.id, limit: 100 }),
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.masteryRepository.listTracks(cycle.examCycle.id, 100)
    ]);
    const nodes = new Map((curriculum?.capabilityNodes || []).map((node) => [node.id, node]));
    const trackMap = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const moduleMap = new Map<string, ErrorModuleReport>();
    const distribution = emptyDistribution();

    for (const item of wrongItems) {
      const node = nodes.get(item.attempt.capabilityNodeId);
      const moduleName = moduleLabel(node, item.module, curriculum?.capabilityNodes || []);
      const pointName = node?.name || item.question.content.capabilityCode || moduleName;
      const dominantDiagnosis = item.diagnoses[0];
      const category = normalizeCategory(dominantDiagnosis?.causeCode);
      const errorCount = 1;
      const mastery = trackMap.get(item.attempt.capabilityNodeId);
      const proficiency = mastery ? Math.round(mastery.accuracy * 100) : 0;
      const moduleReport = moduleMap.get(moduleName) || {
        name: moduleName,
        totalErrors: 0,
        distribution: emptyDistribution(),
        points: []
      };
      moduleReport.totalErrors += errorCount;
      moduleReport.distribution[category] += errorCount;
      distribution[category] += errorCount;

      const current = moduleReport.points.find((point) => point.name === pointName);
      if (current) {
        current.errorCount += errorCount;
        current.latestAt = Math.max(current.latestAt, Number(item.attempt.submittedAt));
        current.errorType = moduleReport.distribution[current.errorType] >= moduleReport.distribution[category] ? current.errorType : category;
        current.proficiency = proficiency;
      } else {
        moduleReport.points.push({
          name: pointName,
          module: moduleName,
          errorType: category,
          errorCount,
          proficiency,
          latestAt: Number(item.attempt.submittedAt)
        });
      }
      moduleMap.set(moduleName, moduleReport);
    }

    const modules = Array.from(moduleMap.values())
      .map((module) => ({
        ...module,
        points: module.points.sort((a, b) => b.errorCount - a.errorCount || a.proficiency - b.proficiency).slice(0, 8)
      }))
      .sort((a, b) => b.totalErrors - a.totalErrors);
    const totalErrors = distribution['概念性错误'] + distribution['理解性错误'] + distribution['执行性错误'];
    const topCategory = (Object.entries(distribution) as Array<[ErrorCategory, number]>).sort((a, b) => b[1] - a[1])[0]?.[0];
    const weakest = modules.flatMap((module) => module.points).sort((a, b) => b.errorCount - a.errorCount || a.proficiency - b.proficiency)[0];

    return {
      totalErrors,
      distribution,
      modules,
      topCategory: totalErrors ? topCategory : undefined,
      weakest,
      recommendations: this.recommendations(totalErrors, distribution, weakest)
    };
  }

  private emptyReport(): ErrorReport {
    return {
      totalErrors: 0,
      distribution: emptyDistribution(),
      modules: [],
      recommendations: ['请先建立备考档案并完成练习。']
    };
  }

  private recommendations(totalErrors: number, distribution: ErrorDistribution, weakest?: ErrorKnowledgePoint): string[] {
    if (!totalErrors) return ['完成练习并批改后，错因报告会自动生成。'];
    const recs: string[] = [];
    const top = (Object.entries(distribution) as Array<[ErrorCategory, number]>).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) {
      recs.push(`主导错因为「${top[0].replace('错误', '')}」，占错题的 ${Math.round(top[1] / totalErrors * 100)}%，建议先做针对性复盘。`);
    }
    if (weakest) {
      recs.push(`最薄弱考点：${weakest.module} / ${weakest.name}，累计 ${weakest.errorCount} 次错误，建议立即专项加练。`);
    }
    if (totalErrors >= 20) recs.push('错题样本已足够，先复习高频错因再生成新题，避免继续堆叠同类错误。');
    return recs;
  }
}

export const errorReportService = new ErrorReportService();

function moduleLabel(node: CapabilityNode | undefined, fallback: string, nodes: readonly CapabilityNode[]): string {
  const moduleCode = node?.module || fallback;
  return nodes.find((item) => item.nodeType === 'module' && item.module === moduleCode)?.name || moduleCode || '专项练习';
}
