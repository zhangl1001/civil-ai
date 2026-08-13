import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

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
  const fixturePath = path.join(webRoot, 'src/modules/content/fixtures/single-choice-weakening-v2.json');
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const validator = new content.ContentSchemaValidator();

  const valid = validator.parseChoiceQuestion(fixture);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.options.length, 4);
  assert.equal(valid.value.correctOptionId, 'B');
  assert.equal(valid.value.explanation.blocks[0].type, content.ContentBlockType.Callout);
  const nullableOptionalFields = validator.parseChoiceQuestion({
    ...fixture,
    material: null,
    explanation: {
      ...fixture.explanation,
      blocks: [{ ...fixture.explanation.blocks[0], title: null }]
    }
  });
  assert.equal(nullableOptionalFields.ok, true);
  assert.equal(nullableOptionalFields.value.material, undefined);
  assert.equal(nullableOptionalFields.value.explanation.blocks[0].title, undefined);

  const wrongAnswer = validator.parseChoiceQuestion({ ...fixture, correctOptionId: 'E' });
  assert.equal(wrongAnswer.ok, false);
  assert(wrongAnswer.error.issues.some((issue) => issue.code === 'question.answer_missing'));

  const duplicateOptions = validator.parseChoiceQuestion({
    ...fixture,
    options: fixture.options.map((option, index) => ({ ...option, id: index < 2 ? 'A' : option.id }))
  });
  assert.equal(duplicateOptions.ok, false);
  assert(duplicateOptions.error.issues.some((issue) => issue.code === 'question.option_id_duplicate'));

  // --- multi answer templates -------------------------------------------------
  const { correctOptionId: _singleAnswer, ...sharedShape } = fixture;
  const multiAnswerFixture = {
    ...sharedShape,
    templateCode: content.QuestionTemplateCode.MultipleChoice,
    correctOptionIds: ['A', 'C']
  };

  const multiAnswer = validator.parseChoiceQuestion(multiAnswerFixture);
  assert.equal(multiAnswer.ok, true);
  assert.equal(multiAnswer.value.templateCode, content.QuestionTemplateCode.MultipleChoice);
  assert.deepEqual([...multiAnswer.value.correctOptionIds], ['A', 'C']);
  assert.equal(content.isMultiAnswerChoice(multiAnswer.value), true);
  assert.equal(content.correctAnswerLabel(multiAnswer.value), 'AC');
  // Answer keys read back in option order regardless of how they were written.
  const unorderedKey = validator.parseChoiceQuestion({ ...multiAnswerFixture, correctOptionIds: ['C', 'A'] });
  assert.equal(content.correctAnswerLabel(unorderedKey.value), 'AC');

  const singleChoiceStaysSingle = validator.parseChoiceQuestion(fixture);
  assert.equal(content.isSingleChoice(singleChoiceStaysSingle.value), true);
  assert.deepEqual([...content.correctOptionIdsOf(singleChoiceStaysSingle.value)], ['B']);

  const indeterminate = validator.parseChoiceQuestion({
    ...sharedShape,
    templateCode: content.QuestionTemplateCode.IndeterminateChoice,
    correctOptionIds: ['B']
  });
  // 不定项 may have exactly one correct option; 多选 may not.
  assert.equal(indeterminate.ok, true);
  const tooFewForMultiple = validator.parseChoiceQuestion({ ...multiAnswerFixture, correctOptionIds: ['B'] });
  assert.equal(tooFewForMultiple.ok, false);
  assert(tooFewForMultiple.error.issues.some((issue) => issue.code === 'question.answer_insufficient'));

  const everyOptionCorrect = validator.parseChoiceQuestion({
    ...multiAnswerFixture,
    correctOptionIds: fixture.options.map((option) => option.id)
  });
  assert.equal(everyOptionCorrect.ok, false);
  assert(everyOptionCorrect.error.issues.some((issue) => issue.code === 'question.answer_trivial'));

  const unknownAnswerOption = validator.parseChoiceQuestion({ ...multiAnswerFixture, correctOptionIds: ['A', 'Z'] });
  assert.equal(unknownAnswerOption.ok, false);
  assert(unknownAnswerOption.error.issues.some((issue) => issue.code === 'question.answer_missing'));

  const duplicateAnswerIds = validator.parseChoiceQuestion({ ...multiAnswerFixture, correctOptionIds: ['A', 'A'] });
  assert.equal(duplicateAnswerIds.ok, false);
  assert(duplicateAnswerIds.error.issues.some((issue) => issue.code === 'question.answer_duplicate'));

  const missingAnswerArray = validator.parseChoiceQuestion({ ...sharedShape, templateCode: content.QuestionTemplateCode.MultipleChoice });
  assert.equal(missingAnswerArray.ok, false);

  const unknownTemplate = validator.parseChoiceQuestion({ ...fixture, templateCode: 'true_false' });
  assert.equal(unknownTemplate.ok, false);
  assert(unknownTemplate.error.issues.some((issue) => issue.code === 'question.template_unsupported'));

  const objectAsMarkdown = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{ id: 'bad', type: 'text', source: { text: '不能静默转字符串' } }]
  });
  assert.equal(objectAsMarkdown.ok, false);
  assert.equal(objectAsMarkdown.error.issues[0].path, '$.blocks[0].source');

  const duplicateSiblingBlocks = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [
      { id: 'duplicate', type: 'text', source: '第一段' },
      { id: 'duplicate', type: 'text', source: '第二段' }
    ]
  });
  assert.equal(duplicateSiblingBlocks.ok, false);
  assert(duplicateSiblingBlocks.error.issues.some((issue) => issue.code === 'content.block_id_duplicate'));

  const duplicateNestedBlocks = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'callout',
      type: 'callout',
      kind: 'method',
      blocks: [
        { id: 'duplicate-nested', type: 'text', source: '第一步' },
        { id: 'duplicate-nested', type: 'text', source: '第二步' }
      ]
    }]
  });
  assert.equal(duplicateNestedBlocks.ok, false);
  assert(duplicateNestedBlocks.error.issues.some((issue) => issue.code === 'content.block_id_duplicate'));

  const badTable = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'table',
      type: 'data_table',
      columns: [{ key: 'value', label: '数值', alignment: 'right', valueType: 'number' }],
      rows: [{ value: { nested: true } }]
    }]
  });
  assert.equal(badTable.ok, false);
  assert(badTable.error.issues.some((issue) => issue.code === 'content.table_cell_invalid'));

  const emptyTable = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'empty-table',
      type: 'data_table',
      columns: [{ key: 'value', label: '数值', alignment: 'right', valueType: 'number' }],
      rows: []
    }]
  });
  assert.equal(emptyTable.ok, false);
  assert(emptyTable.error.issues.some((issue) => issue.code === 'content.table_rows_invalid'));

  const validChart = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'chart',
      type: 'statistical_chart',
      chartType: 'combo',
      title: '产值与增速',
      unit: '亿元 / %',
      categories: ['2023', '2024', '2025'],
      series: [
        { id: 'output', label: '产值', renderAs: 'bar', values: [1080, 1200, 1290] },
        { id: 'growth', label: '增速', renderAs: 'line', values: [5.1, 6.2, 7.5] }
      ]
    }]
  });
  assert.equal(validChart.ok, true);

  const invalidChart = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'chart',
      type: 'statistical_chart',
      chartType: 'bar',
      categories: ['2024', '2025'],
      series: [{ id: 'output', label: '产值', values: [1200] }]
    }]
  });
  assert.equal(invalidChart.ok, false);
  assert(invalidChart.error.issues.some((issue) => issue.code === 'content.chart_values_invalid'));

  const invalidSvg = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{ id: 'diagram', type: 'svg_diagram', markup: '<path d="M0 0" />', alt: '缺少画布的图形' }]
  });
  assert.equal(invalidSvg.ok, false);
  assert(invalidSvg.error.issues.some((issue) => issue.code === 'content.svg_root_invalid'));
  assert(invalidSvg.error.issues.some((issue) => issue.code === 'content.svg_viewbox_missing'));

  const validSvg = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'diagram',
      type: 'svg_diagram',
      markup: '<svg viewBox="0 0 120 60"><circle cx="30" cy="30" r="18" /></svg>',
      alt: '等比例圆形规律图'
    }]
  });
  assert.equal(validSvg.ok, true);

  const invalidImage = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{ id: 'image', type: 'image', assetRef: 'javascript:alert(1)', alt: '无效图片' }]
  });
  assert.equal(invalidImage.ok, false);
  assert(invalidImage.error.issues.some((issue) => issue.code === 'content.image_ref_invalid'));

  assert.equal(rendering.resolveImageSource('/assets/question.png').kind, rendering.ImageSourceKind.Local);
  assert.equal(
    rendering.resolveImageSource('data:image/png;base64,iVBORw0KGgo=').kind,
    rendering.ImageSourceKind.Inline
  );
  assert.equal(
    rendering.resolveImageSource('https://tracker.example/pixel.png').kind,
    rendering.ImageSourceKind.Remote
  );
  assert.equal(
    rendering.resolveImageSource('javascript:alert(1)').kind,
    rendering.ImageSourceKind.Blocked
  );

  // CommonMark accepts only ASCII space and tab as leading whitespace. One
  // invisible character in front of a line switches off every block construct
  // at once and the document renders as a single paragraph — the exact failure
  // that made generated lectures look as though Markdown had never run.
  const invisibleLeaders = {
    'U+00A0': ' ',
    'U+3000': '　',
    'U+FEFF': '﻿',
    'U+200B': '​',
    'U+2007': ' '
  };
  const blockSample = '## 标题\n\n正文。\n\n> 引用\n\n- 列表项';
  for (const [label, leader] of Object.entries(invisibleLeaders)) {
    const prefixed = blockSample.split('\n').map((line) => (line ? leader + line : line)).join('\n');
    const normalizedInvisible = rendering.normalizeMarkdownSource(prefixed);
    assert.match(normalizedInvisible, /^## 标题$/m, `${label} must not disable ATX headings`);
    assert.match(normalizedInvisible, /^> 引用$/m, `${label} must not disable blockquotes`);
    assert.match(normalizedInvisible, /^- 列表项$/m, `${label} must not disable lists`);
  }

  // A table renderer must preserve the parser context that Marked attaches at
  // render time. Losing it makes one table throw and forces the entire lecture
  // into the escaped plain-text fallback, exposing headings such as `##`.
  const markdownPolicy = {
    sanitize: (value) => value,
    sanitizeSvg: (value) => value
  };
  const renderedLecture = new rendering.MarkdownEngine(markdownPolicy).render([
    '## 核心概念',
    '',
    '### 判断方法',
    '',
    '| 设问类型 | 回应重心 |',
    '| --- | --- |',
    '| 综合分析 | 判断依据 |'
  ].join('\n'));
  assert.equal(renderedLecture.warnings.length, 0);
  assert.match(renderedLecture.html, /<h2>核心概念<\/h2>/);
  assert.match(renderedLecture.html, /<h3>判断方法<\/h3>/);
  assert.match(renderedLecture.html, /<div class="markdown-table-scroll"><table>/);

  // Leading whitespace is list-nesting depth, not spacing, so collapsing it
  // flattens nested lists and dissolves indented code blocks.
  assert.equal(rendering.normalizeMarkdownSource('- 外层\n  - 内层'), '- 外层\n  - 内层');
  assert.match(rendering.normalizeMarkdownSource('```\n    缩进保留\n```'), /^ {4}缩进保留$/m);

  // Chinese section numbering carries the structure of long-form model output,
  // but Markdown renders it as plain prose, so a whole lecture reads unrendered.
  const enumeratedLecture = rendering.normalizeMarkdownSource([
    '一、核心概念',
    '论证结构考查前提与结论的支持关系。',
    '（一）识别信号',
    '题干出现结论指示词。',
    '【常见误区】',
    '把结论错误当成论证有缺陷。'
  ].join('\n'));
  assert.match(enumeratedLecture, /^## 核心概念$/m);
  assert.match(enumeratedLecture, /^### 识别信号$/m);
  assert.match(enumeratedLecture, /^## 常见误区$/m);

  // Everything below must stay untouched, or the rewrite turns ordinary prose
  // and chat replies into tables of contents.
  const authoredHeadings = rendering.normalizeMarkdownSource('## 已有标题\n一、这条是正文\n二、这条也是');
  assert.match(authoredHeadings, /^一、这条是正文$/m);

  const orderedList = rendering.normalizeMarkdownSource('1. 买菜\n2. 做饭\n3. 洗碗');
  assert.match(orderedList, /^1\. 买菜$/m);
  assert.doesNotMatch(orderedList, /^#{1,6} /m);

  const singleMarker = rendering.normalizeMarkdownSource('开头说明\n一、唯一一条\n结尾说明');
  assert.match(singleMarker, /^一、唯一一条$/m);

  const numberedSentences = rendering.normalizeMarkdownSource(
    '一、这是一句完整的话，它有逗号也有句号。\n二、这也是一句完整的话，同样带着句号。'
  );
  assert.match(numberedSentences, /^一、这是一句完整的话/m);

  const fencedSample = rendering.normalizeMarkdownSource('```\n一、代码里的编号\n二、也不动\n```');
  assert.match(fencedSample, /^一、代码里的编号$/m);

  const parser = new content.GeneratedContentParser();
  const embeddedLecture = parser.parseObject({
    lecture: JSON.stringify(fixture.prompt),
    questions: [fixture]
  });
  assert.equal(embeddedLecture.lecture.schemaVersion, 'content.v1');
  assert.equal(embeddedLecture.questions.length, 1);
  assert.equal(typeof embeddedLecture.raw.lecture, 'object');

  const authoringPayload = parser.parseObject({
    lecture: JSON.stringify({
      sections: Array.from({ length: 6 }, (_, index) => ({
        id: `section-${index + 1}`,
        kind: ['concept', 'boundary', 'method', 'example', 'trap', 'summary'][index],
        title: `第 ${index + 1} 节`,
        markdown: '这一节提供足够完整的削弱论证教学内容、判断边界和解题方法。'
      }))
    }),
    questions: JSON.stringify([{
      id: 'question-1',
      capabilityCode: 'aptitude.judgment.weaken',
      material: null,
      prompt: '以下哪项如果为真，最能削弱题干中的因果论证？',
      options: [
        { id: 'A', text: '存在能够独立解释结果变化的其他重要因素。' },
        { id: 'B', text: '该结论获得了部分受访者的明确支持。' },
        { id: 'C', text: '研究过程使用了常见的数据统计方法。' },
        { id: 'D', text: '相关现象在其他地区也曾经出现过。' }
      ],
      correctOptionId: 'A',
      explanation: authoringExplanation(
        'A',
        '削弱论证',
        'A 项给出了能够独立解释结果变化的替代原因，直接削弱题干中的唯一因果联系。'
      )
    }])
  });
  assert.equal(authoringPayload.lecture.blocks.length, 6);
  assert.equal(authoringPayload.questions[0].templateCode, 'single_choice');
  assert.equal(authoringPayload.questions[0].options.length, 4);
  const groupedPayload = parser.parseObject({
    lecture: {
      sections: Array.from({ length: 6 }, (_, index) => ({
        id: `group-section-${index + 1}`,
        kind: ['concept', 'boundary', 'method', 'example', 'trap', 'summary'][index],
        title: `材料题第 ${index + 1} 节`,
        markdown: '这一节说明公共材料的阅读顺序、信息定位方法和选项比较规则。'
      }))
    },
    materialGroups: [{
      id: 'material-1',
      markdown: '资料一：这是一个包含多段事实、时间、主体和数据关系的完整公共材料。\n\n资料二：这一段继续提供两道小题共同使用的必要信息。'
    }],
    questions: [1, 2].map((sequence) => ({
      id: `group-question-${sequence}`,
      capabilityCode: 'aptitude.verbal.main_idea',
      materialGroupId: 'material-1',
      material: null,
      prompt: `根据公共材料，以下关于第 ${sequence} 个判断任务的说法，哪项最准确？`,
      options: [
        { id: 'A', text: '选项一提供了完整且可比较的判断结论。' },
        { id: 'B', text: '选项二提供了另一个具有干扰性的判断结论。' },
        { id: 'C', text: '选项三混淆了材料中的主体和时间范围。' },
        { id: 'D', text: '选项四遗漏了材料中明确给出的限定条件。' }
      ],
      correctOptionId: 'A',
      explanation: authoringExplanation(
        'A',
        '材料信息匹配',
        'A 项同时符合材料中的主体、时间和限定条件，是唯一完整匹配材料的选项。'
      )
    }))
  });
  assert.equal(groupedPayload.questions.length, 2);
  assert.equal(groupedPayload.questions[0].materialGroupId, 'material-1');
  assert.deepEqual(groupedPayload.questions[0].material, groupedPayload.questions[1].material);

  const dataAnalysisPayload = parser.parseObject({
    lecture: { sections: [{ kind: 'concept', title: '增长率', markdown: '先读表，再定位年份与指标。' }] },
    materialGroups: [{
      id: 'data-material-1',
      markdown: '某地区主要经济指标如下。',
      table: {
        caption: '主要经济指标',
        unit: '亿元',
        columns: [
          { label: '年份', alignment: 'left', valueType: 'text' },
          { label: '生产总值', alignment: 'right', valueType: 'number' },
          { label: '同比增速', alignment: 'right', valueType: 'percent' }
        ],
        rows: [['2024', 1200, '6.2%'], ['2025', 1290, '7.5%']],
        sourceNote: 'AI 生成练习数据'
      },
      visual: {
        svg: '<svg><rect x="10" y="20" width="30" height="60" /><rect x="60" y="10" width="30" height="70" /></svg>',
        alt: '2024 年与 2025 年生产总值对比柱状图',
        viewBox: '0 0 100 100'
      },
      chart: {
        type: 'combo',
        title: '生产总值与同比增速',
        unit: '亿元 / %',
        categories: ['2024', '2025'],
        series: [
          { label: '生产总值', values: [1200, 1290], renderAs: 'bar' },
          { label: '同比增速', values: [6.2, 7.5], renderAs: 'line' }
        ],
        sourceNote: 'AI 生成练习数据'
      }
    }],
    questions: [1, 2].map((sequence) => ({
      materialGroupId: 'data-material-1',
      material: null,
      prompt: `根据资料，第 ${sequence} 个问题的正确答案是哪项？`,
      options: ['100', '120', '150', '180'].map((text) => ({ text })),
      correctOptionId: 'A',
      explanation: { knowledgePoint: '增长量计算' }
    }))
  }, 'aptitude.data_analysis.growth');
  assert.deepEqual(
    dataAnalysisPayload.questions[0].material.blocks.map((block) => block.type),
    ['text', 'data_table', 'statistical_chart', 'svg_diagram']
  );
  assert.equal(dataAnalysisPayload.questions[0].material.blocks[1].rows[1].column_3, '7.5%');
  assert.equal(dataAnalysisPayload.questions[0].material.blocks[2].series[1].renderAs, 'line');
  assert.match(dataAnalysisPayload.questions[0].material.blocks[3].markup, /viewBox="0 0 100 100"/);
  assert.equal(
    content.resolveQuestionPresentation(dataAnalysisPayload.questions[0]),
    content.QuestionPresentationCode.DataMaterialChoice
  );

  console.log('Content schema verification passed.');
} finally {
  await server.close();
}

function authoringExplanation(correctOptionId, knowledgePoint, conclusion) {
  return {
    knowledgePoint,
    conclusion,
    steps: [
      '先定位题干的判断对象、核心关系和必要限定条件。',
      '再逐项比较选项是否直接改变结论成立的可能性。'
    ],
    optionAnalysis: ['A', 'B', 'C', 'D'].map((optionId) => ({
      optionId,
      verdict: optionId === correctOptionId ? 'correct' : 'incorrect',
      analysis: optionId === correctOptionId
        ? '该项直接命中题干的核心判断关系，并满足全部限定条件。'
        : '该项没有改变核心判断关系，或存在主体、范围、条件不匹配。'
    })),
    pitfalls: ['不要只看选项与材料是否相关，要比较它是否真正作用于题干结论。']
  };
}
