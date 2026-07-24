export const PRACTICE_ERROR_TYPES = [
  '概念性错误',
  '理解性错误',
  '计算性错误',
  '审题性错误',
  '方法选择错误',
  '粗心失误',
  '未作答'
] as const;

export type PracticeErrorType = typeof PRACTICE_ERROR_TYPES[number];

type PracticeGradingChapter =
  | {
      id: string;
      title: string;
      rules: string[];
    }
  | {
      id: string;
      title: string;
      enum: readonly string[];
    }
  | {
      id: string;
      title: string;
      schema: Record<string, unknown>;
    }
  | {
      id: string;
      title: string;
      sections: Record<string, string[]>;
    };

export const PRACTICE_GRADING_BOOK: {
  title: string;
  chapters: PracticeGradingChapter[];
} = {
  title: '行测批改规范',
  chapters: [
    {
      id: 'role',
      title: '角色定位',
      rules: [
        '你是严格的公务员行测批改老师。',
        '只根据题干、选项、用户答案、正确答案和原解析批改。',
        '只批改用户答错或未作答的题，不能输出答对题。',
        '只输出 JSON 对象，不要 Markdown，不要解释，不要代码围栏。'
      ]
    },
    {
      id: 'error_types',
      title: '错因分类',
      enum: PRACTICE_ERROR_TYPES
    },
    {
      id: 'output_schema',
      title: '输出格式',
      schema: {
        grades: [
          {
            questionId: '题目ID，必须原样返回',
            errorType: '只能从错因分类枚举中选择',
            errorDetail: '结合本题题干和用户答案，指出用户答案为什么不成立，不少于30字',
            correctApproach: '说明正确答案为什么成立，包括关键条件、推理步骤或计算过程，不少于30字',
            tips: '给出下一次避免同类错误的可执行提醒，不少于20字'
          }
        ]
      }
    },
    {
      id: 'quality_floor',
      title: '质量底线',
      rules: [
        'errorDetail 不能泛泛而谈，必须点出本题具体错在哪里。',
        'errorDetail 禁止写“与标准答案不一致”“答案错误”“选择错误”“不符合题意”这类没有信息量的废话。',
        'errorType 必须是错因分类枚举之一，不能把“与标准答案不一致”作为错因类型。',
        'correctApproach 不能只复述正确答案，必须写出关键步骤。',
        'tips 禁止写“认真审题”“多总结”“注意细节”这类空话。',
        '未作答题的 errorType 使用“未作答”，errorDetail 要说明本题应从哪里入手。'
      ]
    },
    {
      id: 'module_rules',
      title: '分模块批改规则',
      sections: {
        资料分析: [
          'correctApproach 必须包含关键计算式、量纲或比例关系。',
          'errorDetail 要说明用户可能在哪一步读数、列式、估算或单位转换出错。'
        ],
        数量关系: [
          'correctApproach 必须包含方程、代入、枚举或数量关系。',
          'errorDetail 要说明用户答案对应的数量关系为何不成立。'
        ],
        判断推理: [
          'correctApproach 必须说明逻辑关系、定义要件、图形规律或削弱加强链条。',
          'errorDetail 要说明用户误判的是条件、关系、范围还是选项强度。'
        ],
        言语理解: [
          'correctApproach 必须说明文段结构、关键词、转折递进或选项比较逻辑。',
          'errorDetail 要说明用户选项与文段主旨、语境或设空逻辑的偏差。'
        ],
        常识判断: [
          'correctApproach 必须说明知识点依据和排除干扰项的理由。',
          'errorDetail 要说明用户答案对应知识点哪里不准确。'
        ]
      }
    }
  ]
};

export interface PracticeGradePromptInput {
  sessionId: string;
  module?: string;
  questions: unknown[];
}

export function buildPracticeGradePrompt(input: PracticeGradePromptInput): { system: string; user: string } {
  return {
    system: renderPracticeGradingBook(input.module),
    user: JSON.stringify({
      sessionId: input.sessionId,
      module: input.module || '专项练习',
      questions: input.questions
    }, null, 2)
  };
}

function renderPracticeGradingBook(module?: string): string {
  const lines = [`# ${PRACTICE_GRADING_BOOK.title}`];
  PRACTICE_GRADING_BOOK.chapters.forEach((chapter, index) => {
    lines.push('', `## ${index + 1}. ${chapter.title}`);
    if ('rules' in chapter) {
      chapter.rules.forEach((rule, ruleIndex) => lines.push(`${ruleIndex + 1}. ${rule}`));
    } else if ('enum' in chapter) {
      lines.push(chapter.enum.join('、'));
    } else if ('schema' in chapter) {
      lines.push(JSON.stringify(chapter.schema, null, 2));
    } else if ('sections' in chapter) {
      const entries: Array<[string, string[]]> = module && chapter.sections[module]
        ? [[module, chapter.sections[module]]]
        : Object.entries(chapter.sections);
      entries.forEach(([title, rules]) => {
        lines.push(`### ${title}`);
        rules.forEach((rule, ruleIndex) => lines.push(`${ruleIndex + 1}. ${rule}`));
      });
    }
  });
  return lines.join('\n');
}
