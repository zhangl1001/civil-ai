# ADR-002: Pi Agent Core as the General Agent Loop Engine / Pi Agent Core 作为通用 Agent Loop Engine

> **Status / 状态:** Accepted; default runtime with guarded fallback / 已接受；默认运行时并保留受控回退
> **Last reviewed / 最近复核:** 2026-08-11
> **Version / 版本:** `@earendil-works/pi-agent-core@0.83.0`

## English executive summary

### Summary

Pi Agent Core is the default engine for provider-neutral model iteration, streaming events, tool calls, and same-turn read-tool scheduling. Civil AI integrates it through the application-owned `AgentLoopRuntime` contract.

### Context

Maintaining a custom loop duplicated mature orchestration behavior and made long-running tool workflows harder to evolve. The application still requires local checkpoints, provider adapters, domain authorization, and mobile lifecycle recovery that a generic loop library must not own.

### Decision

Use `LazyPiAgentLoopRuntime` by default in both Web and iOS composition roots. Keep provider gateways, skills, tools, schemas, policy, leases, receipts, budgets, cancellation, completion verification, context, and memory in the application layer. Permit fallback to the legacy loop only before any visible text or tool side effect has occurred.

### Consequences

- Pi can be upgraded or replaced without changing persisted checkpoints or domain use cases.
- Third-party runtime behavior is constrained by application-owned contracts and tests.
- The legacy loop remains temporary compatibility code and must not create a second business execution path.
- Runtime upgrades require provider, recovery, cancellation, concurrency, and physical-device regression testing.

---

## 中文决策记录 / Chinese decision record

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

旧 `RunAgentLoop` 暂时保留作为行为对照和启动期受控回退。`LazyPiAgentLoopRuntime` 只有在尚未输出可见文本、尚未启动工具、未取消且不是租约丢失或 Provider 标准错误时，才允许切换到旧循环，无需迁移数据库或 checkpoint 数据。

旧循环不得成为独立业务路径。完成持续真机回归、故障注入和 Pi 升级验证后，再决定是否删除。

## 当前实施状态

- Web 与 iOS composition root 均通过 `createDurableAgentLoopFactory` 创建 `LazyPiAgentLoopRuntime`。
- AI 对话和联网真题研究共享相同的 `AgentLoopRuntime`、durable executor、checkpoint 和运行事件合同。
- Pi 不直接访问 Repository、SQLite、Capacitor 或具体业务 Service。
- 写工具执行与 durable receipt 已增加有效租约复核；业务写入同事务 fencing 仍由应用层继续完善。
- `check:pi-agent-runtime` 覆盖多轮工具、只读并发、确认恢复、取消和安全回退。

## 验收

- `check:pi-agent-runtime`：多轮工具、并行读取、确认恢复、取消。
- `check:agent-loop`：现有 Tool/Skill、预算、完成核验等契约。
- `check:agent-runtime`：AgentRun、checkpoint 与恢复控制面。
- 完整 `npm run build`：业务、SQLite、iOS 生命周期和生产打包门禁。
