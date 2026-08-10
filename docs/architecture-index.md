# Zhangl Agent 架构文档索引

本目录只保存对贡献者长期有效的产品、架构和工程合同。实施路线图、交接记录、阶段清单、原始审计报告和发布快照属于内部项目管理资料，不进入公开仓库。

## 文档优先级

```text
1. architecture-constitution.md
2. core-business-architecture.md / ai-service-architecture.md
3. 专项架构设计与 ADR
4. modular-architecture-standard.md / coding-quality-standard.md
```

发生冲突时按以上优先级处理。ADR 对其明确覆盖的决策具有最终解释权。

## 产品与业务架构

| 文档 | 作用 |
|---|---|
| [架构宪法](./architecture-constitution.md) | 产品定位、AI 与确定性代码的边界、数据原则和不可突破的工程约束 |
| [核心业务模块架构](./core-business-architecture.md) | 内容生成、消息中心、个人能力分析及其数据所有权、接口和事件 |
| [AI 私教服务架构](./ai-service-architecture.md) | Tutor Agent、Skills、Tools、Prompt、Context、Memory、Provider 和 Workflow |

## 专项架构与决策

| 文档 | 作用 |
|---|---|
| [ADR-001：供应商无关 Agent Runtime](./adr-001-provider-neutral-agent-runtime.md) | Agent 内核、Provider、Tools、Context、Memory、Sub-agent 和 Task 的边界 |
| [ADR-002：Pi Agent Core 循环引擎](./adr-002-pi-agent-core-loop-engine.md) | Agent loop 引擎选型与适配边界 |
| [前端设计系统与业务模板](./frontend-design-system-architecture.md) | Token、布局、弹层、表单、业务组件和题目模板 |
| [内容与 Markdown 渲染](./content-rendering-architecture.md) | Markdown、表格、公式、SVG、结构块和 Renderer 合同 |

## 工程标准

| 文档 | 作用 |
|---|---|
| [模块化分层与组合标准](./modular-architecture-standard.md) | 模块边界、分层、合同、Registry 和装配规则 |
| [编码质量规范](./coding-quality-standard.md) | TypeScript、Vue、SQL、异步、错误、安全和测试规范 |

## 稳定工程决策

- 平台采用 Vue 3、TypeScript 和 Capacitor，iOS 是首要真机平台。
- iOS 使用 SQLite 作为业务真相源；Web 使用实现同一 Repository 合同的 IndexedDB 适配器。
- 产品采用本地优先模块化单体，不要求自建云服务。
- 用户配置模型供应商，本地 Tutor Agent 在策略和预算约束内调用模型与工具。
- 业务围绕考试周期、能力图谱、学习证据、学习主线和独立掌握验证组织。
- 页面状态不是业务真相源；重新进入页面时通过 Query/Application Service 读取持久化事实。
- 题目、讲义、解析和错因使用版本化内容块与渲染模板，不以 Markdown 文件作为业务数据结构。

## 公开文档边界

- 发布说明保存在 GitHub Releases。
- 可执行工作由 GitHub Issues 和 Pull Requests 跟踪。
- 未公开安全问题通过 [安全策略](../SECURITY.md) 报告，不提交原始漏洞报告。
- 内部路线图、AI 交接材料、阶段完成度和本地测试记录保存在私有工作区。
- 架构发生变化时更新对应文档或新增 ADR，不把临时执行清单写入架构文档。
