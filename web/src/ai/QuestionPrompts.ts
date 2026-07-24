export interface PracticePromptInput {
  module: string;
  questionCount: number;
  focusPoints: string[];
  questionType?: string;
  difficulty?: string;
  sourceStyle?: string;
  practicePurpose?: string;
  timeLimitMinutes?: number;
}

export interface MockPromptInput {
  questionCount: number;
  modules: string;
  focusTags: string;
}

export interface EssayPromptInput {
  essayTopic: string;
  essayType: 'short' | 'long';
  essayQuestionCount: number;
}

const CORE_RULES = `# 公考命题总纲

## 1. 角色定位
你是有 10 年公务员考试教研经验的命题老师。输出给学习系统直接入库，必须稳定、规范、可解析。

## 2. 两阶段原则
- 第一阶段：在内部完成选点、构题、计算、排错、校验。
- 第二阶段：只输出最终 JSON。
- 禁止输出思考过程、草稿、解释性前言、Markdown 包裹说明。

## 3. 质量底线
- 题干必须贴近公务员考试，不出脑筋急转弯。
- 选项必须互斥，不能有明显送分项，不能多答案。
- 解析必须能让学生复盘，包含关键步骤和避坑点。
- 如涉及数字、比例、排序、逻辑关系，必须先自检答案唯一且计算一致。
- 资料分析、数量关系题必须包含足够数字条件，四个选项都应是可比较的数值/比例/结论，解析必须写出关键计算式或推导链。`;

const OBJECTIVE_SCHEMA = `# 输出格式 A1：行测讲义 + 客观题 JSON

只输出 JSON 对象，字段固定如下：
{
  "lecture": {
    "knowledgePoint": "本讲义对应的唯一细分知识点，必须具体到二级或三级考点",
    "title": "本组题对应讲义标题",
    "summary": "不少于120字。讲清本组训练的考点边界、考试价值、常见问法和学生做题前必须建立的判断框架。",
    "methods": ["不少于35字的核心方法1", "不少于35字的核心方法2", "不少于35字的核心方法3", "不少于35字的核心方法4"],
    "traps": ["不少于30字的常见陷阱1", "不少于30字的常见陷阱2", "不少于30字的常见陷阱3"],
    "steps": ["不少于30字的做题步骤1", "不少于30字的做题步骤2", "不少于30字的做题步骤3", "不少于30字的做题步骤4"],
    "reviewFocus": ["不少于25字的复盘任务1", "不少于25字的复盘任务2", "不少于25字的复盘任务3"]
  },
  "questions": [
    {
      "module": "资料分析/判断推理/言语理解/数量关系/常识判断",
      "knowledgePoint": "具体考点",
      "type": "single",
      "contentKind": "single 或 shared_material。普通单题固定 single；一个共用题干对应多个小题时固定 shared_material",
      "material": "可选。只有一个材料对应2道及以上小题时填写；只放完整正文材料，不得包含小题提问、A/B/C/D选项、答案或解析",
      "subQuestions": [
        {
          "stem": "共用材料下的第1个小题问法；只放本小题问题，不得重复材料正文",
          "options": ["A选项文本", "B选项文本", "C选项文本", "D选项文本"],
          "answer": 0,
          "explanation": {
            "answer": "A",
            "steps": ["解题步骤"],
            "knowledgePoint": "本小题考点",
            "trap": "本小题避坑"
          }
        }
      ],
      "stem": "普通单题题干。只有非共用材料单题才把完整条件写在这里；如果题干有多段落，必须用同一个字符串保存，用换行分段，不得拆成多道题。",
      "options": ["A选项文本", "B选项文本", "C选项文本", "D选项文本"],
      "answer": 0,
      "explanation": {
        "answer": "A",
        "steps": ["不少于25字的步骤1，说明如何从题干定位关键信息", "不少于25字的步骤2，说明推理、计算或比较过程", "不少于25字的步骤3，说明为什么得到该答案"],
        "knowledgePoint": "本题具体考点及识别信号，不少于20字",
        "trap": "本题最容易误选的原因、干扰项套路或计算坑，不少于25字"
      }
    }
  ]
}

字段规则：
- lecture 必须围绕一个明确的细分知识点，像真正课件，不写泛泛鸡汤。
- lecture.knowledgePoint 必须填写唯一细分知识点，不能写“资料分析”“判断推理”“专项练习”这类模块名。
- lecture.summary 必须讲清“考什么、怎么识别、怎么做、错在哪里”，不得少于120字。
- methods/traps/steps/reviewFocus 每条都要能直接指导考公刷题，不能写“认真审题”“多总结”这类空话。
- 如果是资料分析/数量关系，讲义必须包含公式意识、量纲、估算或代入检查。
- 资料分析题必须提供可渲染的数据载体，使用标准 GFM Markdown 表格或单个内联 SVG 图表；禁止只有纯文字数字描述。表格必须有表头和分隔行，图表必须包含标题、单位、图例、刻度或数据标签，并保证图表数字与题目、答案、解析完全一致。
- 一份资料分析材料对应多道小题时，完整表格或图表只能放在 material 中一次，subQuestions 只放各小题问法和选项，不得复制或拆散图表。
- 如果是判断推理/言语理解，讲义必须包含题型识别信号、选项比较方法和常见干扰方式。
- 结构边界必须清晰：材料区、题目区、选项区、解析区分别写入不同字段，禁止把 A/B/C/D 选项、答案、解析混进 material 或 stem。
- contentKind 是结构判别字段：普通单题必须为 single；一个共用题干对应 2 道及以上小题时必须为 shared_material。不得按段落数量决定题型。
- 段落不是题数：同一道题的多段题干、长材料、表格说明、背景描述必须保留在同一个 stem 字符串内，用 \n\n 分段；严禁把一个题干的第1段、第2段、第3段拆成多个 questions 页面。
- 一个题干/材料对应多道选择题时，必须使用 material + subQuestions。material 只放完整正文材料；每个 subQuestions[i].stem 只放该小题提问；subQuestions[i].options 只放该小题四个选项。
- 题量按可作答的小题数计算：一个 material 下有 3 个 subQuestions，就计为 3 题，但它们属于同一个共用题干题组，不能输出成 3 个独立 questions。
- 普通单题才使用 questions[i].stem/options/answer/explanation；普通单题不要输出 material/subQuestions。
- 如果是图形推理、空间重构、位置规律、样式规律、属性规律、数量规律等图推题，stem 或 options 必须包含可直接渲染的内联 <svg> 图形；禁止只用“图形如图所示”“见下图”或纯文字描述代替图形。
- 图推题干图组必须是单个 SVG 画布，不能拆成多个 SVG。1-6 编号图必须按题目要求的阅读顺序固定在同一 viewBox 坐标中，例如从左到右 1,2,3,4,5,6 或 2x3 网格，不允许依赖换行、空格或多个图片排版来表达位置。
- options 必须正好 4 项。
- 普通单题必须使用 stem/options/answer/explanation，不要输出 subQuestions。
- 只有同一段材料下有 2 道及以上小题时，才使用 material + subQuestions；material 放共用材料正文，subQuestions 每项只放本小题问法、选项、答案和解析。严禁把小题问法写进 material，严禁把共用材料重复写进 subQuestions[i].stem。
- answer 使用 0/1/2/3，不使用 A/B/C/D。
- explanation 必须像老版 answer-block 一样结构化，包含“答案、解题步骤、考点、避坑”四类内容；步骤不得少于2条，每条要有具体推理或计算，不得只写“排除法”“代入法”。
- knowledgePoint 必须具体到二级考点。`;

const DIFFICULTY_BOOK = `# 难度与题组结构 A4

## 基础
- 考察单一知识点。
- 条件直接，干扰项弱但不能送分。

## 标准
- 需要一次转换、一次推理或一步计算。
- 干扰项覆盖常见误区。

## 进阶
- 多条件综合，或需要识别陷阱。
- 解析必须说明为什么其他选项不成立。

## 题组分布
- 未指定难度：基础 30%，标准 50%，进阶 20%。
- 错题重练：同知识点变式，不能复刻原题数字、语境和选项顺序。
- 模考：按模块覆盖，题感接近套卷，避免连续同一题型。`;

const ESSAY_SCHEMA = `# 输出格式 A5：申论题 JSON

只输出 JSON 对象：
{
  "title": "题目标题",
  "material": "给定资料。按资料1、资料2分段，材料要有事实、矛盾、主体和场景。",
  "requirement": "作答任务。小题可包含多个小问；大作文要写清主题、角度、字数和要求。",
  "lecture": {
    "knowledgePoint": "唯一申论细分知识点，如归纳概括-问题概括/综合分析-词句理解/提出对策-问题反推/贯彻执行-倡议书/申发论述-分论点展开",
    "title": "知识点讲义标题",
    "summary": "不少于160字。像教材课件一样讲清这个知识点考什么、怎么识别、为什么易错、如何训练。",
    "clues": ["不少于30字的审题识别信号1", "不少于30字的审题识别信号2", "不少于30字的审题识别信号3"],
    "methods": ["不少于35字的核心方法1", "不少于35字的核心方法2", "不少于35字的核心方法3", "不少于35字的核心方法4"],
    "structure": ["不少于30字的作答结构1", "不少于30字的作答结构2", "不少于30字的作答结构3"],
    "warnings": ["不少于30字的易错提醒1", "不少于30字的易错提醒2", "不少于30字的易错提醒3"],
    "cases": ["不少于30字的规范表达示例1", "不少于30字的规范表达示例2"],
    "drills": ["不少于25字的训练任务1", "不少于25字的训练任务2"]
  }
}

申论质量规则：
- material 不得只有一句话，必须有真实考试风格的材料层次。
- requirement 必须明确题型、作答对象、字数和限定。
- lecture 是知识点学习讲义，不是题目解析；禁止出现“本题、这道题、上述材料、本材料”等只针对单题的表述。
- 题目必须围绕 lecture.knowledgePoint 命制：材料、作答要求和讲义知识点要能形成“先学讲义，再做题训练”的关系。`;

function compactLines(lines: Array<string | undefined | false>): string {
  return lines.filter(Boolean).join('\n');
}

export function buildPracticeQuestionPrompt(input: PracticePromptInput): { system: string; user: string } {
  const focus = input.focusPoints.length ? input.focusPoints.join('、') : '按模块核心高频考点分布';
  return {
    system: [CORE_RULES, OBJECTIVE_SCHEMA, DIFFICULTY_BOOK].join('\n\n'),
    user: compactLines([
      '# 本次命题任务：专项练习',
      `- 模块：${input.module}`,
      `- 题量：${input.questionCount}`,
      `- 考点：${focus}`,
      input.questionType ? `- 题型：${input.questionType}` : '- 题型：单选客观题',
      input.difficulty ? `- 难度：${input.difficulty}` : '- 难度：按 A4 默认分布',
      input.sourceStyle ? `- 题源风格：${input.sourceStyle}` : undefined,
      input.practicePurpose ? `- 训练目标：${input.practicePurpose}` : undefined,
      input.timeLimitMinutes ? `- 建议限时：${input.timeLimitMinutes} 分钟` : undefined,
      '',
      '## 命题要求',
      '1. 每道题必须围绕本次模块和考点。',
      '2. 如果指定了考点，每题 knowledgePoint 必须填写对应具体考点。',
      '3. lecture 必须绑定一个唯一细分知识点；如果本次指定多个考点，优先围绕第一个考点生成讲义和题目，不要写模块泛讲义。',
      '4. 题组必须围绕 lecture.knowledgePoint 展开：多数题必须直接考该知识点，少量扩展题也必须是该知识点的相邻题型，并在 knowledgePoint 中写清关联方向。',
      '5. 图形推理题必须输出真实 SVG 图形：题干图组必须是一个完整 SVG 画布，内部用坐标固定 1-6 图的位置和编号，不能拆成多个 SVG 或依赖换行排版；选项 A/B/C/D 各自用一个 SVG。SVG 只用基础 shape/path/text，不使用 script、style、外链图片。题干 1x6 建议 viewBox="0 0 360 96"，2x3 建议 viewBox="0 0 300 180"，选项 SVG 建议 viewBox="0 0 96 72"，不要写超过 360 的 width/height。所有图形必须在 viewBox 内按真实比例绘制，不能通过不同比例的 width/height 拉伸圆形、正方形、旋转图形或对称图形。',
      '6. 同一道题的多段题干必须合并在同一个 stem 字符串里，不得按段落拆成多个 questions。',
      '7. 如果一个完整题干对应多道小题，必须输出一条 contentKind=shared_material 的 questions 项，完整题干放 material，小题放 subQuestions；小题数计入本次总题量。',
      '8. 不要生成与题干无关的常识闲聊。',
      '9. 每题 explanation 必须按“答案、解题步骤、考点、避坑”输出结构化对象，解析要能直接指导复盘。',
      '10. 严格只输出 JSON 对象，包含 lecture 和 questions。'
    ])
  };
}

export function buildMockQuestionPrompt(input: MockPromptInput): { system: string; user: string } {
  return {
    system: [CORE_RULES, OBJECTIVE_SCHEMA, DIFFICULTY_BOOK].join('\n\n'),
    user: [
      '# 本次命题任务：行测模考套卷',
      `- 总题量：${input.questionCount}`,
      `- 覆盖模块：${input.modules}`,
      `- 侧重点：${input.focusTags}`,
      '',
      '## 套卷要求',
      '1. 按模块合理分布，不要连续堆同一小题型。',
      '2. 难度保持基础、标准、进阶混合，整体接近真实模考。',
      '3. 解析必须按“答案、解题步骤、考点、避坑”输出结构化对象，不能只写一句话。',
      '4. 严格只输出 JSON 对象，包含 lecture 和 questions。'
    ].join('\n')
  };
}

export function buildEssayQuestionPrompt(input: EssayPromptInput): { system: string; user: string } {
  return {
    system: [CORE_RULES, ESSAY_SCHEMA].join('\n\n'),
    user: [
      '# 本次命题任务：申论练习',
      `- 主题方向：${input.essayTopic}`,
      `- 题型：${input.essayType === 'long' ? '申发论述大作文' : '申论小题'}`,
      `- 小问数量：${input.essayType === 'long' ? 1 : input.essayQuestionCount}`,
      '',
      '## 申论命题要求',
      input.essayType === 'long'
        ? '1. 大作文 1 题，材料要能支撑中心论点、分论点和现实对策。'
        : '1. 小题可包含归纳概括、综合分析、提出对策、贯彻执行中的一种或组合。',
      '2. 给定资料要有多个主体、问题、做法和争议，避免空泛材料。',
      '3. 讲义要像考前讲解，提示审题、材料抓手、结构和易错点。',
      '4. 严格只输出 JSON 对象。'
    ].join('\n')
  };
}
