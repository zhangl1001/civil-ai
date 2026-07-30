# Agent Runtime 安全与可靠性加固计划

> 状态：实施中（R0 代码止血、R1 AgentRun fencing、R2 receipt 基础、R3 结构参数校验和 R5 原生模型网络边界已完成）
> 建立日期：2026-07-30
> 输入：`G6.code-review-report.md` 及 2026-07-30 独立复核
> 目标：在不改变现有产品功能和页面入口的前提下，补齐 Agent 一致性、安全、恢复和发布门禁。

## 1. 实施原则

1. 先阻止重复执行和错误提交，再扩大 Agent 自主能力。
2. AI 负责规划和选择工具；代码负责租约、授权、参数、成本、幂等和完成状态。
3. 所有写工具必须以业务幂等键贯穿 Runtime、Tool Handler、Use Case、业务事实和 Outbox。
4. 网络、模型、文件解析和长计算不得进入数据库事务。
5. 核心事务只提交必要业务事实、幂等回执、聚合版本和对应 Outbox。
6. 不以重装 App、清库或丢弃用户数据作为恢复方案。
7. 每个阶段必须有失败测试、并发测试和回滚点，不能只验证成功路径。

## 2. 阶段与依赖

```text
R0 凭据止血
 ├── R1 Lease fencing
 │    ├── R2 写工具 receipt / 业务幂等
 │    └── R3 统一取消 / 完成验证 / Tool Validator
 ├── R4 Context / Provider / Memory
 └── R5 iOS 原生边界
       ↓
R6 真机与发布门禁
```

R1 是 R2、R3 和后台恢复测试的前置条件。R6 只能在 R1-R5 验收后开始。

## 3. R0：凭据与发布止血

### 任务

- [ ] 停止使用 `ios/App/ota/key.pem` 对应证书（需在签发端吊销）。
- [ ] 生成新证书和私钥；私钥只进入 CI Secret 或本机受控密钥目录。
- [x] 从当前版本控制中移除私钥和匹配证书，补充 `.gitignore` 与构建私钥扫描。
- [ ] 评估并处理 Git 历史中的旧私钥；记录旧证书失效时间。
- [ ] 区分 development、内部 OTA、TestFlight/App Store 三套导出配置。
- [x] Archive 脚本不再读取被 `.gitignore` 排除的唯一配置文件，development 导出配置进入版本控制。

### 验收

- `git ls-files`、Git 历史扫描和 IPA 解包均不包含新私钥。
- 干净 clone 能生成 development archive；缺少发布凭据时明确失败。
- OTA manifest 和证书版本由构建脚本生成，不再人工同步。

### 回滚

仅回滚构建配置，不恢复已经泄露的旧私钥。

## 4. R1：AgentRun 租约 fencing

### 数据与合同

- [x] 为 AgentRun 增加单调递增 `leaseEpoch`。
- [x] claim 时原子增加 epoch，并返回当前 Worker 的租约令牌。
- [x] 定义 `AgentRunLeaseToken`，Worker 写路径显式传递令牌。
- [x] SQLite 和 IndexedDB 实现同一租约合同。

### 运行时

- [x] checkpoint、progress、AgentRun transition 和对应 Outbox 写入校验当前租约。
- [x] 校验条件包含 `workerId + leaseEpoch + status=running + leaseExpiresAt>now`。
- [x] heartbeat 返回任意失败时立即 abort 对应 run，禁止继续模型和 AgentRun 状态写入。
- [ ] 业务资源最终写入与工具 receipt 在同一最小事务校验租约（随 R2 完成）。
- [ ] 恢复器只能创建新 epoch；旧 epoch 的写入统一返回稳定错误码。
- [ ] Worker 完成、失败、取消后释放租约，不能遗留 running 状态。

### 验收

- 两个 Worker 竞争同一 run，只有最新 epoch 能提交。
- Worker A 失租约、Worker B 接管后，A 的 checkpoint、工具结果和完成提交全部失败。
- 前后台暂停超过 lease 后恢复，不重复生题、不重复通知、不覆盖新状态。
- SQLite 与 IndexedDB 跑同一组 repository contract tests。

### 回滚

数据库迁移只允许向前；代码回滚必须保留并忽略新列，不能降级表结构。

## 5. R2：写工具 receipt 与业务幂等

### 数据模型

- [x] 新增持久化 `agent_tool_receipts`，唯一键为 `agentRunId + toolCallId`。
- [x] receipt 状态至少包含 `prepared/running/succeeded/failed/unknown`。
- [x] 保存工具名、参数哈希、业务幂等键、resultRef、错误码和时间戳。
- [ ] receipt 与核心业务写入、业务资源和 Outbox 在同一最小事务提交。

### 执行协议

- [x] 工具执行前先持久化 prepared receipt。
- [x] Tool Executor 强制向 Use Case 传递业务幂等键。
- [ ] 恢复时先查 receipt 和目标资源；已完成结果可以复用，unknown 的资源核验仍待补。
- [x] 只读工具不写持久化 receipt，仅保留当前 run 的有界执行轨迹。
- [ ] 为生成、研究、批改、发布和导入逐一接入幂等边界（专项练习和真题发布已接稳定键，其余待逐项收口）。

### 验收

- 在“业务已提交、checkpoint 未保存”的每个故障点强杀，恢复后资源只存在一份。
- 重复点击、重复模型 tool call、重复 Outbox 投递均返回同一业务结果。
- receipt 不保存模型思考内容和无关上下文。

## 6. R3：统一 Runtime 控制面

### ToolInvocationValidator

- [x] 在 Policy 和 Executor 之前统一执行 JSON Schema。
- [x] 强制校验 required、单一/联合类型、enum、数值与长度范围、数组边界和 `additionalProperties`。
- [x] 敏感资源工具在统一授权执行器中校验 session、examCycle 和目标资源归属；普通 branded ID 格式约束继续随各 schema 收口。
- [x] 参数验证后生成不可变参数哈希；用户确认和执行时必须一致。

### 风险与确认

- [x] 用成本、题量、联网范围、持久化影响和可撤销性构建声明式风险矩阵。
- [x] 普通有界动作允许自动执行；超出声明阈值、高成本、广域联网或不可逆动作必须确认。
- [x] 确认只针对冻结后的具体参数，不能确认 A 后执行 B。

### 完成验证

- [x] 异步写工具返回类型化 `resourceType/resourceId/expectedTerminalState`。
- [x] Completion Verifier 必须匹配同一资源；其他 task 的状态不能满足当前完成验证。
- [x] `queued/running/not_found` 只能以 delegated 结束本轮并表述为“已受理/执行中”；`failed/cancelled` 只能如实报告，均不得伪装为业务完成。
- [x] 子任务通知使用统一 `lifecycle/terminal/silent` 策略；内容补全运行和重试保持无感，只在最终终态发送一次结果。

### 取消

- [x] Chat、后台 Worker、Task Dock 和页面取消共用 `AgentRunExecutionRegistry`。
- [x] Provider、工具、分片生成和派生补全统一接收同一根 signal。
- [x] 分片首个不可恢复失败时取消 sibling，并等待全部 invocation 进入终态。
- [x] 取消后禁止继续写 assistant 消息、业务事实和完成通知。

### 验收

- 参数类型错误、越权资源、确认后参数变化均被 Runtime 拒绝。
- 用户取消后 Provider 和工具在有界时间内停止，数据库终态一致。
- Agent 不能把“任务已创建”或“正在运行”表述为“已经完成”。

## 7. R4：Context、Provider 与 Memory

### Context Compiler

- [x] 实现并装配首版生产 `AgentContextCompiler`。
- [ ] 对 system、tools、skills、memory、history、media、tool results 和 output reserve 统一预算（首轮 system/tools/memory/history/output 已接入，循环内 tool results 与 media 待收口）。
- [x] 用户文本、历史模型回复、记忆和摘要标记为低信任数据，不再拼入 system 指令。
- [ ] 只按考试周期、学习主线和当前任务加载最小证据范围。

### Provider

- [ ] Provider Adapter 维护模型 capability matrix，按模型决定是否发送 temperature、thinking 和结构化参数。
- [x] 建立单一 retry owner：有租约的后台任务由 AgentRun Worker 重试，前台直连调用才使用 Provider 本轮恢复。
- [x] 在绝对 deadline 允许时尊重完整 `Retry-After`，不再固定截断到五秒。
- [ ] 预算耗尽进入可恢复状态，不再以 failed 状态承诺“可以继续”。

### Memory

- [ ] session 删除触发物理压缩或分文件删除，不只追加 tombstone。
- [ ] 对日志设置单文件、总容量、TTL 和压缩阈值。
- [ ] Memory 只保存结构化结论、来源和置信度，不保存模型思考过程。

### 验收

- 固定提示注入语料不能改变工具权限和确认策略。
- 长会话不会超过模型上下文，关键教学证据不会被低优先级内容挤掉。
- 删除会话后，工作区和导出中不再包含该会话原文。

## 8. R5：iOS 原生能力边界

### Native HTTP / Web Research

- [x] 原生模型传输只允许公开 HTTPS 端点，不按单一模型供应商写死域名。
- [x] 拒绝 loopback、link-local、私网、保留地址和非标准端口。
- [x] DNS 解析后校验实际 IP；重定向逐跳重新校验并禁止跨主机跳转。
- [x] 限制 method、headers、并发数、请求体、累计字节、事件数、时长和缓冲队列。
- [ ] Web Research 与 Native HTTP 复用同一网络目标策略。

### 文件、OCR、工作区和语音

- [x] Base64 解码前根据编码长度拒绝明显超限文件。
- [x] PDF/OCR 按页处理并维护字符、像素和时间预算。
- [x] Agent 工作区增加 key、单行、单文件、文件数和总容量限制；当前接口整文件读取受 4 MB 单文件上限保护。
- [x] 语音成功、失败、取消、中断和进入后台统一执行幂等 teardown。
- [ ] 明确前台 stream 进入后台后的取消终态，不伪装成仍在执行。

### 验收

- 私网、DNS rebinding 和 redirect-to-private 测试全部被拒绝。
- 大文件、大图片、长流和高并发不会导致 WebView OOM 或主线程长时间阻塞。
- 语音异常和前后台切换后麦克风、AudioSession、task 和 tap 全部释放。

## 9. R6：真机与发布门禁

### 自动化

- [ ] 新增 XCTest target，覆盖 Keychain、SQLite bridge、网络策略和生命周期辅助类。
- [ ] 新增 XCUITest target，覆盖冷启动、键盘、安全区、前后台、强杀重启和核心页面。
- [ ] Archive 后自动安装并启动 simulator/真机 App，不再只解包 IPA。
- [ ] 使用本地 HTTP/SSE contract server 验证真实 Capacitor transport。
- [ ] 增加双 Worker 失租约、写工具崩溃恢复和取消竞态测试。

### App Store

- [x] 对照实际 Required Reason API 生成并校验 app-owned `PrivacyInfo.xcprivacy`。
- [ ] 同步 App Store Connect 隐私标签、模型数据说明和权限文案。
- [x] 统一 SwiftPM 声明与 lock 版本；对 SQLite 插件的上游分支约束使用可重复安装补丁。
- [ ] App Store/TestFlight export 使用独立 CI 配置；development 导出配置已进入版本控制。

### 发布门槛

- [ ] 无未关闭 P0。
- [ ] 租约、幂等、授权、取消、完成判定和网络边界相关 P1 全部关闭。
- [ ] 真机连续执行建档、生题、作答、交卷、错因、复习和恢复，无重复资产和卡死。
- [ ] 真实 OpenAI Compatible 与 Anthropic 各完成限流、取消、重试和流式回归。
- [ ] IPA 安装、冷启动、后台恢复和强杀恢复全部通过。

## 10. 推荐实施批次

| 批次 | 范围 | 可独立合并 | 主要产物 |
|---|---|---:|---|
| B1 | R0 + R1 数据合同和迁移 | 是 | `leaseEpoch`、租约 token、双 Worker 测试 |
| B2 | R1 Runtime 接线 | 是 | heartbeat abort、fenced checkpoint/transition |
| B3 | R2 receipt 与首个写工具 | 是 | receipt 表、生成工具幂等 |
| B4 | R2 其余写工具 + R3 Validator | 是 | 全工具幂等、统一参数/归属校验 |
| B5 | R3 完成验证和统一取消 | 是 | 资源终态门禁、单一 cancellation registry |
| B6 | R4 Context/Provider/Memory | 是 | Context Compiler、retry budget、日志压缩 |
| B7 | R5 iOS 原生边界 | 是 | 网络策略、资源配额、语音 teardown |
| B8 | R6 自动化和发布 | 是 | XCTest/XCUITest、IPA 启动门禁、隐私清单 |

每个批次单独提交，不与现有 Practice 页面未提交改动混合。

## 11. 进度记录

- [x] 独立复核 Claude G6 报告并完成问题定性。
- [x] 建立分阶段修复计划。
- [ ] B1：凭据止血与 Lease fencing 数据合同（代码完成，待吊销旧证书）。
- [x] B2：Lease fencing Runtime 接线。
- [ ] B3：持久化 receipt 与首个写工具。
- [ ] B4：其余写工具和 ToolInvocationValidator。
- [x] B5：统一取消与完成验证。
- [ ] B6：Context、Provider 和 Memory。
- [ ] B7：iOS 原生边界。
- [ ] B8：真机和发布门禁。

### 2026-07-30 实施记录

- [x] B1/B2：AgentRun 增加 `leaseEpoch`，checkpoint、transition、heartbeat 与恢复路径接入 fencing。
- [x] B3 基础：新增 SQLite/IndexedDB `agent_tool_receipts`，写工具执行前持久化 receipt，并向业务 Use Case 传递稳定幂等键。
- [x] B4 第一部分：统一 `AgentToolInvocationValidator` 在 Policy 和 Executor 前执行；无效参数不进入工具，作为可重试观察交给 Agent 自主修正。
- [x] B4 回归：覆盖嵌套对象、联合类型、数组、枚举、范围、未声明字段及“模型修正参数后继续执行”。
- [ ] B4 剩余：其余写工具的业务事务幂等收口；资源归属验证和确认参数冻结已完成。
- [x] B5 第一部分：异步写入与精确资源状态核验使用类型化合同；运行中任务以 delegated 结束对话，避免持续轮询和假完成。
- [x] B5 第二部分：Chat 与 Worker 共用根取消注册表，Task Dock 取消可中断 Provider、Agent loop 与工具信号。
- [x] B5 通知聚合：以统一通知模式替代 `notifyOnTerminal` 魔法布尔值；后台补全运行和重试不弹消息，终态读取最新 checkpoint 后按幂等键只投影一次。
- [x] B5 收口：Provider、工具、分片生成和派生补全共用根信号；首个不可恢复失败取消 sibling 并等待清理；生成、补全、错因和消息提交前再次检查取消状态。
- [x] B6 Provider 第一部分：消除 Worker 与 Provider 的重试叠乘，并让重试等待受根信号和绝对 deadline 约束。
- [x] B6 Context 第一部分：装配统一上下文预算器，将学生档案、记忆和摘要降为带来源标签的低信任数据消息。
- [x] B7 网络第一部分：原生模型流式传输接入公开 HTTPS/DNS/逐跳重定向校验，并增加并发、流量、事件和积压硬上限。
- [x] B7 资源第二部分：文档在 Base64 解码前限额，图片 OCR 使用像素预算和降采样；Agent 工作区接入容量配额；语音生命周期统一释放。
- [x] B8 发布第一部分：增加 App 自有 Privacy Manifest，并将 development 导出配置从被忽略的构建目录迁入版本控制。
- [x] B8 发布第二部分：SwiftPM 根声明与 Xcode lock 统一到 Capacitor 8.4.1，并通过 `postinstall` 自动修正 SQLite 插件的上游 branch 约束。
- [x] B4 第二部分：新增统一 Tool 资源授权执行器，按当前会话和考期保护题库草稿、题组、练习记录与任务；待确认调用持久化参数哈希并在恢复执行前复核。
- [x] B3 恢复增强：遗留 `running` receipt 先进入 `unknown`，再用原业务幂等键受控恢复；专项练习、模考、申论、每日积累、月报、联网真题和教学练习均贯穿稳定幂等键。
- [x] B4 风险矩阵：Tool manifest 声明成本、联网范围、持久化影响和题量阈值；Routine 动作保持自主，高成本与广域联网由 Runtime 要求参数冻结确认。
