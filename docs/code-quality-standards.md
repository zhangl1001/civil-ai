# 代码质量与模块边界规范

## 1. 分层与依赖

- 页面和组件只调用 Feature/Application Port，不直接访问数据库适配器。
- Application 负责用例编排，Domain 维护不变量，Adapter 负责协议和存储转换，Composition Root 只装配依赖。
- 业务模块不得依赖具体 SQLite、IndexedDB、Capacitor 或模型供应商类型。
- Native 与 Web 必须共用业务装配，平台入口只提供数据库、文件、网络和生命周期 Port。
- Web 与 Native Composition Root 必须实现同一个 `TutorDatabaseRuntime` 合同；新增业务端口不得分别维护两套接口。

## 2. 数据与事务

- SQLite 是 iOS 业务真相源；对话日志、临时工具状态和流式 token 不进入业务数据库。
- 枚举在 Domain 统一定义，数据库 CHECK、工具 Schema、页面标签必须通过映射或自动校验保持一致。
- 已发布迁移不可修改，只能追加新版本迁移。
- 事务只包含必须原子提交的数据；网络、模型调用、Markdown 渲染和高成本计算不得进入事务。
- 高基数写入使用 `runBatch/executeSet`，禁止在 iOS 事务内逐条跨 Bridge。

## 3. Agent 与生成内容

- 系统提示词只暴露 Skill 摘要；工具通过供应商工具合同按需加载，不注入完整业务实现提示词。
- 每个模型工具调用必须有且只有一个对应工具结果；确认、取消、超时和恢复都必须保持协议完整。
- 读工具可以并发，写工具默认串行；是否并行由模型提出、策略层校验、运行时执行。
- 页面渲染依赖的结构属于硬约束；教学表达、案例数量和解释方式属于 AI 自主空间。
- 真题、导入题、AI 原创题和变式题必须保留来源及 lineage，不得通过删除来源规避近似校验。

## 4. TypeScript 与文件职责

- 禁止显式 `any`、`@ts-ignore` 和 `@ts-nocheck`；外部输入从 `unknown` 开始验证。
- 确定性状态、业务类型、工具代码、错误代码和页面标签统一使用领域常量及展示映射。
- 新文件默认不超过 600 行；达到预算前拆分状态管理、展示组件、用例编排或适配器。
- 现存超大文件只能缩小不能继续增长，预算由 `check-code-quality.mjs` 管理。
- 随用户数据增长的页面列表必须分页，并统一使用 `InfiniteScrollPagination`；业务页面不得自行创建 `IntersectionObserver` 或可见的“加载更多”控件。
- 固定选项和明确封顶的摘要列表无需分页；全量统计与导出必须使用数据库聚合或分块处理，不能把无上限数据装入页面内存。
- 注释只说明不直观的不变量、风险和设计原因，不复述代码。

## 5. 提交门禁

每次提交至少执行：

```bash
npm run check:code-quality
npm run typecheck
npm run build
git diff --check
```

新增业务必须补充失败、取消、恢复、重复执行和 Native SQLite 场景，不能只覆盖正向流程。
