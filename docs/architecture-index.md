# Zhangl Agent 架构与实施索引

> 状态：当前唯一入口  
> 最近复检：2026-07-25
> 产品尚未上线，新核心 clean break，不迁移旧业务数据。

## 1. 文档优先级

```text
1. architecture-constitution.md
2. ai-tutor-capability-loop-redesign-plan.md
3. 专项架构设计
4. modular-architecture-standard.md / coding-quality-standard.md
5. 拆分实施计划与 ADR
6. 已归档的 Git 历史
```

发生冲突时按优先级处理；实现不能自行选择更方便的旧方案。

## 2. 权威文档

| 文档 | 作用 | 状态 |
|---|---|---|
| [架构宪法](./architecture-constitution.md) | 不可突破的产品和工程约束 | 生效 |
| [AI 私教能力闭环重构计划](./ai-tutor-capability-loop-redesign-plan.md) | 产品、领域、数据模型和总实施路线 | 设计复检完成 |
| [核心业务模块规划](./core-business-modules-plan.md) | 内容生成、消息中心、个人能力分析的边界、接口和依赖 | 生效 |
| [AI 私教服务架构](./ai-service-architecture.md) | Tutor Agent、Skills、Tools、Prompt、Context、Provider 和 Workflow | 设计复检完成 |
| [ADR-001：供应商无关 Agent Runtime](./adr-001-provider-neutral-agent-runtime.md) | Agent 内核、Provider、Tools、Context、Memory、Sub-agent 和 Task 的硬边界 | accepted / 已实施 |
| [前端设计系统与业务模板](./frontend-design-system-architecture.md) | token、布局、弹层、表单、业务组件和题目模板 | 设计复检完成 |
| [内容与 Markdown 渲染](./content-rendering-architecture.md) | Markdown/Table/SVG/结构块与 Renderer | 设计复检完成 |
| [模块化分层与组合标准](./modular-architecture-standard.md) | 模块边界、分层、合同、Registry 和装配 | 生效 |
| [编码质量规范](./coding-quality-standard.md) | TypeScript/Vue/SQL/异步/错误/测试规范 | 生效 |
| [拆分实施计划](./implementation-roadmap.md) | 可交付工作包、依赖、验收和当前进度 | 执行中 |
| [核心底座交接](./core-foundation-handoff.md) | 当前运行入口、不变量、验证结果与下一批任务 | 生效 |
| [剩余交付任务清单](./remaining-delivery-checklist.md) | 真机验收、算法校准和发布任务 | 执行中 |

## 3. 历史资料

旧 HTML、Python Agent、FastAPI、Tauri 和渐进兼容方案已从工作树移除。需要追溯时只查 Git 历史，不再保留会误导实施的迁移文档。

## 4. 当前工程决策

- 平台：Vue 3 + TypeScript + Capacitor，iOS 为首要真机平台。
- 数据：iOS SQLite 真相源，Web IndexedDB 实现同一 Repository 合同。
- 服务：本地模块化单体，不要求自建云服务。
- AI：用户配置模型供应商，本地 Tutor Agent 受控调用。
- 数据切换：新数据库 `zhangl-agent-tutor-v2`，不打开或导入旧业务数据。
- 业务中心：考试周期、能力图谱、学习证据、学习主线和独立掌握验证。
- UI 中心：首页是计划中心，AI 是持续私教，题目与内容使用版本化模板。

## 5. 实施规则

当前执行入口：iPhone 真机恢复验收、预测分校准和复杂题型专用模板。WP0-WP4 与 WP6 已完成；WP5、WP7、WP8 已有可运行基础链路，继续做策略和模板深化。页面已通过新 runtime 完成“主线 → 生题 → 作答 → 证据 → 掌握投影 → 下一动作”；接手前先读 [核心底座交接](./core-foundation-handoff.md)。

1. 新增科目或题型必须复用已经完成的纵向闭环，不复制任务、消息或数据层。
2. 每批代码有独立验收、回滚点和文档进度。
3. 新代码只能使用新模块合同，不在旧 Service 上继续加分支。
4. 旧代码在对应新切片验收后删除，不做新旧运行时兼容。
5. 每个阶段完成后更新本索引和拆分计划，方便后续 AI 接手。

## 6. 审计结论

2026-07-25 复检覆盖：

- 产品定位与真实能力提升闭环。
- 元数据、主数据、事实、决策、投影和运行数据边界。
- 不可变证据与追加纠错。
- 训练和独立验证隔离。
- Tutor Agent、Skills、Tools、Prompt、Context 和风险控制。
- Provider、多任务并发、事务、Outbox、恢复、加密和备份。
- 前端模块、设计系统、弹层、表单、题目和内容渲染。
- 模块化编码、枚举/常量、错误、日志和测试规范。

未发现阻止开始实施的架构级矛盾。算法阈值、Prompt 质量和具体视觉参数必须通过后续固定评测、模拟考生回放和真机测试校准，不能只靠文档一次定死。
