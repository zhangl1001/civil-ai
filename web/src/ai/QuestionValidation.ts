import type { PracticeQuestion } from '@/services/QuestionRepository';
import type { PracticeLectureInput } from '@/services/QuestionRepository';
import type { EssayQuestionRecord } from '@/services/EssayRepository';
import { QUESTION_CONTENT_KINDS, QUESTION_RENDER_TEMPLATES } from '@/domain/question';
import { hasSharedMaterialStructure } from '@/domain/questionPresentation';

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').replace(/^[A-D][.、．\s]*/i, '').trim();
}

function uniqueCount(values: string[]): number {
  return new Set(values.map(normalizeText).filter(Boolean)).size;
}

function answerLabel(answer: number): string {
  return String.fromCharCode(65 + answer);
}

function numberTokenCount(text: string): number {
  return (text.match(/\d+(?:\.\d+)?%?/g) || []).length;
}

function isCalculationModule(module: string): boolean {
  return module.includes('资料分析') || module.includes('数量关系');
}

function hasDataCarrier(text: string): boolean {
  return /<svg[\s>]|<img[\s>]|!\[[^\]]*]\([^)]+\)|(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|\s*:?-{3,}/im.test(text);
}

function compactText(value = ''): string {
  return value.replace(/\s+/g, '').trim();
}

function isGraphicReasoningQuestion(question: PracticeQuestion): boolean {
  const text = `${question.module} ${question.knowledgePoint || ''} ${question.stem}`;
  return question.module.includes('判断推理') && /图形推理|图推|空间重构|位置规律|样式规律|属性规律|数量规律|图形/.test(text);
}

function hasRenderableGraphic(question: PracticeQuestion): boolean {
  const text = `${question.stem}\n${question.options.join('\n')}`;
  return /<svg[\s>]/i.test(text) || /!\[[^\]]*]\([^)]+\)/.test(text) || /<img[\s>]/i.test(text);
}

function svgCount(text: string): number {
  return (text.match(/<svg[\s>]/gi) || []).length;
}

function hasOptionMarkers(text = ''): boolean {
  return /(?:^|\n)\s*[A-D][\.．、:：]/i.test(text);
}

function hasSubQuestionMarkers(text = ''): boolean {
  return /(?:^|\n)\s*(?:第\s*[一二三四五六七八九十\d]+\s*(?:小题|题)|问题\s*[一二三四五六七八九十\d]+|小题\s*[一二三四五六七八九十\d]+)\s*[：:]/.test(text);
}

function isStructuredSharedMaterialQuestion(question: PracticeQuestion): boolean {
  return hasSharedMaterialStructure(question);
}

function hasQuestionIntent(text = ''): boolean {
  return /(?:下列|以下|哪项|哪一项|哪一个|最|应当|应该|能够|不能|不正确|正确|错误|推出|支持|削弱|加强|说明|概括|排序|填入|问|？|\?)/.test(text);
}

function looksLikeOnlyMaterialFragment(text = ''): boolean {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 24) return false;
  if (hasQuestionIntent(compact)) return false;
  return /(?:资料|材料|段落|背景|表\d|图\d|第一段|第二段|第三段|一是|二是|三是|首先|其次|再次|此外|同时|近年来|据统计|调查显示)/.test(compact);
}

function isKnowledgeRelated(questionPoint: string | undefined, lecturePoint: string | undefined): boolean {
  const question = compactText(questionPoint);
  const lecture = compactText(lecturePoint);
  if (!question || !lecture) return false;
  if (question.includes(lecture) || lecture.includes(question)) return true;
  const commonTokens = ['削弱', '加强', '论证', '前提', '结论', '因果', '图形', '位置', '样式', '属性', '数量', '空间', '主旨', '意图', '细节', '资料', '增长率', '比重', '平均数'];
  return commonTokens.some((token) => question.includes(token) && lecture.includes(token));
}

export function validatePracticeQuestions(questions: PracticeQuestion[], expectedCount?: number, lecture?: PracticeLectureInput): ValidationResult {
  const issues: string[] = [];
  if (!questions.length) issues.push('没有解析出可用题目');
  if (expectedCount && questions.length < Math.ceil(expectedCount * 0.7)) {
    issues.push(`题量不足：期望 ${expectedCount}，实际 ${questions.length}`);
  }

  questions.forEach((question, index) => {
    const label = `第 ${index + 1} 题`;
    if (!question.module?.trim()) issues.push(`${label} 缺少模块`);
    if (!question.knowledgePoint?.trim()) issues.push(`${label} 缺少具体考点`);
    if (`${question.material || ''}${question.stem}`.trim().length < 16) issues.push(`${label} 题干过短`);
    if (!isStructuredSharedMaterialQuestion(question) && looksLikeOnlyMaterialFragment(question.stem)) {
      issues.push(`${label} 像是被拆出来的材料段落，缺少完整问法；同一道题多段题干必须合并在一个 stem 字符串中`);
    }
    if (question.material && !isStructuredSharedMaterialQuestion(question)) {
      issues.push(`${label} 使用了 material 但缺少 groupId/subQuestionCount，材料型多问必须由 material + subQuestions 结构展开`);
    }
    if (isStructuredSharedMaterialQuestion(question) && question.contentKind !== QUESTION_CONTENT_KINDS.SHARED_MATERIAL) {
      issues.push(`${label} 题目内容类型与结构不一致，共用题干多小题必须使用 shared_material`);
    }
    if (!isStructuredSharedMaterialQuestion(question) && question.contentKind === QUESTION_CONTENT_KINDS.SHARED_MATERIAL) {
      issues.push(`${label} 题目内容类型与结构不一致，shared_material 必须包含完整 material 和至少两个 subQuestions`);
    }
    const expectedSharedTemplate = question.module.includes('资料分析')
      ? QUESTION_RENDER_TEMPLATES.DATA_ANALYSIS
      : QUESTION_RENDER_TEMPLATES.SHARED_MATERIAL;
    if (isStructuredSharedMaterialQuestion(question) && question.renderTemplate !== expectedSharedTemplate) {
      issues.push(`${label} 题目展示模板与结构不一致，当前模块必须使用 ${expectedSharedTemplate} 模板`);
    }
    if (question.material && (hasOptionMarkers(question.material) || hasSubQuestionMarkers(question.material))) {
      issues.push(`${label} 共用材料字段混入了小题提问或选项，material 只能放正文材料`);
    }
    if (isStructuredSharedMaterialQuestion(question) && question.stem.length > 180) {
      issues.push(`${label} 共用材料小题 stem 过长，疑似重复写入材料正文；小题 stem 只能放本小题问法`);
    }
    if (isStructuredSharedMaterialQuestion(question) && hasOptionMarkers(question.stem)) {
      issues.push(`${label} 共用材料小题 stem 混入选项，选项必须放入 options 数组`);
    }
    if (question.options.length !== 4) issues.push(`${label} 选项不是 4 个`);
    if (uniqueCount(question.options) !== question.options.length) issues.push(`${label} 存在重复或近似重复选项`);
    if (question.answer < 0 || question.answer >= question.options.length) issues.push(`${label} 答案下标非法`);
    if (question.explanation.trim().length < 18) issues.push(`${label} 解析过短`);
    if (isGraphicReasoningQuestion(question) && !hasRenderableGraphic(question)) {
      issues.push(`${label} 图形推理题缺少可渲染图形，stem 或 options 必须包含 SVG/图片`);
    }
    if (isGraphicReasoningQuestion(question) && svgCount(question.stem) > 1) {
      issues.push(`${label} 图形推理题干不能拆成多个 SVG，必须用单个 SVG 画布固定图形位置`);
    }
    if (isCalculationModule(question.module || '')) {
      const stemAndOptions = `${question.material || ''}\n${question.stem}\n${question.options.join('\n')}`;
      if (question.module.includes('资料分析') && !hasDataCarrier(`${question.material || ''}\n${question.stem}`)) {
        issues.push(`${label} 资料分析题缺少可渲染的数据表格或图表`);
      }
      if (numberTokenCount(stemAndOptions) < 4) issues.push(`${label} 计算型题缺少足够数字条件`);
      if (question.options.some((option) => numberTokenCount(option) === 0)) issues.push(`${label} 计算型题选项缺少数字或百分比`);
      if (numberTokenCount(question.explanation) < 2 || !/[+\-×x*÷/=≈%]/.test(question.explanation)) {
        issues.push(`${label} 计算型题解析缺少计算过程`);
      }
    }
    const explanation = question.explanation.toUpperCase();
    const labelText = answerLabel(question.answer);
    const answerText = normalizeText(question.options[question.answer] || '');
    if (!explanation.includes(labelText) && answerText && !normalizeText(question.explanation).includes(answerText.slice(0, 8))) {
      issues.push(`${label} 解析未明显对应答案 ${labelText}`);
    }
  });

  const lecturePoint = lecture?.knowledgePoint;
  if (lecturePoint && questions.length) {
    const relatedCount = questions.filter((question) => isKnowledgeRelated(question.knowledgePoint, lecturePoint)).length;
    const minRelated = Math.max(1, Math.ceil(questions.length * 0.7));
    if (relatedCount < minRelated) {
      issues.push(`题组知识点与讲义不一致：讲义为“${lecturePoint}”，至少 ${minRelated}/${questions.length} 题应直接围绕或相邻扩展，当前 ${relatedCount} 题`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function validatePracticeLecture(lecture?: PracticeLectureInput): ValidationResult {
  const issues: string[] = [];
  if (!lecture) return { valid: false, issues: ['缺少讲义'] };
  if (!lecture.knowledgePoint || !lecture.knowledgePoint.trim()) issues.push('讲义缺少细分知识点');
  if (/^(资料分析|判断推理|言语理解|数量关系|常识判断|专项练习)$/.test(lecture.knowledgePoint || '')) {
    issues.push('讲义知识点不能只是模块名，必须具体到二级或三级考点');
  }
  if (!lecture.title || lecture.title.trim().length < 8) issues.push('讲义标题过短');
  if (!lecture.summary || lecture.summary.trim().length < 120) issues.push('讲义摘要过短，必须像课件导学而不是一句提示');
  const checks: Array<[keyof PracticeLectureInput, string, number, number]> = [
    ['methods', '核心方法', 4, 35],
    ['traps', '常见陷阱', 3, 30],
    ['steps', '做题步骤', 4, 30],
    ['reviewFocus', '复盘任务', 3, 25]
  ];
  checks.forEach(([key, label, minCount, minLength]) => {
    const values = Array.isArray(lecture[key]) ? lecture[key] as string[] : [];
    if (values.length < minCount) issues.push(`${label}数量不足：至少 ${minCount} 条`);
    values.forEach((value, index) => {
      if (String(value).trim().length < minLength) issues.push(`${label}${index + 1}过短`);
      if (/认真审题|多做题|多总结|提高速度|注意细节|夯实基础/.test(String(value))) {
        issues.push(`${label}${index + 1}过于空泛`);
      }
    });
  });
  return { valid: issues.length === 0, issues };
}

export function validateEssayQuestion(question: EssayQuestionRecord): ValidationResult {
  const issues: string[] = [];
  if (question.title.trim().length < 6) issues.push('申论标题过短');
  if (question.material.trim().length < 180) issues.push('申论材料过短，缺少真实材料层次');
  if (question.requirement.trim().length < 40) issues.push('申论作答要求过短');
  if (!/字|不超过|左右|不少于/.test(question.requirement)) issues.push('申论作答要求缺少字数约束');
  if (!question.lecture) {
    issues.push('申论缺少讲义');
  } else {
    if (!question.lecture.knowledgePoint?.trim()) issues.push('申论讲义缺少细分知识点');
    if (question.lecture.summary.trim().length < 160) issues.push('申论讲义摘要过短，必须像知识点课件');
    if (/本题|这道题|上述材料|本材料|该材料/.test([
      question.lecture.title,
      question.lecture.summary,
      ...question.lecture.clues,
      ...question.lecture.structure,
      ...question.lecture.warnings,
      ...(question.lecture.methods || []),
      ...(question.lecture.cases || []),
      ...(question.lecture.drills || [])
    ].join('\n'))) {
      issues.push('申论讲义不能写成单题解析，禁止出现“本题/这道题/上述材料”等表述');
    }
    if (question.lecture.clues.length < 3) issues.push('申论讲义审题抓手不足，至少3条');
    if ((question.lecture.methods || []).length < 4) issues.push('申论讲义核心方法不足，至少4条');
    if (question.lecture.structure.length < 3) issues.push('申论讲义作答结构不足，至少3条');
    if (question.lecture.warnings.length < 3) issues.push('申论讲义易错提醒不足，至少3条');
    if ((question.lecture.cases || []).length < 2) issues.push('申论讲义规范表达示例不足，至少2条');
    if ((question.lecture.drills || []).length < 2) issues.push('申论讲义训练任务不足，至少2条');
  }
  return { valid: issues.length === 0, issues };
}

export function buildObjectiveRepairPrompt(rawText: string, issues: string[], expectedCount: number): string {
  return [
    '# JSON 修复任务：行测题目',
    `目标题量：${expectedCount}`,
    '',
    '## 发现的问题',
    ...issues.slice(0, 18).map((issue) => `- ${issue}`),
    '',
    '## 修复要求',
    '1. 只输出修复后的 JSON 对象，必须包含 lecture 和 questions。',
    '2. 每题必须包含 module, knowledgePoint, type, stem, options, answer, explanation。',
    '3. options 必须正好 4 个，answer 必须是 0/1/2/3。',
    '4. 删除坏题或补足题目，保证题干、选项、答案、解析一致。',
    '5. 资料分析、数量关系题必须包含足够数字条件，选项必须数字化，解析必须写出关键计算过程。',
    '6. 图形推理题必须补齐可渲染 SVG 图形，不允许只写“如图”。',
    '7. 如果原始输出包含 lecture，必须保留并修复成 lecture + questions 对象；lecture 必须具体、充分、像课件，questions 多数题必须围绕 lecture.knowledgePoint。',
    '',
    '## 原始输出',
    rawText
  ].join('\n');
}

export function buildLectureRepairPrompt(rawText: string, issues: string[]): string {
  return [
    '# JSON 修复任务：刷题讲义',
    '',
    '## 发现的问题',
    ...issues.slice(0, 16).map((issue) => `- ${issue}`),
    '',
    '## 修复要求',
    '1. 只输出 JSON 对象，必须包含 lecture 和 questions。',
    '2. lecture.knowledgePoint 必须是唯一细分知识点，不能只是模块名。',
    '3. lecture.summary 不少于120字，要讲清考点边界、识别信号、做题路径和易错点。',
    '4. lecture.methods 至少4条，每条不少于35字，必须是可执行方法。',
    '5. lecture.traps 至少3条，每条不少于30字，必须对应真实做题误区。',
    '6. lecture.steps 至少4条，每条不少于30字，按做题顺序展开。',
    '7. lecture.reviewFocus 至少3条，每条不少于25字，必须能指导复盘。',
    '8. questions 必须围绕 lecture.knowledgePoint，多数题直接考该知识点，少量扩展题必须是相邻题型。',
    '9. 禁止“认真审题、多总结、注意细节、夯实基础”等空话。',
    '',
    '## 原始输出',
    rawText
  ].join('\n');
}

export function buildEssayRepairPrompt(rawText: string, issues: string[]): string {
  return [
    '# JSON 修复任务：申论题',
    '',
    '## 发现的问题',
    ...issues.slice(0, 12).map((issue) => `- ${issue}`),
    '',
    '## 修复要求',
    '1. 只输出修复后的 JSON 对象。',
    '2. 必须包含 title, material, requirement, lecture。',
    '3. material 要有多段给定资料，requirement 要有明确字数约束。',
    '4. lecture 必须是知识点讲义，不是单题解析；必须包含 knowledgePoint, title, summary, clues, methods, structure, warnings, cases, drills。',
    '5. lecture.summary 不少于160字，禁止出现“本题/这道题/上述材料/本材料”。',
    '6. 题目必须围绕 lecture.knowledgePoint 命制，形成讲义和题目关联。',
    '',
    '## 原始输出',
    rawText
  ].join('\n');
}
