# 真题基础设施与主动私教闭环改造计划

> 基线版本：`v1.0.0-foundation`
> 基线提交：`3c2ce32`
> 计划状态：P1-P7 结构化核心链路与自动化验收已完成；P8 Web Research、每日热点联网、文本/结构化文件/PDF 双端输入及 iOS 图片 OCR 已完成；精确版面还原、原文件资产引用、来源规则深化和 iPhone 真机发布验收仍待完成
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

题目来源类型和采集入口是两个维度，不能混为一个字段：

```text
acquisition_channel: user_import | agent_web_search
source_type: official | imported | user_created | ai_generated | ai_variant | diagnostic_anchor
```

用户导入和 Agent 联网发现只负责获得候选资料，必须汇入同一个扫描、确认、发布和来源追溯管线。

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
acquisition_channel
source_url
source_domain
source_title
search_query
fetched_at
verification_status
verification_evidence
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

1. 用户可从 Agent 对话入口导入 Markdown、JSON、CSV、文本、PDF 或图片，或者由 Agent 通过 `web.search` 发现候选来源并用 `web.read_page` 按需读取。Web 支持 PDF 文本层，iOS 使用 PDFKit + Vision 处理 PDF 文本层、扫描页和图片 OCR；精确版面还原与原文件资产引用仍属于后续增强。
2. Agent 工具 `question_bank.scan` 识别试卷、材料、小题、选项和答案候选。
3. 代码负责格式解析、题目边界、序号、必填字段和内容 Schema 校验。
4. 不确定的题目进入 `needs_confirmation`，不直接发布。
5. 用户确认后写入来源、原题、题目关联和能力标签。
6. 导入过程保留扫描版本和原始文件引用，便于重扫和纠错。

两个入口复用同一流程：

```text
用户导入文件/图片/文本 ─┐
                       ├→ 来源候选 → question_bank.scan → confirm → publish
Agent Web Search ──────┘
```

Web Search 找到内容不等于已确认真题。只有来源身份、考试范围和原文证据核验通过后才能标记为 `official`；无法确认的内容只能作为网络导入题或参考材料。

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

当前已实现的本地业务工具：

- `student.read_profile`
- `tutor.read_daily_context`
- `practice.read_library`
- `practice.read_question_set`
- `file.read_text`
- `question_bank.scan`
- `question_bank.resume`
- `question_bank.confirm`
- `question_bank.publish`
- `teaching.request_practice`
- `learning.review_session`
- `planning.propose_daily_plan`
- `candidate.change_target`

P8 新增的联网研究工具：

- `web.search`：按考试范围检索少量候选网页，只返回标题、摘要、URL、来源域名和时间。
- `web.read_page`：只读取 Agent 已选择的单个结果，执行正文抽取、长度限制、内容哈希和来源快照。

后续业务工具候选：

- `student.read_score_gap`
- `learning.read_active_thread`
- `learning.read_mastery_tracks`
- `learning.read_due_reviews`
- `practice.search_true_questions`
- `practice.request_true_question_session`
- `teaching.request_lecture`
- `teaching.request_variant_practice`
- `learning.submit_review_result`
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

### P1：真题元数据与来源模型（已完成）

- 新增来源、试卷、题目关联和 lineage 枚举。
- 改造 `QuestionRecord`、`QuestionSetRecord`、`GenerationSpecRecord` 合同。
- 增加 SQLite/IndexedDB 迁移和 Repository。
- 增加来源唯一约束、内容哈希和原题不可变约束。

验收：同一真题重复导入可幂等；原题不能被生成流程覆盖；删除导入资料不会污染学习证据。

### P2：真题导入与 Agent 扫描（结构化闭环已完成）

- 建立 `question_bank.scan`、`question_bank.confirm`、`question_bank.publish` 工具。
- 支持结构化 JSON/文本优先，再扩展 PDF/图片扫描。
- 建立不确定边界、答案冲突和材料小题关系的确认流程。
- 对扫描失败支持局部重试，不全量重扫。

当前已完成结构化 JSON、文本、PDF 文本提取、iOS 扫描 PDF/图片 OCR 和网页正文的 Agent 导入入口。提取结果写入统一附件资产，Agent 通过 `file.read_text(offset, maxChars)` 按需分段读取，再进入同一草稿、确认和发布合同。精确版面还原与原文件资产引用继续作为输入适配增强。

验收：一套多材料多小题真题可以保持顺序、材料关系和选项完整。

### P3：真题练习与题库导航（已完成）

- 增加真题库一级入口和试卷/年份/模块筛选。
- 真题、AI 变式和 AI 训练题组分类展示。
- 复用现有做题详情、答题卡、计时、批改、错题和历史。
- 真题练习直接写入同一学习证据链。

验收：真题整套练习、真题专项练习和真题复测都能跳转、提交、恢复和复盘。

### P4：真题参考包与生成校准（已完成）

- 实现按能力点和考试范围检索真题。
- 生成 `TrueQuestionReferencePack`。
- Prompt 增加真实题型分布、难度和干扰项参考。
- AI 变式题记录 parent question 和 derivation type。
- 建立生成题与真题的结构差异检查。

验收：生成题能追溯参考范围；不会把真题原文误当成 AI 新题；题型和难度分布可解释。

### P5：主动私教闭环（已完成）

- Agent 接入最小上下文读取工具。
- 建立 Observe/Diagnose/Propose/Execute/Assess/Schedule 循环。
- 每次训练结束追加结构化教学结论，而不是只追加聊天文字。
- 计划范围不清或跨模块时要求用户确认。
- 任务、消息、工具执行和页面跳转继续使用现有统一链路。

验收：用户问“我今天该学什么”时，Agent 能基于真实真题证据、能力和计划回答，而不是凭空建议。

### P6：基线与能力模型校准（已完成）

- 扩展初始诊断覆盖。
- 增加真题证据权重和可信度解释。
- 增加训练结果与真题复测的差异分析。
- 建立预测分区间，而非单点分数。

验收：系统能说明能力变化来自训练、真题校准、保持还是迁移证据。

### P7：可靠性与质量评测（自动化完成）

- 建立真题样本集和生成评测集。
- 测试题目结构、答案唯一性、知识点绑定、难度分布和渲染完整性。
- 测试模型超时、取消、限流、部分失败、重复执行和数据库恢复。
- 真机验证后台切换、任务恢复和导入中断。

自动化验收已完成。真实 iPhone 的手势切后台、系统杀进程和恢复操作属于发布门禁，必须在候选包上人工执行，不能用 Node/浏览器测试冒充真机结论。

### P8：Web Research 与双入口真题采集（核心完成）

- 已完成 Skill 路由、最小工具暴露、系统提示词组装和工具执行策略解耦；普通聊天零工具，工具元数据不写入系统提示词。
- 已新增供应商无关的 `WebResearchGateway`，业务层只依赖统一搜索与页面读取合同；默认适配无需密钥的内置免费搜索，并保留 Jina Search 与 Brave Search 作为可选增强，付费服务凭证由用户配置并存入安全存储。
- 已实现 `web.search` 和 `web.read_page`：每次最多 5 条结果、正文最多 24000 字符、只允许读取当前 Run 搜索产生的最多 20 个临时候选，并拒绝本机与内网 URL。
- Agent Runtime 已提供通用有界工具并发：AI 自主决定是否同回合发起多个独立只读调用，默认最多并行 3 个；依赖调用分回合，写入、破坏性和确认类工具串行，结果按原调用顺序回填，观察器和数据库进度写入单路执行。
- 已增加 `web_research` 导入方式；`agent_web_search`、URL、域名、查询词和抓取时间进入来源 provenance，草稿继续使用内容哈希与确认状态。
- 已建立 `research.true_questions`、`research.exam_syllabus`、`research.current_affairs` 三个按需 Skill；普通聊天不加载联网工具。
- 真题研究 Skill 已同时装配搜索、网页读取、扫描、恢复、确认和发布工具。搜索结果必须进入现有导入草稿，不允许搜索工具直接写正式题库。
- 官方来源需要来源规则和证据核验；第三方结果只能标记为网络导入或参考内容。
- 每日热点已改为先搜索近期来源，再让模型基于有编号的证据整理；最终 LearningAsset 保存查询词、URL、域名、摘录和抓取时间。每日知识点仍走非联网教学生成。
- 大纲变化只允许生成待确认建议，不直接修改知识地图；后续继续补官方域名规则和更细来源核验状态。
- 搜索与页面正文不写入对话上下文历史，只保留必要引用、结构化结论和业务来源记录。
- 无服务器模式默认可直接使用内置免费搜索；独立搜索 API 仍通过适配器接入，不把密钥硬编码进 App。

自动化已验收：普通聊天不暴露搜索工具；热点、真题和大纲意图只加载对应最小 Skill；三种搜索适配器、结果限额、内网拦截、只读工具并行/有序回填、观察器串行写入和真题统一草稿管线均有回归测试。国内网络可达性、真实可选搜索凭证和来源展示仍需在 iPhone 候选包人工验收。

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
v1.5.0-web-research
```

每个版本必须同时更新数据库迁移、公开合同、Agent 工具目录、提示词版本、验收脚本和真机验证记录。

## 10. 当前实施记录

### 2026-07-27：P1 完成

- 新增统一来源枚举：题目来源、来源状态、关联角色、校准角色、导入方式、派生方式和生成意图。
- `QuestionRecord`、`QuestionSetRecord` 和 `GenerationSpecRecord` 已具备来源、谱系和参考包字段。
- SQLite 增加 `022_question_source_foundation.sql`，IndexedDB 升级到版本 24。
- 新增 `question_sources`、`question_source_links`、`question_lineage` 和导入回执模型。
- SQLite 与 IndexedDB 共用同一 `QuestionSourceRepository` 合同。
- 新增 `ImportQuestionSource`，支持来源身份哈希、内容哈希和幂等回执。
- 新增 `ArchiveQuestionSource`，归档只改变来源状态，不删除题目关联和学习证据引用。
- 官方原题正文、答案、内容哈希和原始关联由 SQLite 触发器保护，生成流程不能覆盖。
- 已接入原生和 Web composition root，并增加 `check:question-source-foundation` 自动验收。

### 2026-07-27：P2 结构化导入闭环完成

- SQLite 增加 `023_question_import_drafts.sql`，IndexedDB 升级到版本 25。
- 新增扫描草稿、候选题和发布回执；正式发布前状态固定经过 `needs_confirmation -> confirmed`。
- 扫描只做页面渲染结构、答案引用、来源身份和材料关系硬校验，不对内容表达做机械评分。
- 候选题逐题保存，失败题可单独替换或拒绝，已通过题不需要重新扫描。
- 共用材料按原顺序绑定多个小题；单题材料不误建公共材料组。
- 发布在一个短事务中写入生成审计、正式题组、题目来源、来源关联和幂等回执。
- 新增 `question_bank.scan`、`question_bank.resume`、`question_bank.confirm`、`question_bank.publish` Agent 工具。
- 草稿按会话恢复时只返回状态和问题清单，不加载题目正文，不依赖模型记忆内部 ID。
- 用户确认由 Agent checkpoint 保持在同一次执行链中；确认成功后才能发布。
- 新增 `content.import.question_source` 提示词/导入策略版本和 `check:question-import-workflow` 自动验收。
- 已验证 001 至 023 全量 SQLite 迁移、外键检查和数据库完整性。

### 2026-07-27：P3 真题练习与题库导航完成

- 刷题中心增加“真题”一级模式，与私教题组、自主题组独立展示，不再混合来源。
- `QuestionSetLibraryQuery` 支持按来源、模块、练习状态、年份和地区查询；SQLite 使用轻量联表，IndexedDB 使用同一过滤合同，列表不读取题目正文。
- 真题列表展示来源类型、试卷名称、题量和练习状态；答题页明确展示官方真题、导入题或自建题来源。
- 整套真题直接进入现有答题会话；无学习主线的导入题会按能力节点复用或创建主线。
- 新增真题专项练习和真题复测，使用临时练习清单引用原题，不复制题目内容；复测只选择已完成题组。
- 真题整套、专项和复测全部复用现有计时、答题缓存、左右切题、交卷、批改、错因和复盘链路。
- 学习证据元数据增加题目来源、来源 ID、校准角色和官方标记，后续能力模型可区分真题与 AI 训练证据。
- 新增 `check:true-question-practice`，覆盖来源展示、筛选合同、学习主线复用、专项清单、复测范围和证据来源元数据。

### 2026-07-27：P4 真题参考包与生成校准完成

- 新增独立 `TrueQuestionReferencePack` 聚合，SQLite 增加
  `024_true_question_reference_packs.sql`，IndexedDB 升级到版本 26。
- 参考包严格按考试周期和能力节点检索，仅采样最多 12 个题组、40 道题和 3 道代表题，
  不读取或传递整套题库。
- 参考包保存题型、难度、题干长度、选项长度、材料结构和常见干扰项统计；
  同一来源快照按内容哈希复用，不重复生成。
- 结构化生题 Prompt 升级到 2.1.0。存在参考包时动态加载真题校准章节，
  无参考包时保持原生成路径，不声称已经过真题校准。
- 模型只在确实基于代表题做变式时返回 `referenceQuestionId`；
  应用校验引用范围与结构差异，不接受未知父题或近似复刻作为变式血缘。
- AI 变式题写入 `question_lineage`，保存父题、派生类型、生成工作流和参考策略快照；
  仅参考总体分布的题保持 `ai_generated`，避免伪造父题关系。
- 生成工作流验证记录增加 `trueQuestionDifference` 指标，可解释参考包是否使用、
  变式引用是否接受以及与代表题的结构差异。
- 新增 `check:true-question-reference-pack`，覆盖最小检索、内容哈希复用、
  近似复刻识别和变式题血缘；001 至 024 全量 SQLite 迁移与完整性检查通过。

### 2026-07-27：P5 主动私教闭环完成

- 新增独立 `tutoring` 模块和 `TutorCycleConclusion` 聚合，不把教学结论混入聊天日志、任务表或计划 JSON。
- SQLite 增加 `025_tutor_cycle_conclusions.sql`，IndexedDB 升级到版本 27；结构化保存
  Observe、Diagnose、Propose、Execute、Assess、Schedule 六个阶段快照。
- 客观题提交完成后，在掌握刷新、计划重排和错因任务派发之后幂等追加教学结论；
  AI 错因尚未完成时明确记录 `pending` 和对应 Run ID，不伪造已诊断结果。
- 新增 `tutor.read_daily_context`，单次最多读取 5 个优先能力、5 个到期复习、
  3 次近期练习、3 条进行中主线和 3 条最近教学结论。
- 真题上下文只读取当前优先能力的轻量题组目录与近期作答证据，不读取题目正文；
  明确区分“有真题资源”和“已经完成真题校准”。
- 主动私教 Prompt 使用书本式章节定义，要求基于真实计划、能力、复习、真题和教学结论回答；
  能力范围不唯一或跨模块时先列候选并向用户确认。
- 新增 `check:proactive-tutor-loop`，覆盖工具注册、最小上下文、真题证据、六阶段结论、
  幂等写入和下一动作/复习安排。

### 2026-07-27：P6 基线与能力模型校准完成

- 新增独立 `calibration` 模块和版本化 `AbilityCalibrationSnapshot`，原始作答证据保持不可变，
  校准算法可以升级后重算。
- SQLite 增加 `026_ability_calibration_snapshots.sql`，IndexedDB 升级到版本 28；快照按输入指纹幂等追加，
  聚合计算在事务外完成，事务只负责单行落库。
- 客观题证据策略升级为 `aptitude-objective:v2`，区分官方真题、导入真题、用户题、诊断锚点、
  AI 变式和 AI 训练题；旧 v1 证据在投影时按来源补充校准，不要求清库重装。
- 掌握算法升级为 `mastery-evidence:v2`，AI-only 训练不能仅靠题量获得与真题交叉验证相同的置信度。
- 初始诊断按判断推理、言语理解、资料分析、数量关系、常识判断五个模块补齐锚定覆盖，
  不再用总题量代替大纲覆盖。
- 能力快照分别输出训练正确率、真题正确率、校准差、速度、保持、迁移和置信度，
  并生成带依据、覆盖率与置信度的行测/申论预测分区间。
- 校准摘要已接入首页、质量追踪和 `tutor.read_daily_context`；Agent 获取聚合结论，
  不把全量作答证据塞入上下文。
- 新增 `check:ability-calibration`，覆盖来源权重、五模块基线、训练/真题差距、预测区间、
  变化快照和输入指纹幂等。

### 2026-07-27：P7 可靠性与质量自动化完成

- 新增 `check:content-quality-benchmark`，覆盖普通单题、长材料、共用表格、公式、SVG 图推和所有内容块渲染分支。
- 内容 Schema 对空表格、无有效 `<svg viewBox>` 画布和不可渲染图片引用执行硬拦截；教学表达和内容深度继续作为 AI 自主空间。
- 生成题按 `GenerationSpec` 难度区间形成稳定梯度，不再把整组题全部写成同一个平均难度。
- Provider 验收覆盖生成预算、父级取消、模型超时和限流错误分类；Agent 验收覆盖退避重试、意外中断、重试耗尽和不可重试结构错误。
- 生成闭环覆盖部分成功、缺位题定向修复、幂等提交和重复执行；真题导入覆盖扫描中断后按持久草稿恢复和幂等发布。
- 新增 `check:ios-lifecycle-recovery`，行为验证后台关闭门禁、前台单链恢复、恢复失败重试、数据库恢复后再回收 Agent 租约和健康检查兜底。
- Web 全量构建、TypeScript、001-028 SQLite 迁移、数据库完整性和 `git diff --check` 已通过。

### 2026-07-27：生成稳定性与 Markdown 渲染补强

- 生成硬门禁只保留会破坏页面渲染、作答或答案一致性的结构错误；教学深度、表达形式和可选章节继续记为质量告警，不触发模型重试。
- 有效题达到请求题量的 80% 时立即提交有效子集；低于 80% 才定向补齐缺位或结构异常题，不整批重生。
- 章节 ID、题目 ID 和选项 A-D 改由应用确定性注入；可选步骤、易错提醒和安全的答案大小写差异在本地归一化，减少无意义修正调用。
- Provider Gateway 会在运行期记住当前网关是否支持结构化工具模式；首次确认不支持后直接使用提示词 JSON 模式，避免每次生成都先发生一次无效请求。
- 每日积累 Prompt 明确 GFM 真实换行和半角标记合同；公共 Markdown 引擎同时兼容代码围栏、JSON 包装、字面量 `\\n`、转义标题和全角表格竖线。
- 新增并通过 80% 边界、确定性元数据归一化、结构化模式能力记忆和序列化 Markdown 渲染回归。

P1-P7 的编码阶段到此完成。下一步只执行候选包真机发布验收：前后台切换、提交中切后台、系统杀进程恢复、SQLite 升级、任务取消、限流和导入中断。

### 2026-07-27：基线后审计修复

- 修复 Agent 空闲 Worker lane 提前退出，保持配置的 1-3 路并发并按工作池公平领取任务；任一 lane 异常时统一中止并回收其余 lane。
- 补齐同一模型回合混合“可执行工具 + 待确认工具”的协议结果，防止供应商因缺少 tool result 提前结束 Agent 回合。
- AI 错因任务完成后以不可变新版本回写私教结论，清除 pending Run ID；每日上下文只读取每个练习会话的最新结论。
- 真题参考包新增全样本轻量比对集合，生成内容不得通过不声明 lineage 规避近似题检测；模型上下文仍只暴露最多三道代表题。
- 027/028 增量迁移增加带关联数据的 SQLite 门禁，确认题源、草稿、候选题、发布回执和参考包升级后均不丢失。
- Web/Native 数据库运行时收敛到一个 `TutorDatabaseRuntime` 合同；新增代码质量门禁禁止显式 `any`、TypeScript 绕过、超大文件继续增长和平台接口漂移。
