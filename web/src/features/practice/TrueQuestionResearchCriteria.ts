import { practiceModuleLabel } from '@/domain/labels';

export const TrueQuestionResearchExamType = {
  National: 'national',
  Provincial: 'provincial'
} as const;

export const TrueQuestionResearchYearRange = {
  RecentThreeYears: 'recent_three_years',
  RecentFiveYears: 'recent_five_years',
  AnyYear: 'any_year'
} as const;

export const TrueQuestionResearchSourcePreference = {
  OfficialFirst: 'official_first',
  VerifiablePublic: 'verifiable_public'
} as const;

export interface TrueQuestionResearchCriteria {
  examType: typeof TrueQuestionResearchExamType[keyof typeof TrueQuestionResearchExamType];
  province: string;
  yearRange: typeof TrueQuestionResearchYearRange[keyof typeof TrueQuestionResearchYearRange];
  module: string;
  keyword: string;
  sourcePreference: typeof TrueQuestionResearchSourcePreference[keyof typeof TrueQuestionResearchSourcePreference];
  maxQuestions: number;
}

export function defaultTrueQuestionResearchCriteria(input: {
  readonly examName?: string;
  readonly province?: string;
  readonly module?: string;
}): TrueQuestionResearchCriteria {
  const national = input.examName?.includes('国家') || input.province === '全国';
  return {
    examType: national ? TrueQuestionResearchExamType.National : TrueQuestionResearchExamType.Provincial,
    province: national ? '全国' : input.province || '江苏',
    yearRange: TrueQuestionResearchYearRange.RecentThreeYears,
    module: input.module || '',
    keyword: '',
    sourcePreference: TrueQuestionResearchSourcePreference.OfficialFirst,
    maxQuestions: 5
  };
}

export function trueQuestionResearchScope(criteria: TrueQuestionResearchCriteria): string {
  const exam = criteria.examType === TrueQuestionResearchExamType.National
    ? '国家公务员考试'
    : `${criteria.province || '当前报考地区'}公务员考试`;
  const years = ({
    [TrueQuestionResearchYearRange.RecentThreeYears]: '最近三年',
    [TrueQuestionResearchYearRange.RecentFiveYears]: '最近五年',
    [TrueQuestionResearchYearRange.AnyYear]: '不限年份'
  } as const)[criteria.yearRange];
  const module = criteria.module ? `行测${practiceModuleLabel(criteria.module)}` : '行测全模块';
  const source = criteria.sourcePreference === TrueQuestionResearchSourcePreference.OfficialFirst
    ? '官方或考试主管部门来源优先，其他来源必须可核验'
    : '允许可核验的公开来源，不得把搜索摘要当作题目正文';
  return [
    exam,
    years,
    module,
    criteria.keyword.trim() ? `补充范围：${criteria.keyword.trim()}` : '',
    source
  ].filter(Boolean).join('；');
}
