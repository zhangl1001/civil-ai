# 真题基础设施与主动私教闭环改造计划

> 基线版本：`v1.0.0-foundation`
> 基线提交：`3c2ce32`
> 计划状态：待实施
> 原则：真题是标准和锚点，AI 题是训练和扩展，能力模型负责比较两者之间的表现差异。

## 1. 改造目标

当前系统已经有建档、能力轨迹、每日计划、结构化生题、答题、批改、错因和复习底座，但主要内容仍由 AI 生成。缺少真题后，系统会出现三个风险：

- AI 题风格偏离真实考试，用户在 AI 题上提升不代表考试能力提升。
- 初始能力基线缺少真实锚点，能力画像的可信度不足。
- AI 会根据自己生成的题继续生成相似题，形成封闭反馈循环。

改造后形成：

```text
真题导入/真题库
  -> 真题诊断
  -> 真实能力基线
  -> AI 讲解与变式训练
  -> AI 题独立训练
  -> 真题复测
  -> 能力变化确认
  -> 间隔复习与迁移训练
```

真题不是普通题组的一个标签，而是内容、评估、Agent 上下文和能力模型共同依赖的基础业务。

## 2. 产品边界

### 2.1 题目来源分层

所有题目必须明确来源：

```text
official          有授权的官方真题
imported          用户导入的个人真题资料
user_created      用户手工创建
ai_generated      AI 生成训练题
ai_variant        基于真题结构生成的 AI 变式题
diagnostic_anchor 真题或经过校准的诊断锚定题
```

来源由代码维护枚举，页面和提示词不得使用散落字符串。

### 2.2 不变量

- 真题原文、答案、解析和来源信息不可被 AI 改写。
- AI 只能创建新题或提交变式关系，不能覆盖真题。
- 每道 AI 变式题必须记录参考真题和生成策略。
- 真题练习、AI 训练、诊断、保持和迁移必须在学习证据中区分。
- 真题能力证据权重高于普通 AI 练习，但不能只靠一次真题决定掌握。
- 真题内容展示必须遵守授权范围；没有授权时优先支持用户本地导入，不把受版权保护的题库硬编码进应用。
- Agent 只能获得当前能力点所需的最小真题参考包，不读取整套题库。

## 3. 数据层设计

### 3.1 `question_sources`

记录来源或试卷级元数据：

```text
id
source_type
provider
exam_type
exam_year
province
exam_batch
paper_name
section_name
copyright_or_provenance
import_method
content_hash
source_version
status
created_at
updated_at
```

### 3.2 `question_source_links`

把题目与来源、试卷顺序和小题关系绑定：

```text
question_id
source_id
source_sequence
material_group_key
relation_role: original | reference | calibration
```

### 3.3 `question_lineage`

记录 AI 题与真题之间的派生关系：

```text
question_id
parent_question_id
derivation_type: variant | difficulty_adjustment | transfer | repair
generation_workflow_id
reference_snapshot
created_at
```

### 3.4 现有内容模型调整

`QuestionRecord` 和 `QuestionSetRecord` 增加结构化来源字段：

- `originType`
- `sourceId`
- `sourceSequence`
- `lineageId`
- `calibrationRole`
- `isOfficial`

`GenerationSpecRecord` 增加：

- `referencePackId`
- `referencePolicyVersion`
- `generationIntent`
- `calibrationTarget`

不使用 `constraints.source` 继续承载全部来源语义。

### 3.5 真题参考包

Agent 每次只接收一个按需生成的 `TrueQuestionReferencePack`：

```text
examScope
module
capabilityNode
questionTypeDistribution
difficultyDistribution
stemLengthRange
optionPatternSummary
commonDistractorPatterns
representativeQuestionRefs
recentCandidateEvidence
referencePackVersion
```

代表题正文只有在授权、用户导入或业务确实需要时才进入上下文；统计摘要和结构特征默认优先。

## 4. 真题业务流程

### 4.1 真题导入与扫描

1. 用户从“真题库”入口导入 PDF、图片、Markdown、JSON 或文本。
2. Agent 工具 `question_bank.scan` 识别试卷、材料、小题、选项和答案候选。
3. 代码负责格式解析、题目边界、序号、必填字段和内容 Schema 校验。
4. 不确定的题目进入 `needs_confirmation`，不直接发布。
5. 用户确认后写入来源、原题、题目关联和能力标签。
6. 导入过程保留扫描版本和原始文件引用，便于重扫和纠错。

### 4.2 真题练习

真题作为独立入口，支持：

- 按考试、年份、省份、试卷和模块筛选。
- 整套试卷练习。
- 按知识点或能力点抽取真题。
- 真题诊断模式。
- 真题复测和迁移验证。

真题详情复用现有做题模板，但页面必须明确显示“真题/AI 变式/AI 训练”来源。

### 4.3 AI 生题

AI 生题前先读取：

1. 当前考试范围。
2. 当前能力点和前置能力。
3. 相关真题分布和代表结构。
4. 用户最近错因与训练阶段。
5. 本次生成的教学目的。

AI 允许在内容和表达上自主发挥，但代码固定：

- 题目结构。
- 答案可判定性。
- 题干、选项、解析和材料块的边界。
- 题目与能力点的绑定。
- 真题与变式的 lineage。
- 页面渲染所需的 Schema。

## 5. 主动私教 Agent 改造

### 5.1 主动决策循环

```text
Observe       读取当前周期、能力、真题证据、计划和进行中的学习主线
Diagnose      判断目标差距、薄弱点、遗忘风险和训练阶段
Propose       给出今日教学动作和理由
Confirm       范围不清、跨模块或高成本动作先询问用户
Execute       调用真题、讲义、变式题、批改和复习工具
Assess        读取结果、错因、速度、保持和迁移证据
Schedule      更新下一次训练和复习窗口
Explain       向用户总结完成情况和下一步
```

### 5.2 必要工具

工具只向模型公开 description 和输入合同，完整业务约束由代码维护：

- `student.read_profile`
- `student.read_score_gap`
- `learning.read_active_thread`
- `learning.read_mastery_tracks`
- `learning.read_due_reviews`
- `practice.search_true_questions`
- `practice.read_question_set`
- `practice.request_true_question_session`
- `teaching.request_lecture`
- `teaching.request_variant_practice`
- `learning.submit_review_result`
- `planning.propose_daily_plan`
- `planning.rebalance_after_learning`
- `report.read_learning_change`

每个工具必须声明读取范围、写入范围、幂等键、是否需要确认和可用 Agent 类型。

### 5.3 AI 与代码边界

AI 决定：

- 今天优先处理哪个能力缺口。
- 先讲解、先做真题还是做变式训练。
- 讲解深度和陪伴语气。
- 是否扩展到关联知识点。
- 如何向用户解释训练安排。

代码决定：

- 真题和题目事实。
- 目标分和能力计算。
- 训练阶段迁移。
- 题量、时间、并发和失败重试。
- 任务状态和数据库事务。
- 能力证据是否有效。

## 6. 能力模型增强

### 6.1 证据权重

建议按来源和评估角色分层，而不是简单把正确率混在一起：

```text
official_anchor    最高校准权重
imported_true      高校准权重
transfer           高迁移权重
retention          高保持权重
independent        常规训练权重
guided             较低训练权重
teaching           不直接证明掌握
```

### 6.2 基线覆盖

初始诊断不再只选择一个能力点。按考试周期逐步覆盖：

- 行测各模块至少一个锚点。
- 重点模块的核心知识点。
- 申论阅读、概括、对策、应用文和大作文基本维度。
- 用户自报分与真实锚点之间的偏差。

能力基线输出必须包括：

- 当前分数区间。
- 目标差距。
- 样本数量和可信度。
- 已覆盖模块。
- 未覆盖模块。
- 下一步诊断建议。

### 6.3 能力变化

能力变化不只显示正确率，还要区分：

- 训练提升。
- 真题校准提升。
- 速度提升。
- 错因减少。
- 保持能力。
- 迁移能力。
- 目标分贡献。

## 7. 分阶段改造计划

### P0：版本封存（已完成）

- 当前代码提交：`3c2ce32`
- 远端分支：`feature/vue-migration-refactor`
- 远端标签：`v1.0.0-foundation`
- 固化当前 Vue、SQLite、Agent、任务中心和客观题闭环。
- 后续不在此基线上直接混入真题业务变更。

### P1：真题元数据与来源模型

- 新增来源、试卷、题目关联和 lineage 枚举。
- 改造 `QuestionRecord`、`QuestionSetRecord`、`GenerationSpecRecord` 合同。
- 增加 SQLite/IndexedDB 迁移和 Repository。
- 增加来源唯一约束、内容哈希和原题不可变约束。

验收：同一真题重复导入可幂等；原题不能被生成流程覆盖；删除导入资料不会污染学习证据。

### P2：真题导入与 Agent 扫描

- 建立 `question_bank.scan`、`question_bank.confirm`、`question_bank.publish` 工具。
- 支持结构化 JSON/文本优先，再扩展 PDF/图片扫描。
- 建立不确定边界、答案冲突和材料小题关系的确认流程。
- 对扫描失败支持局部重试，不全量重扫。

验收：一套多材料多小题真题可以保持顺序、材料关系和选项完整。

### P3：真题练习与题库导航

- 增加真题库一级入口和试卷/年份/模块筛选。
- 真题、AI 变式和 AI 训练题组分类展示。
- 复用现有做题详情、答题卡、计时、批改、错题和历史。
- 真题练习直接写入同一学习证据链。

验收：真题整套练习、真题专项练习和真题复测都能跳转、提交、恢复和复盘。

### P4：真题参考包与生成校准

- 实现按能力点和考试范围检索真题。
- 生成 `TrueQuestionReferencePack`。
- Prompt 增加真实题型分布、难度和干扰项参考。
- AI 变式题记录 parent question 和 derivation type。
- 建立生成题与真题的结构差异检查。

验收：生成题能追溯参考范围；不会把真题原文误当成 AI 新题；题型和难度分布可解释。

### P5：主动私教闭环

- Agent 接入最小上下文读取工具。
- 建立 Observe/Diagnose/Propose/Execute/Assess/Schedule 循环。
- 每次训练结束追加结构化教学结论，而不是只追加聊天文字。
- 计划范围不清或跨模块时要求用户确认。
- 任务、消息、工具执行和页面跳转继续使用现有统一链路。

验收：用户问“我今天该学什么”时，Agent 能基于真实真题证据、能力和计划回答，而不是凭空建议。

### P6：基线与能力模型校准

- 扩展初始诊断覆盖。
- 增加真题证据权重和可信度解释。
- 增加训练结果与真题复测的差异分析。
- 建立预测分区间，而非单点分数。

验收：系统能说明能力变化来自训练、真题校准、保持还是迁移证据。

### P7：可靠性与质量评测

- 建立真题样本集和生成评测集。
- 测试题目结构、答案唯一性、知识点绑定、难度分布和渲染完整性。
- 测试模型超时、取消、限流、部分失败、重复执行和数据库恢复。
- 真机验证后台切换、任务恢复和导入中断。

## 8. 不在本阶段做的事情

- 不恢复旧 Markdown/JSON 题库数据层。
- 不让 AI 直接修改真题。
- 不把整个题库塞入上下文。
- 不把所有教学策略写死成固定流程。
- 不用一次正确率直接宣布掌握。
- 不为了支持旧数据增加双读、双写或兼容字段。

## 9. 版本策略

`v1.0.0-foundation` 是底座封版。真题模块完成后再发布：

```text
v1.1.0-true-question-foundation
v1.2.0-true-question-practice
v1.3.0-proactive-tutor-loop
v1.4.0-mastery-calibration
```

每个版本必须同时更新数据库迁移、公开合同、Agent 工具目录、提示词版本、验收脚本和真机验证记录。
