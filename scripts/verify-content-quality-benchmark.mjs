import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { Marked, marked } from '../web/node_modules/marked/lib/marked.esm.js';
import markedKatex from '../web/node_modules/marked-katex-extension/src/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const webRoot = path.join(projectRoot, 'web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [content, rendering] = await Promise.all([
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/capabilities/content-rendering/public.ts')
  ]);
  const parser = new content.GeneratedContentParser();
  const quality = new content.StructuredObjectiveContentQualityValidator();
  const benchmarkCases = createBenchmarkCases();

  for (const benchmark of benchmarkCases) {
    const parsed = parser.parseObject(benchmark.payload, benchmark.capabilityCode);
    assert.equal(parsed.questions.length, benchmark.expectedCount, `${benchmark.name}: parsed count`);
    const report = quality.validate(parsed, benchmark.expectedCount, benchmark.capabilityCode);
    assert.equal(report.valid, true, `${benchmark.name}: ${JSON.stringify(report.blockingIssues)}`);
    parsed.questions.forEach((question) => {
      assert.equal(question.capabilityCode, benchmark.capabilityCode, `${benchmark.name}: capability binding`);
      assert.deepEqual(question.options.map((option) => option.id), ['A', 'B', 'C', 'D'], `${benchmark.name}: option contract`);
      assert(question.options.some((option) => option.id === question.correctOptionId), `${benchmark.name}: answer reference`);
    });
    if (benchmark.expectedMaterialGroupId) {
      assert(parsed.questions.every((question) => question.materialGroupId === benchmark.expectedMaterialGroupId));
      assert(parsed.questions.every((question) => JSON.stringify(question.material) === JSON.stringify(parsed.questions[0].material)));
    }
  }

  const missingContextOutput = parser.parseObject(payload([
    question(
      'missing-context',
      '下列哪项如果为真，最能削弱上述论证？',
      '削弱论证'
    )
  ]), 'aptitude.judgment.weakening');
  const missingContextReport = quality.validate(
    missingContextOutput,
    1,
    'aptitude.judgment.weakening'
  );
  assert.equal(missingContextReport.valid, false, 'A referential prompt without material must be rejected');
  assert(
    missingContextReport.blockingIssues.some((issue) => issue.code === 'quality.question_context_missing'),
    'Missing material must be reported as a blocking core-content defect'
  );

  const validator = new content.ContentSchemaValidator();
  const allBlockTypes = {
    schemaVersion: 'content.v1',
    blocks: [
      { id: 'text', type: 'text', source: '## 结构化正文\n\n用于验证 Markdown 内容槽位。' },
      {
        id: 'table',
        type: 'data_table',
        caption: '季度指标',
        columns: [
          { key: 'quarter', label: '季度', alignment: 'left', valueType: 'text' },
          { key: 'rate', label: '增长率', alignment: 'right', valueType: 'percent' }
        ],
        rows: [{ quarter: '第一季度', rate: 12.5 }]
      },
      {
        id: 'svg',
        type: 'svg_diagram',
        markup: '<svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid meet"><circle cx="30" cy="30" r="18"/><rect x="70" y="12" width="36" height="36"/></svg>',
        alt: '圆形与正方形规律图'
      },
      { id: 'image', type: 'image', assetRef: '/assets/benchmark.png', alt: '本地图片占位' },
      { id: 'formula', type: 'formula', source: '(现期量-基期量)/基期量', display: 'block' },
      {
        id: 'callout',
        type: 'callout',
        kind: 'method',
        title: '方法',
        blocks: [{ id: 'callout-text', type: 'text', source: '先定位，再计算。' }]
      }
    ]
  };
  assert.equal(validator.parseDocument(allBlockTypes).ok, true);

  const rendererSource = await fs.readFile(
    path.join(webRoot, 'src/components/content/ContentDocumentRenderer.vue'),
    'utf8'
  );
  for (const type of ['text', 'data_table', 'svg_diagram', 'image', 'formula']) {
    assert(rendererSource.includes(`block.type === '${type}'`), `Renderer must handle ${type}`);
  }
  assert(rendererSource.includes('content-callout'), 'Renderer must handle callout blocks');
  assert(rendererSource.includes('width:100%; height:auto'), 'SVG renderer must preserve proportional scaling');

  const generated = parser.parseObject(createDifficultyPayload(), 'aptitude.judgment.argument_structure');
  let sequence = 0;
  const commit = await new content.GeneratedContentCommitBuilder(
    { now: () => 1_784_016_000_000 },
    { next: (prefix) => `${prefix}:benchmark:${++sequence}` }
  ).build(
    generationSpec(),
    generationWorkflow(),
    'ContentSchemaVersionId:benchmark',
    generated
  );
  assert.deepEqual(
    commit.bundle.questions.map((question) => question.difficulty),
    [0.2, 0.35, 0.5, 0.65, 0.8],
    'Generated set must preserve a stable difficulty distribution across the requested range'
  );

  const fencedDigest = rendering.normalizeMarkdownSource([
    '```markdown',
    '## 宏观调控',
    '',
    '### 概念边界',
    '',
    '- **逆周期调节**：用于平抑短期波动。',
    '',
    '| 类型 | 目标 |',
    '| --- | --- |',
    '| 逆周期 | 稳定短期运行 |',
    '```'
  ].join('\n'));
  const fencedHtml = marked.parse(fencedDigest, { gfm: true });
  assert.match(fencedHtml, /<h2>宏观调控<\/h2>/);
  assert.match(fencedHtml, /<h3>概念边界<\/h3>/);
  assert.match(fencedHtml, /<strong>逆周期调节<\/strong>/);
  assert.match(fencedHtml, /<table>/);

  const serializedDigest = JSON.stringify({
    markdown: '## 判断方法\\n\\n\\### 三步识别\\n\\n\\- \\*\\*先看时间跨度\\*\\*'
  });
  const normalizedSerializedDigest = rendering.normalizeMarkdownSource(serializedDigest);
  const serializedHtml = marked.parse(normalizedSerializedDigest, { gfm: true });
  assert.match(serializedHtml, /<h2>判断方法<\/h2>/);
  assert.match(serializedHtml, /<h3>三步识别<\/h3>/);
  assert.match(serializedHtml, /<strong>先看时间跨度<\/strong>/);

  const normalizedFormula = rendering.normalizeMarkdownSource([
    '独立公式：',
    '',
    '$$\\text{比重变化量}=\\frac{A}{B}\\times\\frac{a%-b%}{1+a%}$$',
    '',
    '当 $a%>b%$ 时，比重上升。'
  ].join('\n'));
  assert(normalizedFormula.includes('a\\%'), 'Legacy unescaped percentages must be normalized inside formulas');
  const mathMarked = new Marked({ gfm: true });
  mathMarked.use(markedKatex({ nonStandard: true, throwOnError: false, strict: 'ignore', trust: false }));
  const formulaHtml = mathMarked.parse(normalizedFormula);
  assert.match(formulaHtml, /class="katex-display"/);
  assert.match(formulaHtml, /class="katex"/);

  console.log('Content quality benchmark verification passed.');
} finally {
  await server.close();
}

function createBenchmarkCases() {
  return [
    {
      name: 'judgment-single',
      capabilityCode: 'aptitude.judgment.argument_structure',
      expectedCount: 1,
      payload: payload([question(
        'judgment-1',
        '以下哪项最准确地概括上述论证的结构？',
        '论证结构识别',
        '某研究比较两组学生的阅读时长和能力测试结果，并据此认为增加阅读时间能够提升语言与逻辑能力。'
      )])
    },
    {
      name: 'verbal-long-material',
      capabilityCode: 'aptitude.verbal.main_idea',
      expectedCount: 1,
      payload: payload([question(
        'verbal-1',
        '根据上述多段材料，下列哪项最准确地概括作者的核心观点？',
        '主旨概括',
        '第一段交代政策背景与现实问题。\n\n第二段分析形成原因。\n\n第三段提出治理方向与适用边界。'
      )])
    },
    {
      name: 'data-shared-table',
      capabilityCode: 'aptitude.data.growth_rate',
      expectedCount: 2,
      expectedMaterialGroupId: 'data-material',
      payload: payload(
        [
          question('data-1', '根据表格，2025 年第一季度增量约为多少？', '增长量计算', null, 'data-material'),
          question('data-2', '根据表格，下列关于季度增速的判断哪项正确？', '增长率比较', null, 'data-material')
        ],
        [{
          id: 'data-material',
          markdown: '| 季度 | 2024年 | 2025年 | 增长率 |\n| --- | ---: | ---: | ---: |\n| 第一季度 | 100 | 112 | 12% |\n| 第二季度 | 120 | 132 | 10% |'
        }]
      )
    },
    {
      name: 'quantity-formula',
      capabilityCode: 'aptitude.quantity.ratio',
      expectedCount: 1,
      payload: payload([question(
        'quantity-1',
        '若总量不变且甲乙之比由 2:3 变为 3:4，下列哪项计算正确？',
        '比例关系',
        '计算时可使用公式：`部分量 = 总量 × 对应份数 / 总份数`。'
      )])
    },
    {
      name: 'visual-svg',
      capabilityCode: 'aptitude.judgment.visual_sequence',
      expectedCount: 1,
      payload: payload([{
        ...question(
          'visual-1',
          '观察图形变化规律，下列哪项最适合填入问号处？',
          '图形序列'
        ),
        visual: {
          svg: '<svg width="360" height="80" preserveAspectRatio="xMidYMid meet"><circle cx="40" cy="40" r="20"/><rect x="130" y="20" width="40" height="40"/><polygon points="260,18 282,60 238,60"/></svg>',
          alt: '图形序列',
          viewBox: '0 0 360 80'
        }
      }])
    }
  ];
}

function payload(questions, materialGroups = []) {
  return {
    lecture: {
      sections: [
        { id: 'concept', kind: 'concept', title: '概念与边界', markdown: '先明确考查对象、必要条件和容易混淆的边界。' },
        { id: 'method', kind: 'method', title: '解题方法', markdown: '定位任务后提取关键关系，再逐项验证，避免凭印象作答。' }
      ]
    },
    materialGroups,
    questions
  };
}

function question(id, prompt, knowledgePoint, material = null, materialGroupId = null) {
  return {
    id,
    referenceQuestionId: null,
    materialGroupId,
    material,
    prompt,
    options: [
      { id: 'A', text: `${knowledgePoint}的正确判断，完整满足题干条件。` },
      { id: 'B', text: '只复述局部信息，遗漏关键限定条件。' },
      { id: 'C', text: '混淆了题干中的主体、范围或因果方向。' },
      { id: 'D', text: '引入题干没有提供的新前提，无法成立。' }
    ],
    correctOptionId: 'A',
    explanation: {
      knowledgePoint,
      conclusion: 'A 项完整命中题干任务和必要限定，是唯一最优答案。',
      steps: ['先识别题干要求判断的对象。', '再核对每个选项与关键条件的对应关系。'],
      optionAnalysis: ['A', 'B', 'C', 'D'].map((optionId) => ({
        optionId,
        verdict: optionId === 'A' ? 'correct' : 'incorrect',
        analysis: optionId === 'A' ? '完整满足任务与限定条件。' : '存在范围、关系或前提错误。'
      })),
      pitfalls: ['相关不等于正确，必须核对全部限定。']
    }
  };
}

function createDifficultyPayload() {
  return payload(Array.from({ length: 5 }, (_, index) => question(
    `difficulty-${index + 1}`,
    `第 ${index + 1} 题：以下哪项最准确地识别论点与论据之间的关系？`,
    '论证结构识别'
  )));
}

function generationSpec() {
  return {
    id: 'GenerationSpecId:benchmark',
    examCycleId: 'ExamCycleId:benchmark',
    learningThreadId: 'LearningThreadId:benchmark',
    teachingBlueprintId: 'TeachingBlueprintId:benchmark',
    capabilityNodeId: 'CapabilityNodeId:benchmark',
    contentKind: 'lecture_with_questions',
    assessmentRole: 'practice',
    questionTemplateVersionId: 'QuestionTemplateVersionId:benchmark',
    contentSchemaVersionId: 'ContentSchemaVersionId:benchmark',
    promptVersionId: 'PromptVersionId:benchmark',
    requestedCount: 5,
    difficulty: { min: 0.2, max: 0.8 },
    constraints: {},
    contextSnapshot: { capability: { name: '论证结构识别', module: 'judgment' } },
    contentHash: 'sha256:benchmark',
    createdAt: 1_784_016_000_000
  };
}

function generationWorkflow() {
  return {
    id: 'WorkflowId:benchmark',
    examCycleId: 'ExamCycleId:benchmark',
    generationSpecId: 'GenerationSpecId:benchmark',
    workflowType: 'lecture_with_questions',
    status: 'committed',
    currentStep: 'complete',
    attemptCount: 1,
    validation: {},
    idempotencyKey: 'benchmark',
    startedAt: 1_784_016_000_000,
    completedAt: 1_784_016_000_000,
    updatedAt: 1_784_016_000_000,
    version: 1
  };
}
