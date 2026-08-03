# ADR-002: Pi Agent Core 作为通用 Agent Loop Engine

> 状态：试运行  
> 分支：`feature/pi-agent-core-runtime`  
> 版本：`@earendil-works/pi-agent-core@0.83.0`

## 决策

使用 Pi Agent Core 承担供应商无关的多轮模型循环、工具调用迭代、流式事件和同轮工具调度。应用通过 `AgentLoopRuntime` 协议接入，默认由 `LazyPiAgentLoopRuntime` 按需加载 `PiAgentLoopRuntime`。

Pi 不直接连接业务仓储，也不接管应用的安全和可靠性控制面。

## 保留在应用层的边界

- Provider Gateway 与 Anthropic/OpenAI Compatible 协议适配。
- Tool/Skill Registry、按需激活和业务提示词章节。
- Tool JSON Schema 二次校验、资源归属校验和风险确认。
- 写工具 receipt、业务幂等键、AgentRun lease/fencing。
- Agent 执行预算、重复调用治理和只读并发上限。
- 异步资源完成状态核验，禁止把 queued/running 当 completed。
- SQLite checkpoint、崩溃恢复、统一取消和运行事件。
- 上下文编译、图片持久化剥离和业务记忆。

Pi 的工具执行器只能调用应用提供的 `AgentToolExecutor`，不能直接访问数据库或业务 Service。

## 适配方式

`PiAgentProviderStream` 把现有 `AgentModelInvoker` 转换为 Pi 的事件流，因此模型配置、流式降级、供应商兼容和网络治理保持不变。

`PiAgentMessageAdapter` 在应用消息与 Pi 消息之间转换。checkpoint 继续保存应用自己的 `ModelMessage`，不把第三方消息结构变成持久化协议。

只读工具允许并发，但受 `maxParallelReadToolCalls` 信号量约束；写工具和破坏性工具保持顺序执行。

## 回退

旧 `RunAgentLoop` 暂时保留作为行为对照。需要回退时，仅将 `CreateDurableAgentLoop` 的实现从 `LazyPiAgentLoopRuntime` 切回 `RunAgentLoop`，无需迁移数据库或 checkpoint 数据。

稳定运行并完成真机回归后，再决定是否删除旧循环。

## 验收

- `check:pi-agent-runtime`：多轮工具、并行读取、确认恢复、取消。
- `check:agent-loop`：现有 Tool/Skill、预算、完成核验等契约。
- `check:agent-runtime`：AgentRun、checkpoint 与恢复控制面。
- 完整 `npm run build`：业务、SQLite、iOS 生命周期和生产打包门禁。

