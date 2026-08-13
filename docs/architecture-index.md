# Civil AI Architecture Documentation / 架构文档索引

This directory contains long-lived product, architecture, and engineering contracts for contributors. Implementation checklists, handoff notes, raw security reports, and temporary release snapshots remain outside the public architecture set.

本目录只保存对贡献者长期有效的产品、架构和工程合同。实施路线图、交接记录、阶段清单、原始安全审计报告和临时发布快照属于内部项目管理资料，不进入公开架构文档集。

Civil AI has two explicit layers: a reusable adaptive tutoring agent foundation and a civil-service exam reference application. Agent execution, learning evidence, mastery, planning, structured content, rendering, and local persistence belong to the foundation; exam curricula, question policies, rubrics, and candidate workflows belong to the reference domain.

Civil AI 明确分为两层：可复用的自适应教育 Agent 基础层，以及公考参考应用。Agent 执行、学习证据、掌握度、计划、结构化内容、渲染和本地持久化属于基础层；考试大纲、题型策略、评分规则和考生工作流属于参考领域。

## Reuse maturity / 复用成熟度

- The Agent loop, provider gateway, Tool/Skill registries, content rendering, and Web research have the clearest portable boundaries today.
- Learning evidence, mastery, planning, task recovery, and persistence are foundation-oriented contracts, but their current implementations still contain exam-domain identifiers and are not published as standalone framework packages.
- A second learning-domain adapter is required before claiming domain-neutral validation. Until then, documentation must say "foundation" or "reference implementation", not "universal education platform".

中文说明：

- Agent loop、Provider Gateway、Tool/Skill Registry、内容渲染和 Web Research 是当前边界最清晰的可移植能力。
- 学习证据、掌握度、计划、任务恢复和持久化采用基础层导向的合同，但当前实现仍包含考试领域标识，尚未作为独立框架包发布。
- 在第二教育领域适配完成前，只能表述为“基础实现”或“参考实现”，不能宣称已经完成跨领域通用验证。

## Document precedence / 文档优先级

```text
1. architecture-constitution.md
2. core-business-architecture.md / ai-service-architecture.md
3. 专项架构设计与 ADR
4. modular-architecture-standard.md / coding-quality-standard.md
```

When documents conflict, use the precedence above. An ADR is authoritative for the decision it explicitly covers.

发生冲突时按以上优先级处理。ADR 对其明确覆盖的决策具有最终解释权。

## Product and domain architecture / 产品与业务架构

| Document / 文档 | Purpose / 作用 |
|---|---|
| [Architecture constitution / 架构宪法](./architecture-constitution.md) | Product purpose, AI/deterministic-code boundaries, data principles, and non-negotiable constraints / 产品定位、AI 与确定性代码边界、数据原则和工程约束 |
| [Core tutoring business architecture / 教育 Agent 核心业务模块架构](./core-business-architecture.md) | Ownership, interfaces, and events for content, messaging, and capability analysis / 内容生成、消息中心、能力分析的数据所有权、接口和事件 |
| [Adaptive tutoring Agent service architecture / 自适应教育 Agent 服务架构](./ai-service-architecture.md) | Tutor Agent, Skills, Tools, Prompts, Context, Memory, Providers, and Workflows / 教育 Agent 及其运行子系统 |

## Architecture decisions and focused designs / 专项架构与决策

| Document / 文档 | Purpose / 作用 |
|---|---|
| [ADR-001: Provider-neutral Agent Runtime / 供应商无关 Agent Runtime](./adr-001-provider-neutral-agent-runtime.md) | Boundaries among the Agent kernel, Providers, Tools, Context, Memory, sub-agents, and Tasks / Agent 运行边界 |
| [ADR-002: Pi Agent Core loop engine / Pi Agent Core 循环引擎](./adr-002-pi-agent-core-loop-engine.md) | Loop-engine choice, adapter boundary, and fallback policy / 循环引擎选型、适配与回退边界 |
| [Frontend design system and templates / 前端设计系统与业务模板](./frontend-design-system-architecture.md) | Tokens, layout, overlays, forms, domain components, and question templates / 前端公共设计与题目模板 |
| [Content and Markdown rendering / 内容与 Markdown 渲染](./content-rendering-architecture.md) | Markdown, tables, formulas, SVG, content blocks, and renderer contracts / 内容块与渲染合同 |

## Engineering standards / 工程标准

| Document / 文档 | Purpose / 作用 |
|---|---|
| [Modular architecture standard / 模块化分层与组合标准](./modular-architecture-standard.md) | Module boundaries, layers, contracts, registries, and composition rules / 模块边界与装配规则 |
| [Coding quality standard / 编码质量规范](./coding-quality-standard.md) | TypeScript, Vue, SQL, async, error, security, and test conventions / 编码、安全和测试规范 |

## Stable engineering decisions / 稳定工程决策

- Portable runtime capabilities do not depend on civil-service vocabulary or policies. Foundation-oriented domain contracts progressively isolate remaining exam identifiers behind explicit contracts, registries, fixtures, and composition roots.
- The product is a Vue 3 and TypeScript local-first modular monolith packaged with Capacitor; iOS is the primary physical-device platform.
- SQLite is the iOS source of truth. IndexedDB implements the same repository contracts for browser development.
- Users select model providers. The local Tutor Agent invokes models and tools within application-owned policy and budgets.
- Exam cycles, capability graphs, learning evidence, learning threads, and independent mastery verification organize the domain.
- UI state is never authoritative. Pages reload durable facts through Query/Application Services.
- Questions, lectures, explanations, and error diagnoses use versioned content blocks and rendering templates rather than Markdown files as business records.

中文摘要：

- 可移植运行时能力不得依赖公考术语或策略；基础层导向的领域合同应逐步把现存考试标识隔离到明确合同、Registry、Fixture 和 Composition Root 后方。
- 平台采用 Vue 3、TypeScript 和 Capacitor，iOS 是首要真机平台。
- iOS 使用 SQLite 作为业务真相源；Web 使用实现同一 Repository 合同的 IndexedDB 适配器。
- 产品采用本地优先模块化单体，不要求自建云服务。
- 用户配置模型供应商，本地 Tutor Agent 在策略和预算约束内调用模型与工具。
- 业务围绕考试周期、能力图谱、学习证据、学习主线和独立掌握验证组织。
- 页面状态不是业务真相源；重新进入页面时通过 Query/Application Service 读取持久化事实。
- 题目、讲义、解析和错因使用版本化内容块与渲染模板，不以 Markdown 文件作为业务数据结构。

## Public documentation boundary / 公开文档边界

- Release notes belong in GitHub Releases; executable work belongs in Issues and Pull Requests.
- Undisclosed vulnerabilities must follow [`SECURITY.md`](../SECURITY.md), not public Issues.
- Internal roadmaps, AI handoff material, completion snapshots, and local test records remain private.
- Architecture changes update an existing contract or introduce an ADR; temporary task lists do not belong here.

中文约定：

- 发布说明保存在 GitHub Releases。
- 可执行工作由 GitHub Issues 和 Pull Requests 跟踪。
- 未公开安全问题通过 [安全策略](../SECURITY.md) 报告，不提交原始漏洞报告。
- 内部路线图、AI 交接材料、阶段完成度和本地测试记录保存在私有工作区。
- 架构发生变化时更新对应文档或新增 ADR，不把临时执行清单写入架构文档。
