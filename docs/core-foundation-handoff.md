# AI 私教核心底座交接

> 基线日期：2026-07-26
> 状态：核心底座和主要业务纵向链路已贯通，进入真机验收与产品策略校准阶段。

## 1. 当前结论

新版本已经完成 clean break：

- iOS 以本地 SQLite/SQLCipher 为业务真相源，Web 使用同一 Repository Port 的 IndexedDB 适配器。
- 对话、会话摘要和 Agent 记忆使用独立 `AgentWorkspaceStorage` 文件日志，不占用业务 SQLite/IndexedDB；删除会话同步删除对应消息和会话记忆。
- 不再使用 JSON/Markdown 文件保存题目、讲义、错题、能力画像、任务和计划；Markdown 只作为内容块的渲染格式。
- 旧 Python Agent、旧 HTML 页面、旧 LocalTask/TaskQueue、legacy fallback 和旧数据库访问层已删除。
- 所有用户可见长任务统一进入 `AgentRun`，所有业务通知统一进入 `MessageCenter`。
- 普通对话使用同一个受控 Agent Loop，但内部工具运行不会混入全局任务栏和铃铛。
- 对话运行中支持向当前 Agent Run 追加引导；引导使用有界临时队列，不创建任务。工具明细同样只保留当前 run，下一次请求整体替换。

## 2. 已贯通的纵向链路

### 建档与计划

建档一次事务写入 Project、Candidate Profile、Exam Cycle、目标分、现状分、约束和偏好。系统不会自动创建无法建立画像的默认工程。

本地计划引擎读取目标差距、能力轨迹、复习队列和时间约束生成计划；计划项支持开始、完成、跳过、取消、失败原因和结果后重排。主动信号按冷却、静默时段和主动程度进入消息中心。

### 私教练习

页面或聊天工具创建 `AgentRun`，绑定 `scopeKey`、能力节点、学习主线、计划项和复习项。统一 Worker 默认最多并发 3 个任务，支持精确重复派发限制、租约续期、异常恢复、取消、供应商限流退避和自适应降并发。

AgentRun 还必须归入四个稳定业务工作池：`content_generation`（生题/讲义/积累）、`assessment`（批改/错因/复盘）、`interactive`（对话/确认）、`background`（计划和维护）。默认三个 lane 分别保障交互、批改和生成，后台任务仅在空闲时补位；供应商全局并发上限始终优先，不能因为增加业务池而放大模型请求数。

内容生成按需加载版本化书本式 Prompt，经过 Provider Gateway、Invocation Ledger、结构化 JSON 解析、Schema 校验、质量门禁和原子提交。成功后写入讲义与题组，任务检查点保存真实跳转参数。

### 作答与能力证据

做题页每次按 `questionSetId` 查询题组和历史会话，不依赖页面缓存。提交后在事务内写作答、客观判分、题目暴露、保守错因、学习证据和 Outbox；随后触发 AI 结构化错因分析。解析、错因、错题本、闪卡和历史读取同一事实链路。

交卷按钮只等待确定性事务提交；提交期间答案、题号、滑动、答题卡和讲义切换全部锁定。事务成功后立即进入批改结果，不再用“提交中”等待模型错因、掌握刷新或计划重排。

完成练习后刷新掌握轨迹、复习队列、计划项和剩余计划。后处理失败不会要求用户重复交卷，`ObjectiveSubmissionRecoveryCoordinator` 会按事件类型领取 Outbox 并幂等恢复，再唤醒 `assessment` 工作池执行 AI 错因。思考过程不落库、不进入后续上下文。

### 其他业务

申论生成/批改、面试深度点评、每日积累、月报、模考和考点精讲均使用 AgentRun、版本化 Prompt、LearningAsset 和 MessageCenter。主观评价通过 Rubric 维度写入学习证据，不套用客观题正确率。

## 3. 关键运行入口

- Web 装配：`web/src/composition-root/database/createWebTutorDatabase.ts`
- iOS 装配：`web/src/composition-root/database/createNativeTutorDatabase.ts`
- Agent 装配：`web/src/composition-root/agent/createTutorAgentHandlers.ts`
- 全局 Worker：`web/src/composition-root/agent/AgentWorkerCoordinator.ts`
- 工作池策略：`web/src/modules/agent/domain/AgentWorkPoolPolicy.ts`
- 交卷恢复：`web/src/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator.ts`
- 任务消息投影：`web/src/composition-root/agent/TaskMessageProjector.ts`
- 结构化练习入口：`web/src/features/practice/StructuredPracticeTaskCenter.ts`
- 内容解析：`web/src/modules/content/application/GeneratedContentParser.ts`
- 公共模型 JSON 解析：`web/src/capabilities/ai-runtime/parsing/StructuredJson.ts`

公开合同只从各模块 `public.ts` 导入。Vue 页面不得直接访问 Repository，Feature 和应用服务不得直接访问 SQLite、IndexedDB 或数据库 Adapter；`check-architecture` 会阻止回退。

## 4. 不可破坏的不变量

- SQLite 是 iOS 真相源，IndexedDB 只是 Web/调试 fallback。
- AI 只能提交结构化候选，不能直接设置掌握度、计划完成度、预测分或证据有效性。
- 作答、判分和证据必须事务化、幂等并可追溯。
- iOS SQLite 只允许单写队列；高基数事实必须使用 `runBatch/executeSet` 批量写入，禁止在交卷事务内逐条跨 WebView Bridge。
- 数据库锁等待和原生调用必须有界；超时后拒绝新操作，不能让一个任务永久阻塞整个 App。
- 启动时会回滚插件连接中的遗留事务；App 从后台回到前台时，`TutorDatabaseLifecycleCoordinator` 会先关闭数据库门禁、废弃旧锁队列和旧连接代次，再回滚、重连、恢复 PRAGMA 并执行 `quick_check`。Agent、生题、批改、Outbox、主动私教和页面查询只能在门禁恢复后继续。
- 如果原生 Bridge 超时且连接内恢复失败，`DatabaseStallRecovery` 会有冷却地重建 Web Runtime；它是最后兜底，不清空数据库，也不要求用户重装。
- iOS SQLite 与 WebView 同属 App 进程，并不存在可单独 kill 的数据库进程。强杀 App 后由 SQLite/WAL 回滚未提交事务，下一次启动再执行连接检查和严格回滚。
- 网络、模型调用和长轮询不得放在 Unit of Work 内；事务中只允许必要查询、批量写入、幂等回执与 Outbox。
- 普通核心事务预算为 20 秒，迁移/完整恢复等显式 `maintenance` 事务预算为 120 秒。事务超时后拒绝后续 SQL 并立即回滚；回滚失败升级为连接恢复。
- Repository 一旦收到 `TransactionContext`，所有读写必须复用当前事务连接。禁止在事务内部调用全局 `database.query()`；可靠性检查会扫描并阻止这种自锁重入。
- 当前已修复计划项状态更新和主动私教信号状态更新中的事务重入。模型调用、内容解析、能力计算和页面查询保持在事务外；交卷核心事实与 Outbox、生成内容与完成状态及 Outbox 仍保持必要原子性。
- `UnitOfWork.runAutocommit` 用于消息已读/归档、主动信号单条追加、模型调用审计单条状态等独立写入，避免额外 `BEGIN/COMMIT` Bridge 往返。SQLite 对每条 SQL 仍保留隐式事务；任何多事实不变量继续使用显式 `run`。
- 题干、材料、选项、答案、解析和错因使用结构字段，不用正则拆 Markdown 章节。
- 每次模型调用必须进入 Invocation Ledger；模型思考内容不保存。
- 同一业务 scope 的活动任务只能有一个，查询必须走 AgentRun Repository 精确目标索引。
- 工具执行明细、流式增量和用户临时引导只保留当前 run 的有界内存快照，不写业务库、不无限累积。
- 页面重进必须重新查询 Repository，不以 Pinia 或 localStorage 作为业务事实。
- 新业务接入任务和消息时必须使用稳定枚举、标准事件和统一跳转参数。

## 5. 当前验证

2026-07-26 已通过：

```text
npm run check:database-schema
npm run check:learning-reliability
npm run check:onboarding
npm run check:design
npm run smoke:vue
cd web && npm run build
npm run ios:sync
xcodebuild ... -sdk iphonesimulator ... build
```

其中 Web 全量构建覆盖架构边界、课程/内容元数据、内容 Schema、Prompt 哈希、OpenAI/Anthropic Gateway、生成工作流、学习证据、IndexedDB 事务串行、交卷 Outbox 恢复、Agent Runtime/Loop、聊天上下文、掌握策略、TypeScript 和 Vite 生产构建。iOS 资源已重新同步，包含 SQLite 与 StatusBar 插件。

## 6. 后续入口

核心底座不再需要重写。后续工作按优先级为：

1. iPhone 真机验收：前后台切换、提交中切后台、杀进程恢复、SQLite 升级、限流、取消、键盘、安全区和任务完成跳转。
2. 预测分区间与真实模考校准，建立可回放的策略评测数据集。
3. 为长材料多问、资料图表和多图分组增加独立模板元数据、Fixture 和视觉回归。
4. 申论与面试补充更细 Rubric、评分校准、用户纠正和音频资产生命周期。
5. 数据库加密密钥轮换、备份恢复完整性和 App Store 发布检查。

这些属于产品深化和发布验收，不应重新引入旧文件数据层或第二套任务系统。
