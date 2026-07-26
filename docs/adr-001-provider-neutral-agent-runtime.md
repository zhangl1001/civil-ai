# ADR-001：供应商无关的本地 Tutor Agent Runtime

> 状态：accepted，分阶段实施  
> 日期：2026-07-25  
> 适用范围：AI 对话、主动私教、工具调用、上下文、记忆、子 Agent、模型供应商适配

## 1. 背景

当前系统同时存在确定性生成工作流、普通聊天、规则/模型意图分类和 AgentRun 队列。供应商网关已经能调用模型，但业务仍可能把模型协议、工具识别、上下文拼装和业务执行混在同一 Service 中。

这会产生三个问题：

- Anthropic、OpenAI Compatible 和未来 Gemini 的协议差异泄漏到业务层。
- “有任务队列”被误认为“有 Agent”，实际缺少模型与工具的多轮闭环。
- 聊天摘要、学习事实、工具结果和业务任务互相混用，造成上下文膨胀、串会话和不可恢复。

## 2. 决策

采用本地、Headless、供应商无关的 Tutor Agent Runtime。借鉴成熟 Agent 系统的 Agent loop、tools、sessions/memory、guardrails、handoff/as-tool、trace/event 和 context management 原语，但不引入对特定云端 Agent SDK 的运行时依赖。

核心依赖方向固定为：

```text
UI / Page Command
       |
Agent Application Facade
       |
Agent Runtime Kernel
  | Context | Memory | Skill | Sub-agent | Tool Policy | Events
       |
Model Runtime Port                 Application Tool Port
       |                                  |
Provider Gateway                  领域 Application Use Case
       |                                  |
OpenAI / Anthropic / Gemini       SQLite + Unit of Work + Outbox
```

Provider 不能导入 Agent、业务模块或 Repository。Agent Kernel 不能导入 Vue、Capacitor、SQLite、具体供应商和具体业务 Service。

## 3. 子系统与职能边界

### 3.1 Agent Application Facade

负责创建、取消、恢复和确认一次 Agent run；绑定 `agent_run_id/session_id/exam_cycle_id/learning_thread_id/target_resource`。它不组装供应商请求，也不直接执行 SQL。

页面参数明确的生题、批改和计划继续走确定性工作流。自然语言需要理解、补参数或多步决策时才进入 Agent loop。

### 3.2 Agent Runtime Kernel

负责受限循环：

```text
编译本轮上下文
→ 请求模型
→ 接收文本或工具调用
→ Policy Guard
→ 执行工具
→ 工具结果回送模型
→ 继续或完成
```

默认上限为 8 个模型 turn、12 次工具调用、单 turn 4 次工具调用。相同工具与相同参数只允许执行一次。每轮保存检查点，取消和切后台后不依赖内存数组恢复。

### 3.3 Model Runtime 与 Provider Gateway

`ProviderGateway` 是唯一供应商边界，统一：

- `ModelMessage`
- `ModelToolCall`
- `ProviderToolDefinition`
- 文本、工具调用、usage、finish reason 和 request id
- 认证、限流、超时、取消和错误分类

OpenAI 适配 `/chat/completions + function tools`；Anthropic 适配 `/messages + tool_use/input_schema`；Gemini 以后新增 `GeminiGateway`，只负责 Gemini content/parts/functionCall 的翻译。

供应商由用户选择的协议字段决定，禁止根据模型名称猜协议。OpenAI-compatible 中使用 Claude 模型仍走 OpenAI 协议；Anthropic 原生端点只走 Anthropic 协议。

结构化输出降级必须由协议能力和标准化错误驱动：Gateway 先尝试协议原生工具调用，只有收到归一化的 `InvalidRequest` 才回退到严格 JSON 提示词模式。供应商名称、模型名称和业务入口不得参与生题策略、任务调度或降级判断。个别兼容端点的字段修正只能留在 Provider Adapter，并且必须同时通过同协议的通用合约测试，不能演变成供应商专属业务链路。

### 3.4 Tool Platform

Tool 分为 Metadata、Policy 和 Executor 三部分：

```text
Tool Definition：名称、版本、description、输入/输出 Schema、风险、确认策略、预算
Tool Policy：allow / confirm / reject、资源权限和消费预算
Tool Executor：只调用已注册的 Application Use Case
```

模型只接收当前 Skill 解析出的最小工具集合和 description，不接收实现提示词。禁止暴露任意 SQL、任意文件写入、任意网络请求和直接修改掌握度的工具。

工具事件和业务任务是两种对象：工具事件描述 Agent 正在做什么；任务描述可恢复的工作流状态。UI 可以关联显示，但不能合并存储或根据标题猜状态。

### 3.5 Context System

Context Source 负责读取独立视图，Context Compiler 负责相关性、预算、脱敏和完整性：

```text
当前目标与用户输入（必须）
活动学习主线与退出条件（必须）
相关能力、有效证据和确认错因
今日计划、到期复习和时间约束
会话摘要与少量最近对话
```

每个 turn 重新编译，不无限追加。工具结果默认只回送摘要、稳定资源 ID 和下一可用动作；完整内容留在数据库。思考内容、隐藏 reasoning 和旧的失败输出不进入上下文。

### 3.6 Memory System

记忆分为五层，各层有独立所有者和生命周期：

| 层 | 内容 | 真相源 |
|---|---|---|
| working | 当前目标、未完成调用、临时参数 | AgentRun checkpoint，完成后丢弃或压缩 |
| session | 已确认交流目标、必要对话摘要 | Agent Workspace 文件日志，删除会话时删除 |
| episodic | 某条学习主线的教学动作及效果 | Learning thread/event |
| semantic | 目标、能力、确认错因、有效偏好 | 领域事实与投影 |
| prospective | 待复习、计划、提醒、未完成承诺 | Plan/review/signal |

Memory Repository 只在 Agent Workspace 文件日志中保存可丢弃的结构化结论和来源引用，不进入业务 SQLite/IndexedDB。删除会话必须删除消息、摘要和该会话作用域的 working/session memory，但不删除已经由领域用例确认并落库的学习事实；事实纠正通过版本/失效机制使旧摘要失效。

### 3.7 Skill System

Skill 是版本化教学能力包，包含适用场景、提示词章节、上下文视图、允许工具、Validator 和预算。Kernel Skill 常驻，其他 Skill 按目标动态加载。

一次 run 默认最多加载一个主工作流 Skill 和两个学科/策略 Skill。Skill 不能持有 Executor 或数据库连接。

### 3.8 Sub-agent System

首版只有一个面向用户的 Tutor Agent。专业能力使用两种受限委派：

- `as_tool`：默认方式。专家返回结构化候选，控制权始终在 Tutor Agent。
- `handoff`：只有需要专家连续接管用户对话时使用，必须显式过滤上下文。

命题、质量审查、申论批改、面试点评等 Sub-agent 不拥有独立长期学生记忆，不能直接调用写工具，不能访问全量档案。它们复用同一个 Agent Runtime 和 ProviderGateway，仅替换 instructions、skills、tools 和预算。

### 3.9 Workflow / Task System

Agent 决策与业务工作流分离。Agent 可创建或查询 workflow，但生题、批改、计划、证据提交仍由显式状态机负责。Agent 完成不等于业务结果已提交；只有事务提交和 Outbox 事件能标记业务完成。

### 3.10 Event / Trace System

统一记录 run、model invocation、tool call、confirmation、checkpoint 和 commit 事件。默认不上传云端 trace，不保存隐藏思考和敏感原文。调试视图通过本地事件重建，消息中心消费稳定 View DTO。

## 4. 数据边界

Agent 数据按所有权分离：

```text
业务 SQLite/IndexedDB：
  tutor_agent_runs / events / invocations
  domain_outbox / command_receipts

Agent Workspace 文件日志：
  conversation sessions / messages / summaries
  working and session memory

进程内有界状态：
  当前 run 的 tool activity / stream delta / 用户引导
```

学习能力、证据、计划和内容继续由各自领域表拥有。Agent memory 只能引用这些事实，不能复制一份可冲突的“AI 画像真相”。工具执行明细在下一次 run 开始时整体替换，不持久化为无限增长的历史。

结构化工作流运行数据索引至少覆盖：

- `agent_run_id + sequence`
- `status + lease_expires_at`
- `target_resource_type + target_resource_id + status`

## 5. 性能与成本

- 普通聊天不必先调用独立意图分类模型；Tutor Agent 可直接使用最小只读工具集。
- 页面确定性动作不进入开放循环，减少一次分类调用。
- Tool/Skill 按需解析，避免每轮发送全部 Schema。
- 工具结果摘要和上下文预算控制输入 token。
- 最多三个独立 AgentRun 并发；单个 run 内写工具默认串行。
- Provider 429 后由 worker 降并发和退避，Agent loop 不自行无限重试。

## 6. 风险与防线

| 风险 | 防线 |
|---|---|
| 工具死循环 | 签名去重、turn/tool 上限、检查点 |
| 串会话/串任务 | 全链路 ID、Repository 查询不使用“最近任务” |
| 提示注入 | 不可信内容分区、工具 allowlist、Policy Guard |
| 上下文膨胀 | 每 turn 编译、五层记忆、工具结果摘要 |
| AI 篡改业务事实 | 工具只到 Application Use Case，事务与 Validator 最终裁决 |
| 子 Agent 成本失控 | 父预算、最小上下文、禁止自治互聊 |
| 供应商耦合 | ProviderGateway 统一合同和合约测试 |
| 切后台丢状态 | SQLite checkpoint、lease 恢复、幂等工具 |

## 7. 实施状态

截至 2026-07-25：

- done：OpenAI/Anthropic 双协议 Gateway，供应商无关工具调用响应。
- done：受限 `RunAgentLoop`、重复调用防线、确认停点、检查点 Port、类型化事件。
- done：Context Budgeter、五层 Memory Port、Skill/Tool Registry、Sub-agent Registry。
- done：会话、摘要和 Agent memory 已切到统一 `AgentWorkspaceStorage` 文件日志；SQLite/IndexedDB 会话表与 Repository 已删除。
- done：工具调用展示采用当前 run 的有界内存快照，下一次 run 整体覆盖，不持久化。
- pending：将 AIChatStore/AICommandRouter 切到统一 Tutor Agent loop。
- pending：Application Tool Executor、Policy Guard 和现有业务 Use Case 的正式装配。
- pending：Context Source/Compiler 读取真实学习主线、证据、计划和会话摘要。
- pending：专业 Sub-agent 的首个端到端委派和固定评测。

“done”只表示有运行实现和自动验证；只有接入 composition root 并通过真机链路后才算对应产品功能完成。

## 8. 验证

- Provider 合约：OpenAI function call、Anthropic tool_use、结构化结果、错误归一化和兼容降级。
- Agent loop：工具回送、多轮完成、确认停点、重复调用、预算耗尽和取消。
- Context：必需章节不丢失、低优先级裁剪、敏感字段不进入请求。
- Memory：层级查询、失效、纠错和考试周期隔离。
- Sub-agent：上下文过滤、工具限制、父预算和结果 Validator。
- 恢复：切后台、杀进程、429、工具超时和重复点击。

## 9. 退出条件

如果未来引入成熟的供应商无关 Agent SDK，只有在它能满足本地 SQLite 检查点、双供应商、自定义 Context/Memory、领域工具 Policy、离线可用和隐私要求时，才可替换 Runtime Kernel。Provider、业务 Use Case、数据表和 View DTO 边界保持不变。
