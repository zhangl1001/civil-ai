# AI 私教服务架构设计

> 状态：核心运行时已实施，扩展能力继续按本文推进
> 上位约束：[Zhangl Agent 架构宪法](./architecture-constitution.md)  
> 业务依据：[AI 私教能力提升闭环重构计划](./ai-tutor-capability-loop-redesign-plan.md)  
> 部署方式：本地 TypeScript 服务层直接访问用户配置的模型供应商，不依赖自建云服务。
> Agent Runtime 边界决策：[ADR-001：供应商无关的本地 Tutor Agent Runtime](./adr-001-provider-neutral-agent-runtime.md)

## 1. 设计目标

AI 服务不是一个 `complete(messages)` 工具，而是连接学生事实、教学决策、模型能力和可靠业务落库的受控运行时。

它必须同时保证：

- AI 像长期私教一样理解当前教学主线，而不是只记最近聊天。
- 页面按钮触发确定性工作流，对话可通过 Agent 自主选择标准工具。
- 提示词按任务动态组合、版本化、可测试、可回放。
- 模型输出不能绕过 Schema、领域规则和事务直接写业务状态。
- 多任务并发时不串会话、不串资源、不重复派发。
- 限流、断网、取消、切后台和杀进程后状态可解释、可恢复。
- Anthropic、OpenAI Compatible 等供应商差异不会泄漏到业务层。
- 质量、延迟、token 和调用成本可观测、可治理。

## 2. 已删除实现的审计结论

以下旧实现已经删除，保留问题结论用于防止架构回退：

| 当前问题 | 影响 |
|---|---|
| `AIEngine` 只提供字符串 `complete/stream` | 无工具调用、结构化结果、usage、finish reason 和统一事件语义 |
| 提示词散落在 `QuestionPrompts.ts`、`PracticeGradingPrompts.ts`、`AIRunners.ts` 和 Service | 无统一版本、依赖声明、回归测试和灰度能力 |
| `AIRunners.ts` 混合编排、提示词、模型请求、解析、修复和 Repository 写入 | 业务边界不清，失败后难以确定可靠检查点 |
| 聊天上下文使用最近消息和字符预算 | 与学生模型和学习主线脱节，token 估算不可靠，重要事实可能丢失 |
| `AICommandRouter` 是一次分类、一次工具执行 | 不能支持多步 Agent，也不能可靠处理工具结果后的继续决策 |
| 内联自然语言进度和回复 | 难以国际化、复用和保证工具状态与消息状态一致 |
| 解析失败后依赖通用修复 | 不能区分供应商截断、Schema 错误、教学质量错误和业务约束错误 |
| Provider 能力未建模 | Anthropic/OpenAI 的工具、JSON、流式和取消差异会不断产生分支 |

重构采用 clean break，不为这些边界保留兼容接口。

## 3. 总体分层

```text
UI / Page Command / AI Chat
              |
AI Application Facade
  确定性命令入口、对话入口、取消、恢复
              |
Workflow Orchestrator -------- Agent Runtime
  业务状态机                   对话工具循环
              |                    |
        Context Compiler      Tool Registry
              |                    |
        Prompt Compiler ------ Policy Guard
              |
          Model Router
              |
         Provider Gateway
              |
 Anthropic / OpenAI Compatible / Future Provider
              |
 Structured Output + Quality Pipeline
              |
 Result Committer + Unit of Work + Outbox
```

横切能力：Invocation Ledger、token/延迟预算、重试和限流、隐私脱敏、可观测性、取消和检查点。

### 3.1 “服务端”的实际边界

当前产品不自建云服务，AI Service 运行在 iOS/Web 本地应用进程中，远端只有用户选择的模型供应商：

```text
Vue UI
→ 本地 AI Application/Agent/Workflow Service
→ 本地 SQLite（业务事实与可恢复工作流）
→ Agent Workspace 文件日志（会话与记忆）
→ Provider Gateway
→ 用户配置的 Anthropic/OpenAI Compatible API
```

因此不能依赖常驻服务进程、远端队列和云端定时器。任务、Agent run、检查点和 Outbox 持久化在本地 SQLite；会话、摘要和 Agent 记忆保存在可删除的本地 Agent Workspace 文件日志；流式增量和工具执行明细只存在于当前进程的有界内存。App 未运行时只允许 iOS 本地通知，不伪装成 Agent 仍在后台工作。

同时，内部接口按进程无关的 Port 设计，Provider、Repository、Clock、Notification、Audio 和 File Asset 都通过 Adapter 接入。未来如增加可选同步或自建网关，可以移动 Adapter，不重写领域与 Agent 逻辑。

## 4. 两种执行路径

### 4.0 Tutor Agent 是产品主体

用户感知到的不是一个被动聊天客服，而是一个围绕考试周期持续工作的 `Tutor Agent`：

```text
理解目标
→ 主动读取当前教学状态
→ 解释判断依据
→ 必要时向用户确认
→ 选择并调用工具
→ 观察工具结果
→ 继续下一教学动作
→ 总结本轮变化
→ 安排后续复习或主动信号
```

Agent 的身份跨页面存在，但运行实例相互隔离。它记住的是结构化考试周期、学习主线和已确认事实，不是无限累积的聊天文本。

所有核心页面动作都可以向同一 Tutor Agent 发布领域事件。用户从页面发起生题或批改后，Agent 能在对话中解释正在解决的能力缺口、根据中间结果调整动作，并在完成时说明画像和下一步发生了什么，而不是只弹出机械的“任务完成”。

### 4.1 页面确定性工作流

页面点击“每日计划生题、提交批改、生成讲义”等动作时，不先让 AI 猜意图：

```text
Typed Command
→ Application Validator
→ 创建 workflow/task
→ 固定工作流状态机
→ 在明确步骤调用 AI
→ 校验
→ 事务提交
```

AI 负责内容和语义判断，代码负责步骤顺序与落库。这样速度快、行为稳定、可恢复。

### 4.2 对话 Agent

用户在 AI 对话框自然表达需求时：

```text
用户消息
→ Context Compiler
→ Agent Runtime
→ 模型选择工具或直接回复
→ Policy Guard 检查风险与参数
→ 必要时向用户确认
→ 执行工具
→ 工具结果回到同一 Agent turn
→ 模型继续调用工具或形成回复
```

Agent 可以在一次交互中调用多个工具，但不能直接操作 Repository 或数据库。所有写工具最终调用 Application Use Case。

### 4.3 何时不用 Agent

- 页面动作参数明确时不用 Agent。
- 本地统计、排序、状态迁移和基础计划不用 Agent。
- 固定的生成、批改和复习工作流不用开放式 Agent 控制步骤。
- 低成本规则能可靠判断时，不额外调用意图模型。

Agent 用于理解自然语言、补齐信息、选择教学动作和解释决策，不用于制造不必要的自主性。

这里的“不用 Agent”是指不让模型控制可靠业务步骤，不是让用户失去私教交互。确定性工作流仍向 Tutor Agent 发布阶段事件，Agent 可以基于真实结果进行教学解释和后续决策。

### 4.4 老版 Agent 能力取舍

保留并重构：

- 多 turn 模型与工具循环。
- 工具开始、执行、完成和失败事件。
- 流式自然语言反馈。
- 中断、恢复和工具结果回送模型。
- 根据工具结果继续执行，而不是一次分类后结束。
- 专业提示词章节和按需加载能力。

不原样迁移：

- 所有工具每次全部发给模型。
- 全量聊天和文件内容持续进入上下文。
- 最多 100 turn 的宽松开放循环。
- AI 直接通过文件工具修改能力画像和业务事实。
- 用任务列表是否完成作为唯一 Agent 完成条件。
- 同步文件工具在多个线程并行写核心数据。

新版完成条件由当前 Agent 目标、工作流状态、用户确认和领域退出条件共同决定。

## 5. Agent Runtime

### 5.1 运行时状态

每次运行绑定：

```text
agent_run_id
workflow_id
tutor_session_id
exam_cycle_id
learning_thread_id（可空）
user_message_id
assistant_message_id
prompt_bundle_version
tool_catalog_version
status
turn_count
tool_call_count
checkpoint
```

消息、工具调用、任务和业务结果都通过 `workflow_id` 贯穿。前端不能用“最近一个任务”猜当前会话工具状态。

### 5.2 循环约束

- 默认最多 8 个模型 turn、12 次工具调用。
- 单 turn 工具调用上限 4。
- 检测相同工具和相同参数重复调用。
- 只读且互不依赖的工具可并行；写工具和同资源工具串行。
- 达到上限时停止并给出已完成、未完成和需要用户确认的内容。
- 取消时保留已经可靠提交的结果，未提交的 staging 结果作废。
- 工具 use/result 必须成对持久化；恢复前先修复或关闭孤立调用。

### 5.3 Agent 事件

统一输出类型化事件，不让 UI 解析自然语言判断状态：

```text
run_started
text_delta
tool_call_requested
tool_call_started
tool_call_succeeded
tool_call_failed
confirmation_required
checkpoint_saved
result_committed
run_cancelled
run_failed
run_completed
```

工具执行条显示 tool event；任务栏显示 workflow/task；对话区显示 assistant message，三者共享 ID 但不混用展示内容。

### 5.4 Agent 记忆分层

Agent 不拥有一个无限增长的 messages 数组。记忆分为：

| 记忆层 | 内容 | 存储与生命周期 |
|---|---|---|
| 工作记忆 | 当前用户输入、当前 turn、未完成工具调用 | `agent_run` 检查点与进程内状态，运行结束后丢弃或压缩 |
| 会话记忆 | 当前交流目标、已确认参数、必要对话摘要 | Agent Workspace 文件日志，可开启或删除会话 |
| 情节记忆 | 某条学习主线发生过的教学动作及效果 | `learning_thread/events/interventions`，跨日保留 |
| 语义记忆 | 目标、能力轨迹、确认错因、有效偏好 | 领域表和可重算投影，不从聊天推断覆盖 |
| 前瞻记忆 | 待复习、未完成计划、主动信号和未来节点 | plan/review/signal，按状态消费 |

模型只读取 Context Compiler 为当前任务生成的视图。删除聊天会同步删除消息、摘要和该会话作用域的 Agent 记忆，但不删除已确认的学习事实；学习事实纠错会使相关会话摘要和上下文缓存失效。

### 5.5 Agent 目标与生命周期

每个 run 只有一个显式目标和完成条件：

```text
goal_type
goal_statement
success_criteria
allowed_tools
resource_budget
requires_user_confirmation
terminal_states
```

Agent 不能因为“还有可做的事”无限延长运行。完成当前目标后，可以提出下一步建议，但未经用户确认不能把建议自动变成高成本任务。

### 5.6 上下文膨胀防线

- 工具结果返回引用和摘要，完整资产留在数据库。
- 重复查询结果以 `result_hash` 去重，不反复注入。
- 每个上下文视图有独立 token 配额和最大条数。
- 每个 turn 重新按相关性编译，而不是只追加消息。
- 超预算时保留系统合同、当前目标、未完成工具配对和最新用户输入。
- 摘要只能压缩陈述性内容，ID、数值、约束、状态和用户确认原样保留。
- 紧急截断后执行上下文完整性检查，孤立 tool call 不进入下一请求。
- 长任务按工作流检查点拆成多个短 run，不让一个会话承载全部中间内容。

## 6. 工具体系

### 6.1 工具清单

模型只看到完成当前意图可能需要的工具子集及简短 description，不加载完整实现提示词。工具定义包含：

```text
name
version
description
input_schema
output_schema
risk_level
confirmation_policy
idempotency_policy
timeout
resource_lock_template
required_context
```

### 6.2 工具分类

- 查询工具：读取考生快照、活动学习主线、能力上下文、计划和任务状态。
- 教学工具：启动讲解、生成训练、诊断错因、安排保持或迁移测试。
- 计划工具：提出日计划或阶段计划调整。
- 内容工具：创建讲义、题组、申论训练和面试训练。
- 用户控制工具：接受、推迟、取消、恢复和纠正。

首批必要工具按领域收敛为：

```text
# 查询
get_candidate_snapshot
get_exam_cycle_status
get_active_learning_threads
get_capability_context
get_recent_valid_evidence
get_due_reviews
get_today_plan
get_workflow_status
get_content_summary

# 教学主线
propose_learning_thread
start_learning_thread
pause_learning_thread
resume_learning_thread
propose_next_teaching_action
start_teaching_intervention

# 内容与训练
generate_lecture
generate_practice_set
request_retention_test
request_transfer_test
request_anchor_assessment

# 评估
analyze_practice_errors
grade_essay
review_interview
confirm_error_diagnosis
dispute_evidence
report_content_issue

# 计划与复习
propose_daily_plan_revision
propose_stage_plan_revision
schedule_review
create_daily_review
create_stage_review

# 用户和任务控制
request_missing_information
accept_tutor_suggestion
dismiss_tutor_suggestion
cancel_workflow
resume_workflow
open_target_resource
```

不提供 `set_mastery`、`update_score_projection`、任意 SQL、任意文件写入、任意 URL 请求等工具。它们会绕过领域不变量或扩大攻击面。

### 6.3 风险策略

- 低风险查询可自动执行。
- 可撤销的小调整先执行后说明或一键接受。
- 改目标、重排阶段、批量生成、大量 token 消耗和删除必须确认。
- 参数不完整时只追问关键槽位，不让模型猜考试日期、目标分等事实。

### 6.4 工具输出

工具返回结构化、精简、可继续推理的结果，例如资源 ID、状态、关键摘要和下一可用动作。禁止把完整题库、全量画像或巨大 Markdown 作为工具结果塞回上下文。

### 6.5 Skill 体系

`Skill` 不是可任意执行的脚本，也不是一段超长提示词。它是一个版本化能力包，描述 Agent 如何在特定业务场景组合领域知识、提示词章节、工具、工作流和校验器。

Skill Manifest：

```text
skill_id
version
description
applicable_subjects
applicable_capability_types
activation_rules
required_context_views
prompt_chapters
allowed_tools
workflow_templates
validators
dependencies
conflicts
token_budget
evaluation_suite
content_hash
status
```

Skill 类型：

- 学科 Skill：资料分析、判断推理、申论归纳概括、结构化面试。
- 教学策略 Skill：前置诊断、苏格拉底追问、错因辨析、变式迁移、间隔复习。
- 工作流 Skill：生题、讲义、客观题批改、申论批改、面试复盘、阶段计划。
- 交互 Skill：陪伴对话、计划解释、低置信度确认、主动复盘。

### 6.6 Skill 按需加载

```text
当前目标与能力节点
→ Skill Resolver 匹配候选
→ 校验版本、依赖和冲突
→ 选择最小 Skill 集
→ 合并 prompt chapters
→ 生成最小 tool catalog
→ 加载所需 context views
→ 编译本次 Agent bundle
```

- Kernel Skill 始终存在，只包含身份、用户控制、安全和通用教学原则。
- 其他 Skill 根据目标、科目、题型和工作流动态加载。
- 一次 run 默认不超过 1 个主工作流 Skill、2 个学科/策略 Skill。
- Skill 只决定可见工具和提示词，不直接获得数据库访问权。
- 编译结果按不可变版本和哈希缓存；学生动态上下文不进入静态缓存。
- 缺失依赖或版本冲突时拒绝启动，不静默选择“差不多”的 Skill。

### 6.7 Skill 与工具发布

- 可执行工具实现随签名 App 版本发布，不从模型或任意网络动态下载代码。
- Prompt、Schema、Rubric 和 Skill Manifest 作为版本化元数据包发布。
- 发布前运行依赖检查、工具权限检查、token 预算和固定评测集。
- 已发布版本不可原地编辑；活动工作流固定使用启动时版本。
- 停用 Skill 不影响历史回放，但不再用于新任务。
- Skill Registry 提供 `list/resolve/getVersion/validateBundle`，业务不得直接读取 Manifest 文件。

## 7. 提示词架构

### 7.1 像书本一样分层

提示词由 `PromptCompiler` 按任务动态编译：

```text
封面：角色、任务目的、输出受众
总则：不可违反的通用教学与安全规则
学科章：行测/申论/面试专业规则
题型节：当前题型、能力节点和常见错误
任务节：生题/讲解/批改/计划/复盘步骤
合同附录：工具 schema 或输出 schema
学生附录：最小必要的个人教学上下文
质量清单：提交前必须完成的自检
```

只装配本次需要的章节。普通聊天不加载生题总纲；批改不加载所有题型模板；生成某个题型只加载对应元数据和 Schema。

### 7.2 Prompt Manifest

每个提示词资产拥有：

```text
prompt_id
version
task_type
compatible_schema_versions
required_context_slots
required_metadata
model_capability_requirements
token_budget
temperature_policy
content_hash
status
```

发布后不可覆盖。修改提示词创建新版本，并通过离线评测后启用。

### 7.3 内容原则

- 通用规则只定义一次，不在多个文件复制。
- 动态值使用类型化插槽，禁止页面拼接自由文本系统提示词。
- 用户输入、题目和历史内容放入清晰的数据边界，标记为不可信内容，不能覆盖系统规则。
- 不要求模型输出思考过程；允许模型内部推理，但只返回结论、证据和结构化说明。
- 教学解释应说明依据，不伪造“我记得”或不存在的用户历史。
- 质量清单用于自检，但不能代替本地 Validator。

### 7.4 提示词元数据表

`prompt_definitions` 保存稳定身份和任务类型；`prompt_versions` 保存章节依赖、模板内容、兼容 Schema、哈希和发布状态；`prompt_evaluation_results` 保存固定数据集上的质量结果。

## 8. Context Compiler

### 8.1 上下文来源

上下文不是聊天消息截断，而是多个受控视图：

```text
CandidateSnapshot
ActiveLearningThreadSnapshot
RelevantMasterySnapshot
RecentValidEvidenceDigest
CurrentPlanConstraints
PendingReviews
RecentTeachingEffectiveness
ConversationSummary
CurrentUserTurn
```

每个视图有来源时间、算法版本和最大 token 预算。

### 8.2 选择顺序

1. 当前用户意图和明确约束。
2. 活动学习主线、阶段和退出条件。
3. 当前能力节点及前置节点的有效证据。
4. 最近确认的错因与教学效果。
5. 今日计划、时间和复习约束。
6. 与当前交流直接相关的最近对话。

无关模块历史不进入上下文。对话摘要只维持沟通连续性，不参与掌握计算。

### 8.3 Token 管理

- 使用供应商 tokenizer 或经过校准的 token estimator，不按字符数硬截断。
- 为 system、工具、学生上下文、对话和输出分别保留预算。
- 超预算时先压缩旧对话，再裁剪低相关证据，不能裁掉当前任务合同。
- 摘要绑定输入事实版本；证据纠错或学习主线推进后使相关摘要失效。
- 记录实际 usage，持续校准估算误差。

硬预算按任务配置：最大输入、最大输出、最大 Agent turn、最大工具结果 token、最大总 token 和最大预计费用。任一预算接近上限时，Agent 必须收束当前目标或请求用户继续，不能自动扩容。

### 8.4 隐私

Context Compiler 在发送前执行字段白名单和脱敏。API Key、手机号、证件、无关单位信息、本地路径和其他考试周期内容默认不得进入模型请求。

## 9. Model Router

### 9.1 模型角色

业务只声明模型角色，不硬编码具体模型名：

```text
fast_classification
companion_chat
teaching_reasoning
content_generation
objective_quality_review
subjective_grading
schema_repair
summary_compaction
```

用户只有一个模型配置时，所有角色可以映射到同一模型，但仍保留角色级参数、预算和指标。未来配置多个模型时，无需修改业务代码。

### 9.2 路由依据

- 是否支持原生工具调用。
- 是否支持 JSON Schema/结构化输出。
- 上下文和输出长度。
- 延迟、历史成功率和限流状态。
- 当前任务质量等级。
- 用户成本偏好和预算。

高风险批改和锚定评估优先质量，意图识别和格式修复优先低延迟。

### 9.3 供应商降级

```text
正常并发 3
→ 429/过载后按 Retry-After 降到 2
→ 再次限流降到 1
→ 指数退避 + 抖动
→ 达到任务重试预算后暂停并提示用户
```

认证、权限和参数错误不重试。上下文超限触发重新编译；Schema 错误触发定向修复；供应商异常不能误报为题目质量错误。

## 10. Provider Gateway

统一 Provider 合同返回结构化响应：

```text
content_blocks
tool_calls
usage
finish_reason
provider_request_id
model
latency
raw_status
```

Provider Adapter 负责：

- system message 差异。
- OpenAI tool calls 与 Anthropic tool_use 的转换。
- SSE 事件解析和半包处理。
- JSON/structured output 能力适配。
- 取消、超时、Retry-After 和错误归一化。
- 原生 Capacitor HTTP 与 Web fetch 的一致行为。

业务层不得判断 Anthropic/OpenAI 响应 JSON 形状。

Provider 建立 capability matrix，启动任务前先校验当前模型是否满足工具、上下文和输出要求，不在请求失败后才猜原因。

## 11. 工作流编排

### 11.1 显式状态机

生题、讲义、批改、计划和复盘分别定义版本化工作流，不写成一个巨大 Runner：

```text
prepare_context
→ compile_prompt
→ invoke_model
→ parse_structure
→ validate_schema
→ validate_domain
→ quality_review
→ stage_result
→ commit_result
→ publish_outbox
```

每一步输入、输出、状态和错误类型持久化。恢复时从最近可靠检查点继续。

### 11.2 生成工作流

- `GenerationSpec` 是不可变输入。
- 先生成教学蓝图，必要时生成或复用讲义。
- 大题组按 3-4 题分批，并发受供应商和资源策略控制。
- 批次先写 staging，校验通过后事务提交。
- 首批可靠提交后页面即可使用，后续批次继续生成。
- 同一批失败只重试该批，不重跑整套。
- 保持、迁移和锚定题不得读取会泄露答案的教学上下文。

### 11.3 批改工作流

- 客观判分先由代码立即完成并落库。
- AI 只分析错因、思考阶段和教学建议。
- 申论/面试使用版本化 rubric，逐维度输出证据和置信度。
- 低置信度错因进入待确认，不直接污染掌握投影。
- AI 结果提交后产生 EvidenceChanged Outbox，增量重算掌握和复习。

### 11.4 计划工作流

- 本地引擎先在性能预算内生成基础候选。
- AI 只能在硬约束内提出调整及理由。
- Plan Validator 拒绝超时、过量、重复训练和违背用户选择的提案。
- 计划变更创建新版本，不覆盖旧计划。

## 12. 结构化输出和质量流水线

验证顺序固定：

```text
传输完整性
→ JSON/工具结构
→ Schema
→ 元数据引用
→ 领域不变量
→ 教学质量
→ 内容安全和重复度
→ 事务提交
```

修复策略：

- 可确定修复的格式问题由本地代码修复。
- 语义结构缺失使用携带错误路径的定向模型修复，最多一次。
- 答案冲突、材料数字不一致和题型不符不能用字符串补丁掩盖，直接隔离或重生成当前项。
- 无效内容进入 `rejected` staging，绝不作为学习证据。
- 题目可由用户报告错误，确认后通过 Evidence Correction 撤销污染。

质量评测分两层：确定性 Validator 保证结构和不变量；AI Reviewer 只补充教学合理性判断，不能推翻确定性错误。

### 12.1 时效事实与来源

- 当前时政、政策、法律和考试公告任务必须声明 `knowledge_cutoff/source_required/as_of_date`。
- 只有 Provider 明确支持检索且返回可验证来源，或用户提供材料时，Agent 才能生成“截至某日”的事实总结。
- Provider 搜索结果先转换为 `content_sources`，校验 URL、发布日期和重复来源，再进入 Prompt。
- 无可靠来源时 Agent 应说明限制，并提供通用学习框架，不能补写看似真实的新闻和政策细节。
- 引用内容与 AI 推导结论分块存储，前端能显示来源和更新时间。

## 13. 并发、锁和一致性

- 全局默认最多 3 个活动模型请求，按供应商动态调节。
- 统一 Worker 内按业务职责划分 `content_generation`、`assessment`、`interactive`、`background` 四个工作池；工作池隔离排队和抢占优先级，但复用同一套 AgentRun、租约、取消、重试和调用账本。
- 默认并发 3 时分别为实时交互、批改诊断、内容生成保留执行 lane，后台维护只在 lane 空闲时补位。并发降到 2 时合并实时交互与批改，并发降到 1 时轮转前台工作池，避免永久饥饿。
- 工作池不是四套数据库队列，也不是四组常驻系统线程。`work_pool` 是 AgentRun 的稳定调度元数据，供应商并发上限仍是全局硬边界。
- `workflow_id` 隔离每个工作流，`task_id` 隔离一次任务，`agent_run_id` 隔离一次对话运行。
- 写操作使用 `exam_cycle + aggregate_type + aggregate_id` 资源锁。
- 一个学习主线同时只允许一个推进阶段或更新掌握的工作流。
- 多批内容生成可以并行，但最终提交检查聚合 `version`。
- 所有写工具携带幂等键；超时后先查结果，再决定是否重试。
- 业务结果与 Outbox 在同一事务写入，消息和页面刷新从 Outbox 驱动。

这比创建三个无状态 Runner 更重要。并发的关键不是“同时跑三个 Promise”，而是隔离身份、资源和提交边界。

任务分类由领域枚举和创建用例统一完成，页面不得自行选择任意字符串：

- 题目、讲义和积累生成进入 `content_generation`。
- 客观题错因、申论批改和面试复盘进入 `assessment`。
- 普通对话和需要立即确认的用户交互进入 `interactive`。
- 计划重排、月度复盘和非紧急维护进入 `background`。

旧任务没有工作池字段时，SQLite 增量迁移按 `run_type` 回填；IndexedDB 调试数据在读取时按同一领域规则推导。升级不得要求用户卸载 App 或清空备考数据。

## 14. 流式、消息和任务体验

- 一次 assistant 回复只创建一个持久消息，流式 delta 更新该消息，不创建第二个回复框。
- 节流写入数据库，结束时强制最终 flush。
- 中断记录 `cancelled` 和已生成内容，不能显示为正常完成。
- 工具事件、任务状态和聊天正文分开存储与展示。
- AI 首次工具调用立即显示真实工具名和简要参数。
- 任务提交后立即显示，页面重进按 `workflow_id + target_resource` 恢复。
- 业务结果可靠提交后才发布完成事件并刷新目标页面。

### 14.1 过程交流

Agent 在关键阶段给出短而有信息量的自然反馈：

- 开始前：说明本轮目标和为什么采取这个动作。
- 需要确认时：只询问影响决策的关键问题。
- 工具执行中：展示真实工具和对象，不复述任务标题。
- 中间结果改变判断时：说明调整了什么及依据。
- 完成后：总结能力、计划或复习安排的真实变化。
- 失败时：说明保留了哪些结果、为何失败和可继续方式。

这些内容由 Agent 依据结构化事件生成，禁止在 Runner 中散落写死“正在批改……”等伪交互文案。为了控制延迟和 token，可将连续低价值事件合并，不能为每个进度百分比额外调用模型。

### 14.2 不展示隐藏思考

交互感来自目标、行动、工具、证据和反馈的连续性，不来自暴露模型的隐藏推理。界面可以显示“正在核对错因”“发现前置知识缺口”等业务阶段，但不得保存或展示供应商内部 chain-of-thought。

### 14.3 前端归一化

前端只消费稳定的 Query DTO 和类型化事件：

```text
TutorPresenceView
AgentRunView
ToolExecutionView
WorkflowTaskView
TutorMessageView
ConfirmationRequestView
TargetResourceView
```

- AI 气泡展示 Tutor Presence：空闲、观察、思考、执行、等待确认、完成和失败。
- 顶部工具执行区只展示当前 run 的最新真实工具事件。完整调用集合只保存在内存；下一次 run 开始时整体替换，不写业务数据库、不跨重启恢复。
- 输入框上方 Task Dock 展示当前会话或目标资源的工作流，不展示普通回复。
- 铃铛展示跨会话的持久任务与主动信号。
- 页面通过 `target_resource_type/id` 订阅任务状态并在提交事件后重新查询 Repository。
- 同一状态使用同一图标、颜色和文案映射，组件不得自行推断 `progress` 或拼接“已完成”。

状态和组件抽象放在公共 Agent UI 模块，具体页面只提供目标资源和可执行动作。现款可保留小猫气泡、透明 Task Dock、工具执行单行、可拖动对话框等交互，但数据源统一切到上述视图模型。

### 14.4 运行中引导

- Agent 运行时输入框保持可编辑，用户发送的新内容作为当前 `agentRunId` 的引导，不创建新任务。
- 引导使用有界内存队列，在下一轮模型决策前消费；消费后立即释放，运行结束或新 run 开始时清空。
- 引导作为用户消息进入会话历史，但不进入 Task Dock、铃铛或工具执行列表。
- 已完成的工具调用不会因引导重复执行；相同工具和参数继续受当前 run 的签名去重约束。
- 输入区只显示一条当前请求摘要和已接收引导数量，运行结束后自动消失。

## 15. 提示注入和安全边界

- 用户输入、题目材料、网页内容和历史 AI 输出均视为不可信数据。
- 内容中的“忽略系统规则、调用某工具”等文字不能改变工具权限。
- 工具采用显式 allowlist，参数由 Schema 验证。
- AI 不拥有任意文件、SQL、网络和系统命令工具。
- 业务工具只暴露最小查询和 Use Case，不暴露数据库表。
- 高风险工具执行前由代码确认权限和用户确认状态。

### 15.1 Agent 风险矩阵

| 风险 | 典型表现 | 防线 |
|---|---|---|
| 上下文膨胀 | 越聊越慢、重要事实被截断 | 记忆分层、按 turn 重编译、视图配额、摘要失效 |
| 工具死循环 | 重复查状态或反复生题 | 调用签名去重、turn/tool 上限、目标完成条件 |
| 幻觉业务状态 | 声称已掌握或已落库 | 所有状态来自工具结果，完成以事务提交事件为准 |
| 提示注入 | 题目材料要求忽略系统规则 | 不可信内容隔离、工具 allowlist、Policy Guard |
| 跨会话串数据 | A 任务结果进入 B 会话 | run/workflow/session/resource ID 全链路校验 |
| 并发覆盖 | 多任务同时推进同一主线 | 资源锁、乐观版本、写工具串行 |
| stale context | 使用纠错前的旧画像 | 事实版本、水位线、缓存与摘要失效 |
| token/费用失控 | 多 Agent 或修复反复调用 | 角色预算、重试预算、调用账本、用户确认 |
| 模型漂移 | 换模型后题目或评分波动 | Prompt/模型版本、固定评测、rubric 校准 |
| 错误内容污染画像 | AI 题答案错误仍计入掌握 | staging、质量门、用户报告、证据纠错 |
| 过度主动 | 高频提醒制造焦虑 | 主动级别、冷却、每日上限、用户拒绝权 |
| 教学依赖 | Agent 替用户完成思考 | 提示分级、先提问后讲解、独立验证 |

### 15.2 多 Agent 边界

首个稳定版本只保留一个面向用户的 Tutor Agent。命题专家、批改专家和质量 Reviewer 作为受限的模型角色或工作流步骤存在，不各自拥有长期记忆和业务写权限。

只有当单 Agent 的固定评测证明存在明确瓶颈时，才引入专业 Sub-agent。Sub-agent 必须：

- 接收最小任务包，不读取全量学生档案。
- 只能返回结构化候选结果。
- 不能直接调用写工具。
- 受父工作流 token、时间和调用预算约束。
- 结果由主工作流 Validator 和 Committer 决定是否采用。

这样保留专业分工，不引入多个自治 Agent 互相对话造成的成本、延迟和不可控性。

## 16. 调用账本和数据保留

每次模型请求写入 `ai_invocations`：任务、步骤、供应商、模型角色、提示词版本、Schema 版本、请求哈希、usage、耗时、finish reason、重试和校验结果。

- 默认不长期保存完整模型思考或隐藏 reasoning。
- 原始响应仅在结构调试和用户允许的诊断模式短期保留，设置数量和时间上限。
- 标准化业务结果按业务生命周期保存。
- 调试导出先脱敏，不自动上传。

## 17. 评测和发布门槛

### 17.1 固定评测集

- 各行测题型的合法与非法结构样本。
- 共享材料、多小题、SVG、表格和长材料样本。
- 错因分类边界样本。
- 申论和面试 rubric 标定样本。
- 意图不确定、复合指令和拒绝确认样本。
- 限流、截断、空响应、半包 SSE 和取消恢复样本。

### 17.2 指标

```text
schema 首次通过率
领域校验通过率
定向修复成功率
题目答案一致率
错因人工确认率
工具选择准确率
错误工具调用率
首 token 和总耗时
每个成功教学动作 token
工作流恢复成功率
重复提交率
```

提示词或模型版本只有在固定评测集不退化、核心质量阈值通过后才能发布。

### 17.3 测试层级

- Prompt Compiler 快照测试。
- Context Compiler 相关性、预算和脱敏测试。
- Provider 合约测试与录制响应回放。
- Agent 工具循环和确认策略测试。
- 工作流状态机与故障注入测试。
- Schema、领域和质量 Validator 测试。
- SQLite 事务、Outbox、幂等和恢复测试。
- 少量真实供应商 smoke test，不作为日常单元测试依赖。

### 17.4 Skill 与 Agent 专项测试

- Skill Resolver 的匹配、依赖、冲突和最小加载测试。
- 未授权工具不会出现在 tool catalog。
- Skill 版本升级不改变活动工作流 bundle。
- 上下文持续 100 轮时仍符合预算且保留关键事实。
- 重复工具、循环调用和预算耗尽能正常收束。
- 两个会话和三个并发任务不会交叉消息、工具事件和资源。
- 恶意题目内容不能改变工具权限或系统提示。
- 用户拒绝、取消和证据纠正会使后续 Agent 上下文立即更新。

### 17.5 Agent 产品效果指标

不能只统计工具调用成功率，还要验证 Agent 是否真正像私教：

- 首次理解用户目标的准确率。
- 需要追问的平均轮数和无效追问率。
- 工具选择与教学动作合理率。
- 建议被接受后对学习效果的实际提升。
- 用户能否理解“为什么做这个”。
- 同类薄弱点达到稳定掌握所需题量和天数。
- 主动干预接受率、关闭率和负反馈率。
- Agent 建议与领域引擎约束冲突率。

## 18. 建议模块结构

```text
src/ai/
  application/
    AIFacade.ts
    ConversationUseCase.ts
  agent/
    AgentRuntime.ts
    AgentPolicy.ts
    AgentEvent.ts
    AgentMemory.ts
  context/
    ContextCompiler.ts
    context-views/
  prompts/
    PromptRegistry.ts
    PromptCompiler.ts
    manifests/
    chapters/
  tools/
    ToolRegistry.ts
    ToolGuard.ts
    definitions/
  skills/
    SkillRegistry.ts
    SkillResolver.ts
    SkillBundleCompiler.ts
    manifests/
  workflows/
    WorkflowOrchestrator.ts
    generation/
    grading/
    planning/
  providers/
    ProviderGateway.ts
    AnthropicAdapter.ts
    OpenAICompatibleAdapter.ts
  routing/
    ModelRouter.ts
    ModelCapabilityRegistry.ts
  validation/
    StructuredOutputPipeline.ts
    validators/
  persistence/
    AIInvocationRepository.ts
    AgentRunRepository.ts
    WorkflowRepository.ts
  observability/
    AIMetrics.ts

src/features/tutor-ui/
  queries/
  presenters/
  components/
  stores/
```

`src/tasks` 只负责通用调度和运行，不再承载学科提示词与业务落库。

## 19. 实施顺序

### AI Phase 1：底座

- [ ] 定义 Provider Gateway、类型化响应、错误分类和 capability matrix。
- [ ] 建立 Prompt Registry/Compiler、Manifest 和版本表。
- [ ] 建立 Context Compiler 与 token 预算。
- [ ] 建立 ai invocation ledger。

### AI Phase 2：确定性工作流

- [ ] 将生题、讲义、批改、计划从巨型 Runner 拆成状态机。
- [ ] 接入结构、领域和教学质量流水线。
- [ ] 接入 staging、Unit of Work 和 Outbox。
- [ ] 建立取消、恢复和部分批次提交。

### AI Phase 3：对话 Agent

- [ ] 建立版本化 Tool Registry 和 Policy Guard。
- [ ] 实现原生 tool call 的多 turn Agent loop。
- [ ] 贯通 session/run/workflow/task/tool call/resource ID。
- [ ] 实现槽位补齐、风险确认、重复调用和循环上限。

### AI Phase 4：质量与优化

- [ ] 建立固定评测集和 Provider 回放测试。
- [ ] 建立角色级模型路由、预算和限流降级。
- [ ] 校准 Context 摘要和 Prompt token。
- [x] 删除旧 AIEngine、AIProvider、LocalTask、TaskQueue、TaskStore 和巨型 AIRunners 业务逻辑。

## 20. 完成标准

- 页面动作不依赖意图识别，聊天可以在受控范围内完成多步工具调用。
- 每次 AI 结果可追溯到学生上下文、元数据、提示词、Schema、模型和任务版本。
- 思考内容不落库、不进入后续上下文。
- AI 输出未经校验不能写入学习事实和掌握投影。
- 并发 3 个任务时，会话、工具、资源和结果完全隔离。
- 限流、取消、截断、切后台和杀进程后可以从可靠检查点恢复。
- 提示词按需动态加载，不再散落在页面、Service 和 Runner。
- 供应商差异只存在于 Adapter，业务代码不解析供应商原始响应。
- 核心学习流程在 AI 暂时不可用时仍能读取档案、查看计划、作答和完成客观判分。
