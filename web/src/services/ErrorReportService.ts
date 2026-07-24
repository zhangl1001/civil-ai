import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { Question } from '@/domain/question';
import type { WrongItem } from '@/domain/wrongbook';
import { practiceFlowService } from './PracticeFlowService';
import { projectRepository } from './ProjectRepository';

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

function normalizeCategory(reason?: string): ErrorCategory {
  if (!reason) return '执行性错误';
  if (reason.includes('概念')) return '概念性错误';
  if (reason.includes('理解')) return '理解性错误';
  return '执行性错误';
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export class ErrorReportService {
  async report(): Promise<ErrorReport> {
    const project = await projectRepository.getActiveProject();
    const wrongItems = await database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id);
    const openWrongItems = wrongItems.filter((item) => item.status !== 'mastered');
    const questions = await this.questionMap(openWrongItems.map((item) => item.questionId));
    const moduleMap = new Map<string, ErrorModuleReport>();
    const distribution = emptyDistribution();

    for (const item of openWrongItems) {
      const question = questions.get(item.questionId);
      const moduleName = item.module || question?.module || '专项练习';
      const pointName = question?.knowledgePoint || this.inferKnowledgePoint(question?.stem) || moduleName;
      const category = normalizeCategory(item.reason);
      const errorCount = Math.max(1, item.wrongCount || 1);
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
        current.latestAt = Math.max(current.latestAt, item.updatedAt || item.lastWrongAt);
        current.errorType = moduleReport.distribution[current.errorType] >= moduleReport.distribution[category] ? current.errorType : category;
        current.proficiency = Math.max(0, Math.round(100 - Math.min(100, current.errorCount * 18)));
      } else {
        moduleReport.points.push({
          name: pointName,
          module: moduleName,
          errorType: category,
          errorCount,
          proficiency: Math.max(0, Math.round(100 - Math.min(100, errorCount * 18))),
          latestAt: item.updatedAt || item.lastWrongAt
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

  startWeakPractice(report: ErrorReport): void {
    practiceFlowService.writeStartContext({
      module: report.weakest?.module || report.modules[0]?.name || '资料分析',
      knowledgePoint: report.weakest?.name,
      date: today(),
      mode: 'practice',
      source: 'error-report',
      questionCount: 10
    });
  }

  private async questionMap(questionIds: string[]): Promise<Map<string, Question>> {
    const unique = Array.from(new Set(questionIds));
    const pairs = await Promise.all(unique.map(async (id) => [id, await database.get<Question>(STORES.questions, id)] as const));
    return new Map(pairs.filter((pair): pair is readonly [string, Question] => Boolean(pair[1])));
  }

  private inferKnowledgePoint(stem?: string): string | undefined {
    if (!stem) return undefined;
    const clean = stem.replace(/\s+/g, '');
    return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
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
