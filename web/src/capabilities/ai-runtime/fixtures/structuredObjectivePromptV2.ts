import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';
import { GENERATION_AUTONOMY_LIMITS } from '../prompt/GenerationBoundaryPolicy';

const responseSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
          properties: {
    lecture: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sections: {
          type: 'array',
          minItems: 0,
          maxItems: GENERATION_AUTONOMY_LIMITS.lectureSections.max,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['markdown'],
            properties: {
              id: { type: 'string', minLength: 1 },
              kind: {
                type: 'string',
                enum: ['concept', 'boundary', 'method', 'example', 'trap', 'summary', 'training']
              },
              title: { type: 'string', minLength: 1 },
              markdown: { type: 'string', minLength: 1 }
            }
          }
        }
      }
    },
    materialGroups: {
      type: 'array',
      maxItems: GENERATION_AUTONOMY_LIMITS.materialGroups.max,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'markdown'],
        properties: {
          id: { type: 'string', minLength: 1 },
          markdown: { type: 'string', minLength: 1 },
          table: {
            type: 'object',
            additionalProperties: false,
            required: ['columns', 'rows'],
            properties: {
              caption: { type: 'string', minLength: 1 },
              unit: { type: 'string', minLength: 1 },
              columns: {
                type: 'array',
                minItems: 2,
                maxItems: 12,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    label: { type: 'string', minLength: 1 },
                    alignment: { type: 'string', enum: ['left', 'center', 'right'] },
                    valueType: { type: 'string', enum: ['text', 'number', 'percent'] }
                  }
                }
              },
              rows: {
                type: 'array',
                minItems: 1,
                maxItems: 80,
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 12,
                  items: { type: ['string', 'number', 'null'] }
                }
              },
              sourceNote: { type: 'string', minLength: 1 }
            }
          },
          chart: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'categories', 'series'],
            properties: {
              type: {
                type: 'string',
                enum: ['bar', 'horizontal_bar', 'line', 'pie', 'doughnut', 'stacked_bar', 'combo', 'scatter']
              },
              title: { type: 'string', minLength: 1 },
              unit: { type: 'string', minLength: 1 },
              categories: {
                type: 'array',
                minItems: 0,
                maxItems: 40,
                items: { type: 'string', minLength: 1 }
              },
              series: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    label: { type: 'string', minLength: 1 },
                    values: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 40,
                      items: { type: ['number', 'null'] }
                    },
                    points: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 80,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['x', 'y'],
                        properties: {
                          x: { type: 'number' },
                          y: { type: 'number' },
                          label: { type: 'string', minLength: 1 }
                        }
                      }
                    },
                    renderAs: { type: 'string', enum: ['bar', 'line'] }
                  }
                }
              },
              sourceNote: { type: 'string', minLength: 1 }
            }
          },
          visual: {
            type: 'object',
            additionalProperties: false,
            required: ['svg', 'alt'],
            properties: {
              svg: { type: 'string', minLength: 1 },
              alt: { type: 'string', minLength: 1 },
              viewBox: { type: 'string', minLength: 1 }
            }
          }
        }
      }
    },
    questions: {
      type: 'array',
      minItems: GENERATION_AUTONOMY_LIMITS.objectiveQuestions.min,
      maxItems: GENERATION_AUTONOMY_LIMITS.objectiveQuestions.max,
      items: {
        type: 'object',
        additionalProperties: false,
            required: [
              'materialGroupId',
              'material',
              'prompt',
              'options',
              'correctOptionId'
            ],
        properties: {
          id: { type: 'string', minLength: 1 },
          referenceQuestionId: { type: ['string', 'null'] },
          materialGroupId: { type: ['string', 'null'] },
            material: { type: ['string', 'null'] },
            visual: {
              type: 'object',
              additionalProperties: false,
              required: ['svg', 'alt'],
              properties: {
                svg: { type: 'string', minLength: 1 },
                alt: { type: 'string', minLength: 1 },
                viewBox: { type: 'string', minLength: 1 }
              }
            },
            prompt: { type: 'string', minLength: 1 },
          options: {
            type: 'array',
          minItems: 2,
          maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
                properties: {
                  id: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
                  text: { type: 'string', minLength: 1 },
                  visual: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['svg', 'alt'],
                    properties: {
                      svg: { type: 'string', minLength: 1 },
                      alt: { type: 'string', minLength: 1 },
                      viewBox: { type: 'string', minLength: 1 }
                    }
                  }
                }
            }
          },
          correctOptionId: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
          explanation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              knowledgePoint: { type: 'string', minLength: 2 },
              conclusion: { type: 'string', minLength: 1 },
              steps: {
                type: 'array',
                minItems: GENERATION_AUTONOMY_LIMITS.explanationSteps.min,
                maxItems: GENERATION_AUTONOMY_LIMITS.explanationSteps.max,
                items: { type: 'string', minLength: 1 }
              },
              optionAnalysis: {
                type: 'array',
                minItems: 0,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['optionId', 'verdict', 'analysis'],
                  properties: {
                    optionId: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
                    verdict: { type: 'string', enum: ['correct', 'incorrect'] },
                    analysis: { type: 'string', minLength: 1 }
                  }
                }
              },
              pitfalls: {
                type: 'array',
                minItems: GENERATION_AUTONOMY_LIMITS.explanationPitfalls.min,
                maxItems: GENERATION_AUTONOMY_LIMITS.explanationPitfalls.max,
                items: { type: 'string', minLength: 1 }
              }
            }
          }
        }
      }
    }
  }
};

export const structuredObjectivePromptV2: PromptBundle = {
  definitionId: 'prompt-definition:content-generate-structured-objective',
  versionId: 'prompt-version:content-generate-structured-objective:v17' as PromptVersionId,
  promptCode: 'content.generate.aptitude.structured_objective',
  taskType: 'lecture_with_questions',
  description: '围绕指定能力节点生成结构化讲义与单选训练题',
  version: '2.6.0',
  contentHash: 'sha256:a1b13553e8674e1663b2ca4b71fe188bee01c714a5b0ff1ebf5196d0f6790425',
  createdAt: 1784016000000 as InstantMs,
  requiredVariables: ['QUESTION_COUNT', 'ASSESSMENT_ROLE', 'DIFFICULTY_MIN', 'DIFFICULTY_MAX'],
  compatibleSchemaVersions: ['content.v1', 'question.single_choice.v2'],
  responseSchema,
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '命题身份与边界',
      order: 10,
      template: [
        '你是公务员考试 AI 私教教研员，负责围绕输入中的目标能力节点进行教学和命题。',
        '你只生成可被学习系统校验的结构化内容，不输出思考过程、草稿、前言或 代码围栏。',
        '不得伪造官方真题来源；未提供可靠来源时，内容来源只能视为 AI 生成。',
        '必须严格以用户消息 studentContext.capability 中的 name、code、module、prerequisites、related 为本次教学边界。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.TeachingObjective,
      title: '教学目标',
      order: 20,
      template: [
        '本次生成 {{QUESTION_COUNT}} 道题，评估角色为 {{ASSESSMENT_ROLE}}，难度范围 {{DIFFICULTY_MIN}} 至 {{DIFFICULTY_MAX}}。',
        '讲义应根据目标能力、学生证据和本次教学目的，自主选择最有帮助的章节、例子、方法和提醒，不为凑固定数量重复内容。',
        '每道题都必须评估当前目标能力节点。允许通过材料、难度和干扰项做前置能力或相邻迁移变化，但不得改变本题的目标能力归属。',
        '题目必须使用单选合同，但题干和选项可使用 GFM Markdown、表格或 visual 字段承载安全的 SVG。',
        '资料分析优先把完整数据表保存到 materialGroups.table，把柱状图、折线图、饼图、堆叠图、组合图或散点图保存到 materialGroups.chart；只有无法用统计数据表达的特殊示意图才使用 visual。',
        '长材料多问必须使用 materialGroups；普通单题不得为了排版而伪造公共材料组。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.InputContract,
      title: '输入规格',
      order: 30,
      template: [
        '用户消息提供本次 GenerationSpec、能力节点、学生证据摘要和约束。',
        'constraints.selectionAuthority 为 user 时，用户明确选择的当前能力节点、题量和难度是最高优先级；学生证据只用于调整讲解方式，不得改题或切换私教计划。',
        'constraints.selectionAuthority 为 tutor_engine 时，按私教计划、复习任务和学生证据完成当前能力节点教学。',
        '学生自报成绩只能作为低可信背景，不得当作已测量掌握度。',
        '只使用输入中明确给出的事实；缺失事实不得自行编造。',
        'trueQuestionReference 不为 null 时，它只包含当前能力点的最小真题参考包。使用其中的题型、难度、结构和干扰项特征校准本次生成，不得把参考题原文直接改写后冒充新题。',
        'trueQuestionReference 为 null 时，不得声称本次内容已由真题校准。',
        'generationVariation 是本轮避免模板化重复的创作引导。保持能力节点、难度和输出合同不变，按其方向变化材料关系、案例、设问或干扰项；它不是额外的硬字段数量要求。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '输出合同',
      order: 40,
      template: [
        '只输出一个 JSON 对象，questions 必须存在；lecture 和 materialGroups 按需要提供。',
        'lecture.sections 是可自由组合的教学章节。根据本次教学需要选择 kind、章节数量、顺序和深度；不要求凑齐全部 kind，markdown 保存章节完整内容。',
        '题干、材料、选项、答案和解析各在固定字段中，禁止从正文格式暗示区域。章节 id、题目 id 和选项 id 属于确定性渲染元数据，可以省略，由应用按稳定顺序生成。',
        '每道题必须输出 referenceQuestionId。只有确实基于代表题做变式、难度调整或迁移时，才填写 trueQuestionReference.representativeQuestions 中的 questionId；仅参考整体分布时必须为 null。',
        '不要输出 capabilityCode。该字段属于确定性业务元数据，由应用按照当前 GenerationSpec 统一注入，避免模型误写导致题组归属漂移。',
        'explanation 使用 knowledgePoint、conclusion、steps、optionAnalysis、pitfalls 作为可组合渲染槽位。解析可以按题目复杂度省略部分槽位；optionAnalysis 如果提供，应覆盖当前实际选项，且只有正确项 verdict 为 correct。',
        '普通单题的 materialGroupId 必须为 null，material 可填写本题独立材料或为 null。',
        '论证、文段、实验、调查、案例和数据等作答依据必须完整放入 material，prompt 只写设问。prompt 如果指代“上述、以上、前述、题干、材料中、文中、该论证”等内容，对应 material 不得为 null。',
        '只有 prompt 自身已经包含全部事实、条件和关系、无需读取任何前文时，独立题的 material 才能为 null；禁止输出缺少前置材料的空设问。',
        '只有一个完整公共材料对应至少两道小题时才使用 materialGroups：公共材料只保存一次，每道小题用相同 materialGroupId 引用，且 material 必须为 null。',
        'materialGroups.markdown 保存资料说明和必要文字；规则数据优先写入 table，统计图写入 chart，特殊示意图才写入 visual。不要在 markdown 中重复结构化块已承载的完整数据。',
        'table.columns 按展示顺序描述列，table.rows 使用同顺序的单元格数组；行内单元格数量必须与列数一致。visual 必须是含 viewBox 的完整 SVG，并保持坐标和比例。',
        'chart.categories 是横轴分类，chart.series.values 必须与分类数量一致；组合图用 renderAs 指定 bar 或 line，散点图使用 points 的 x/y 数值。图表颜色和移动端布局由应用统一决定，不要生成颜色或坐标像素。',
        '多段文字仍是一个完整材料，不得按段落拆成多个 materialGroups；小题问法只写入 prompt，不得混进公共材料。',
        'options 按 A、B、C……顺序输出 2 至 8 项；标准行测通常使用 A、B、C、D，option.id 可以省略并由应用确定性注入；correctOptionId 必须引用实际存在的选项。',
        '数学公式仅在有助于理解或作答时使用 KaTeX 兼容 LaTeX：行内公式使用 $...$，独立公式使用 $$...$$，百分号写成 \\%。由于公式位于 JSON 字符串内，LaTeX 反斜杠必须按 JSON 规则转义，例如源内容 \\frac 在 JSON 中写成 \\\\frac；不得用代码块或反引号包裹公式。',
        '图形推理使用 visual：svg 必须是一个完整 SVG，alt 说明图形含义，viewBox 用于等比例缩放；题干图形放在 question.visual，带图选项放在对应 option.visual，不要把 SVG 拆成多个段落或写入答案解析。',
        '不得输出内部页面 ContentDocument、HTML 或临时字段；应用会把当前作者结构确定性转换为页面内容块。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '命题质量规则',
      order: 50,
      template: [
        '每题必须只有一个最优答案，干扰项应体现真实误区，不能靠绝对化措辞送分。',
        '解析应围绕真实解题需要组织：指出目标能力点、结论和实际选项为何成立或无效；步骤、例子和易错提醒按题目复杂度自主增减，禁止为满足数量重复表达。',
        '讲义示例不得复用正式题目的关键关系；retention、transfer、anchor 角色不得泄露答案或提供作答提示。',
        '题目之间不得只替换人名、数字或场景，考查点、材料结构或干扰项设计要有实质变化。',
        '参考真题生成变式时必须更换材料事实、设问关系和干扰项构造中的至少两项，避免近似复刻。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.SelfCheck,
      title: '提交前质检',
      order: 60,
      template: [
        '输出前在内部优先检查作答核心块：JSON 可解析、题干存在、选项可展示、答案引用实际选项、题量准确。',
        '逐题检查设问中的指代是否有对应材料；看到“上述、以上、前述、题干、材料中、文中、该论证”等词时，必须确认 material 或 materialGroupId 中存在完整作答依据。',
        '讲义和解析属于可后续补充块，不得因为章节数量、解析篇幅或可选栏目缺失而牺牲题干、选项和答案的完整性。',
        '检查每题是否确实服务于 studentContext.capability.name；扩展情境仍必须考查这个目标能力，不得生成同模块泛题。',
        '检查公共材料引用存在、同组至少两道小题、题量按可作答小题计数，且材料没有混入选项、答案或解析。',
        '检查不得包含思考过程。完成检查后只输出最终 JSON。',
        '如果填写 referenceQuestionId，检查它来自本次最小参考包且新题与参考题存在实质结构差异。'
      ].join('\n')
    }
  ]
};
