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
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  const fixturePath = path.join(webRoot, 'src/modules/content/fixtures/single-choice-weakening-v2.json');
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const validator = new content.ContentSchemaValidator();

  const valid = validator.parseSingleChoiceQuestion(fixture);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.options.length, 4);
  assert.equal(valid.value.correctOptionId, 'B');
  assert.equal(valid.value.explanation.blocks[0].type, content.ContentBlockType.Callout);
  const nullableOptionalFields = validator.parseSingleChoiceQuestion({
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

  const wrongAnswer = validator.parseSingleChoiceQuestion({ ...fixture, correctOptionId: 'E' });
  assert.equal(wrongAnswer.ok, false);
  assert(wrongAnswer.error.issues.some((issue) => issue.code === 'question.answer_missing'));

  const duplicateOptions = validator.parseSingleChoiceQuestion({
    ...fixture,
    options: fixture.options.map((option, index) => ({ ...option, id: index < 2 ? 'A' : option.id }))
  });
  assert.equal(duplicateOptions.ok, false);
  assert(duplicateOptions.error.issues.some((issue) => issue.code === 'question.option_id_duplicate'));

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
