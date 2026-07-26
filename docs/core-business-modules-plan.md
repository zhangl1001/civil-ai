# 核心业务模块规划

> 状态：生效  
> 架构：本地优先模块化单体，SQLite 为 iOS 真相源，IndexedDB 为 Web 同合同适配。  
> 原则：模块按业务事实和写入所有权拆分，通过公开 Command、Query、DTO 和 Event 组合。

## 1. 模块总览

产品核心收敛为三个独立业务模块：

```text
Content Generation     内容生成
Message Center         消息中心
Student Capability     个人能力分析
```

支撑模块：

```text
Candidate/Curriculum   考试周期、目标、能力图谱和元数据
Learning Evidence      作答、评分、错因和纠错事实
Task/Agent Runtime     长任务、工具调用、并发、取消、重试和恢复
AI Runtime             Provider、Prompt、Schema、调用账本和预算
```

支撑模块不拥有三个核心模块的业务规则。Agent 只负责调用用例，不直接写内容、消息或能力画像表。

## 2. 内容生成模块

### 2.1 职责

- 生成题目、讲义、学习内容、变式训练和复习材料。
- 根据内容类型解析对应 GenerationSpec、Prompt、Schema、Validator 和 Renderer Manifest。
- 动态加载当前能力节点、教学角色和最小学生上下文。
- 管理生成检查点、模型调用、结构解析、质量校验和原子发布。
- 复用已生成讲义；一套讲义可关联多套题组。

不负责：

- 判断用户是否掌握。
- 直接修改每日计划。
- 展示任务消息。
- 保存聊天思考过程。

### 2.2 子能力

```text
question_generation      生题
lecture_generation       生讲义
learning_content         生学习内容
review_material          生复习材料
assessment_material      生独立验证内容
```

不同内容类型通过版本化 Registry 组装：

```text
GenerationTemplateRegistry
PromptRegistry
ContentSchemaRegistry
ContentValidatorRegistry
ContentRendererRegistry
```

禁止用一个巨型提示词或万能 JSON Schema 生成所有题型。每个模板只加载当前任务需要的字段和规则。

### 2.3 数据所有权

内容模块独占写入：

```text
generation_specs
generation_workflows
ai_invocations_for_generation
lectures
question_sets
questions
content_documents
content_asset_relations
```

`GenerationSpec` 是不可变生成合同。`GenerationWorkflow` 只是内部检查点，不是用户任务。

### 2.4 公开接口

```text
RequestContentGeneration
RunContentGeneration
CancelContentGeneration
RetryContentGeneration
GetGenerationStatus
GetContentAsset
ListQuestionSets
FindReusableLecture
```

发布事件：

```text
content.generation_requested
content.generation_failed
content.question_set_committed
content.lecture_committed
content.learning_asset_committed
```

### 2.5 性能与稳定性

- 页面命令先在 150ms 内创建 `AgentRun`，不阻塞等待模型。
- 正常生成只调用模型一次；结构或质量失败最多完整重试一次。
- 题型专用 Schema 按需加载，禁止发送无关题型定义。
- 输出 token 根据题量动态预算，不固定申请最大值。
- 同一范围键禁止重复活动任务，全局最多三个模型任务并发。
- 供应商限流使用退避；任务、工作流和资源 ID 全链路关联。
- 模型结果先 staging，Schema 和质量全部通过后单事务发布。
- 讲义按能力节点、版本和教学角色复用，避免每套题重复生成。
- 页面重进从 Repository 查询任务和内容，不依赖 Pinia 缓存。

## 3. 消息中心模块

### 3.1 职责

- 保存系统消息、任务关键事件、学习结果、提醒和风险预警。
- 提供未读、已读、归档、业务分类和目标页面跳转。
- 作为所有业务统一的消息发布接口。

不负责：

- 执行任务。
- 保存每一个任务进度步骤。
- 根据消息反向修改业务事实。

任务中心回答“正在做什么”；消息中心回答“发生了什么需要用户知道”。

### 3.2 业务线

```text
tutor       私教
practice    刷题
essay       申论
interview   面试
planning    计划
review      复习
exam        模考
digest      积累
profile     档案
system      系统
```

消息类别：

```text
task
learning
reminder
result
warning
system
```

### 3.3 数据所有权与接口

消息模块独占写入 `system_messages`。

所有业务只调用：

```text
MessageCenter.publish()
MessageCenter.list()
MessageCenter.markRead()
MessageCenter.markAllRead()
MessageCenter.archive()
```

每条消息必须包含：

```text
business_line
category
event_code
severity
source_type/source_id
dedup_key
action_route/action_params
```

进度事件留在 `AgentRun`；只把排队、完成、失败、取消和需要用户处理的状态投影成消息。

## 4. 个人能力分析模块

### 4.1 职责

- 从不可变学习证据计算个人能力，而不是从聊天和题量猜测。
- 计算知识、方法、速度、稳定性、保持和迁移维度。
- 输出薄弱点、前置缺口、遗忘风险、训练饱和度和目标分差距。
- 维护可重算的掌握轨迹、快照、预测分区间和证据可信度。
- 为计划和 AI 私教提供只读能力摘要。

不负责：

- 生成题目。
- 修改原始作答和评分事实。
- 接受 AI 直接设置掌握度。
- 把用户自报分当作已验证能力。

### 4.2 输入事实

```text
objective attempts
subjective rubric scores
elapsed time
answer changes
hint/lecture exposure
error diagnoses and confirmations
retention results
transfer results
anchor assessments
evidence corrections
real mock/exam measurements
```

### 4.3 输出投影

```text
mastery_tracks
mastery_snapshots
weakness_priorities
forgetting_risks
score_projections
teaching_effectiveness
capability_summary
```

### 4.4 公开接口

```text
RefreshMasteryTrack
RebuildCapabilityProjection
GetCapabilityProfile
GetPriorityWeaknesses
GetReviewRisks
GetScoreProjection
GetTutorStudentSummary
CorrectLearningEvidence
```

发布事件：

```text
capability.mastery_changed
capability.weakness_detected
capability.regressed
capability.transfer_verified
capability.score_projection_changed
```

### 4.5 算法边界

- 算法和阈值必须版本化。
- 训练题、引导题、保持题、迁移题和锚定题权重不同。
- 少量证据只能提高可信度，不能快速宣布掌握。
- 被纠正或判定无效的题目证据必须从投影中排除。
- AI 可以解释画像并提出教学建议，但只能提交结构化提案，由代码校验后生效。

## 5. 依赖方向

```text
Candidate + Curriculum
          ↓
Content Generation ← Task/Agent Runtime → Message Center
          ↓
Learning Evidence
          ↓
Student Capability
          ↓
Planning + Tutor Decision
          ↓
新的 Content Generation 请求
```

禁止反向写入：

- 消息中心不能修改任务和能力。
- 内容生成不能修改掌握度。
- 能力分析不能篡改学习证据。
- 页面不能直接写 Repository。
- Agent 不能绕过 Application Service 写数据库。

## 6. 当前实现映射

| 规划模块 | 当前代码 | 状态 |
|---|---|---|
| 内容生成 | `modules/content`、`capabilities/ai-runtime` | 削弱论证纵向切片已接入，其他题型待按模板扩展 |
| 消息中心 | `modules/message-center` | SQLite/IndexedDB、分类、未读、归档、跳转已完成 |
| 个人能力分析 | `modules/mastery`、`modules/evidence` | 掌握轨迹、快照、复习队列已有，预测分和完整画像待增强 |
| 任务运行时 | `modules/agent`、`modules/task` | 用户可见长任务统一使用 AgentRun；`modules/task` 只保留通用任务状态值对象 |

## 7. 唯一真相源

同一个事实只能由一个模块持有，页面 Store 只保存临时交互状态。

| 事实 | 唯一真相源 | 禁止作为真相源 |
|---|---|---|
| 长任务状态、步骤、取消和重试 | `AgentRun` | 消息、页面 loading、聊天消息 |
| 模型调用、token 和供应商结果 | AI Invocation Ledger | 控制台日志、聊天内容 |
| 生成规格和生成检查点 | `GenerationSpec` / `GenerationWorkflow` | 页面筛选条件缓存 |
| 讲义、题组、题目和内容块 | Content Repository | Markdown 文件、Pinia、消息正文 |
| 作答、判分、错因和纠错 | Learning Evidence | 题目上的临时 CSS 状态 |
| 掌握度、遗忘风险和预测分 | Capability Projection | AI 自由文本、用户自报分 |
| 用户需要知道的业务事件 | `system_messages` | Task Dock 临时列表 |
| 聊天会话、回复和摘要 | Agent Workspace 文件日志 | SQLite/IndexedDB 业务表、任务消息、生成内容表 |

任何页面重新进入时都通过 Query/Application Service 读取真相源。任务完成后可以主动刷新，但不能把“刷新成功”当作业务提交成功。

## 8. 跨模块工作流

### 8.1 私教针对性训练

```text
GetTutorStudentSummary
→ Tutor Decision 选择能力缺口和教学阶段
→ 创建不可变 GenerationSpec
→ 创建 AgentRun
→ Content Generation 生成并原子发布
→ 发布 content.question_set_committed
→ Message Center 投影完成消息
→ 页面按 questionSetId 读取题组
```

AI 决定“为什么教、教什么、采用哪种教学动作”；代码校验考试周期、能力节点、题量、难度、评估角色和重复度。缺少可信能力证据时先诊断，不允许伪造个性化结论。

### 8.2 用户自主刷题

```text
用户选择模块和条件
→ Feature Adapter 解析为 GenerationSpec
→ 使用同一 AgentRun 和 Content Generation
→ 使用同一做题页、Evidence 和 Capability 链路
```

自主刷题只是决策来源不同，不能复制一套生题、任务、题目或批改系统。它产生的训练证据权重按评估角色计算，不得自动等同于独立掌握验证。

### 8.3 交卷与能力更新

```text
提交作答
→ 单事务保存 Attempt + Grading + Evidence + Outbox
→ 增量刷新涉及的能力节点和父节点
→ 更新复习风险与计划候选
→ 投影学习结果消息
→ Tutor Agent 决定继续深挖、降级、迁移或间隔复习
```

原始事实只追加，错误判定通过 correction 失效旧证据；投影可以按算法版本完整重算。

## 9. 一致性与事件规则

- 同一模块内涉及多个表的提交必须使用数据库事务。
- 跨模块不做分布式事务，采用本地 Outbox；业务事实和 Outbox 在同一事务提交。
- Consumer 使用 `event_id + consumer_name` 幂等，重复投递不得重复创建任务、消息或证据。
- 所有命令必须有业务幂等键；范围唯一约束负责阻止重复点击和并发重复派发。
- `AgentRun`、`GenerationWorkflow`、`AI Invocation` 和最终资源必须保留关联 ID。
- 失败发生在原子发布前，不允许暴露半套讲义或半套题；发布后消息失败不回滚业务事实。
- SQLite 为 iOS 真相源；IndexedDB 只实现同一 Port，不得形成不同业务规则。

## 10. 内容生成稳定性策略

### 10.1 模板合同

每个 `GenerationTemplate` 至少声明：

```text
template_id/version
supported_exam/module/question_type
prompt_version
response_schema_version
validator_version
renderer_template
token_budget_policy
quality_policy
```

复杂材料多问、资料分析图表、图推、申论和面试必须有独立 Schema/Validator/Fixture。禁止靠模糊正则从普通 Markdown 猜题干、选项和解析区域。

### 10.2 Provider 策略

- Anthropic 结构化内容通过强制 `tool_use + input_schema` 返回。
- OpenAI Compatible 使用供应商支持的结构化输出合同。
- 普通聊天保留流式文本；结构化内容统一非流式提交，避免半截 JSON。
- 正常任务一次模型调用；解析或质量错误最多完整重试一次。
- 限流和瞬断指数退避，动态并发从 3 降到 2、再降到 1；成功冷却后缓慢恢复。
- 明确区分 `provider.*`、`generation.*`、`policy.*` 和 `storage.*` 错误，不向用户暴露类名。
- 所有 Prompt、Schema、Validator 和模型参数进入调用账本，问题可复现。

### 10.3 性能预算

| 操作 | 目标 |
|---|---|
| 创建任务并反馈 UI | P95 小于 150ms |
| 本地列表/详情查询 | P95 小于 100ms |
| 增量能力刷新 | P95 小于 300ms |
| 页面恢复任务状态 | P95 小于 200ms |
| 消息发布/去重 | P95 小于 100ms |

模型生成耗时单独统计首字节、总耗时、输出 token、重试率和失败阶段，不能混入本地页面响应指标。

## 11. 代码组织合同

每个业务模块保持相同结构：

```text
domain/         实体、值对象、状态机、业务枚举
application/    Command、Query、事务编排
contracts/      Repository、外部 Port、公开 DTO
adapters/       SQLite、IndexedDB、Provider 实现
fixtures/       版本化元数据和测试样例
public.ts       唯一跨模块出口
```

- Feature 只能调用模块 `public.ts` 暴露的 Application API。
- Composition Root 负责装配；Domain/Application 不导入 Vue、Capacitor 或具体数据库。
- 业务代码统一引用枚举和 Registry，不散落题型、状态、路由、事件码和提示词 ID 字符串。
- Renderer 只解释 `ContentDocument`；它不读数据库、不判断掌握度、不发任务。
- 新内容类型通过注册模板、Schema、Validator 和 Renderer 扩展，不修改通用生成工作流的大量分支。

## 12. 分阶段实施与验收

### M1：统一生成底座

- 完成 `GenerationTemplateRegistry` 和统一请求入口。
- 削弱论证、长材料多问、资料分析和图推各有 Fixture 与端到端验证。
- Anthropic/OpenAI Compatible 结构化输出、错误分类和一次重试通过测试。

验收：同一生成规格结果可解析、可质检、可追踪；失败无半成品，重进页面能恢复状态。

### M2：统一任务和消息（已完成底座）

- 申论、面试、积累、月报、模考、精讲和批改已迁移为直接 AgentRun handler。
- 旧 LocalTask、TaskQueue、TaskStore 和兼容任务表已删除。
- 学习结果、主动提醒和风险事件通过 Message Center 发布。

验收：普通聊天不创建任务；所有长任务可取消、恢复、跳转，铃铛和 Task Dock 不串会话。

### M3：能力画像闭环

- 完成 `GetCapabilityProfile`、薄弱点、遗忘风险和预测分 Query。
- 增加锚定评估、迁移验证、证据纠错后的增量与全量重算。
- 首页只展示有证据和可信区间的画像。

验收：同一道错题因错因不同产生不同教学动作；少量证据不会宣布掌握；纠错后投影无污染。

### M4：私教主动决策

- 建立主动信号、冷却、频率偏好和计划重排。
- Agent 只读取预算内学生摘要，Skills/Tools 按需加载。
- 每个主动动作可解释、可关闭、可追踪效果。

验收：AI 能说明为什么学、学到哪里和下一步做什么，且不会重复打扰或无限调用工具。

### M5：收敛与发布

- 页面读取全部切新 Query DTO。
- 删除旧文件数据、旧 TaskQueue、重复 Store 和已替代 Service。
- 完成 SQLite 加密、备份恢复、完整性检查和 iOS 前后台回归。

验收：离线、杀进程、限流和重复点击不破坏数据；冷启动无旧数据路径和双任务系统。

## 13. 当前执行顺序

1. 完成内容模板注册合同，将生题、生讲义、学习内容统一到 Content Generation 入口。
2. 把申论、面试、积累和月报任务改为直接 AgentRun handler。
3. 建立 `GetCapabilityProfile` 聚合 DTO 和首页能力画像 Query。
4. 用 Outbox 将内容完成、学习证据和能力变化投影为分类消息。
5. 删除已迁移业务的旧 TaskQueue、文件数据和重复页面状态。
