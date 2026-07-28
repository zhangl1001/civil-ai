# AI 私教核心底座交接

> 基线日期：2026-07-27
> 状态：核心底座、结构化真题闭环、主动私教、能力校准、P7 自动化评测、P8 Web Research、PDF 双端输入和 iOS 图片 OCR 核心链路已完成；算法真实样本校准、输入适配深化与候选包真机发布验收仍待完成。

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

生成质量门禁只阻断不可渲染、不可作答或答案不一致的结构错误。有效题达到请求量 80% 时先提交有效子集；不足时只修复异常题。章节、题目和选项标识由应用确定性生成，可选教学章节不要求模型凑数。网关首次发现结构化工具模式不可用后会在当前配置实例内记忆并直接使用提示词 JSON 模式，不重复无效探测。

### 作答与能力证据

做题页每次按 `questionSetId` 查询题组和历史会话，不依赖页面缓存。提交后在事务内写作答、客观判分、题目暴露、保守错因、学习证据和 Outbox；随后触发 AI 结构化错因分析。解析、错因、错题本、闪卡和历史读取同一事实链路。

交卷按钮只等待确定性事务提交；提交期间答案、题号、滑动、答题卡和讲义切换全部锁定。事务成功后立即进入批改结果，不再用“提交中”等待模型错因、掌握刷新或计划重排。

完成练习后刷新掌握轨迹、复习队列、计划项和剩余计划。后处理失败不会要求用户重复交卷，`ObjectiveSubmissionRecoveryCoordinator` 会按事件类型领取 Outbox 并幂等恢复，再唤醒 `assessment` 工作池执行 AI 错因。思考过程不落库、不进入后续上下文。

每次客观训练结束还会追加独立 `TutorCycleConclusion`，结构化保存观察、诊断状态、建议动作、实际执行、能力评估和复习安排。Agent 通过 `tutor.read_daily_context` 按硬上限读取今日计划、优先能力、真题证据、到期复习、进行中主线和近期教学结论；不会把整段历史或题目正文塞进上下文。

能力校准使用独立、版本化 `AbilityCalibrationSnapshot`。初始诊断按五个行测模块补锚定覆盖；训练题与真题证据分别聚合，输出训练/真题差距、保持、迁移、置信度和预测分区间。原始证据不改写，SQLite/IndexedDB 只幂等追加短事务快照；首页、质量追踪和 Agent 读取同一份聚合结论。

### 其他业务

申论生成/批改、面试深度点评、每日积累、月报、模考和考点精讲均使用 AgentRun、版本化 Prompt、LearningAsset 和 MessageCenter。主观评价通过 Rubric 维度写入学习证据，不套用客观题正确率。

每日热点不再依赖模型记忆：任务先通过独立 `WebResearchGateway` 检索最多 5 条近期来源，再基于编号证据生成 Markdown，并把查询词、URL、域名、摘录和抓取时间写入 LearningAsset。每日知识点不强制联网。网络研究默认使用无需密钥的内置免费搜索，并保留 Jina Search 与 Brave Search 作为可选增强；搜索配置与模型供应商解耦。

聊天 Agent 按意图加载 `research.current_affairs`、`research.exam_syllabus` 或 `research.true_questions`。AI 自主判断是否在同一回合发起多个必要且独立的只读调用，Runtime 最多并行 3 个并按原调用顺序回填结果；存在依赖时分回合执行，写入和确认类工具始终串行。网页正文只能读取当前 Run 搜索返回的有界候选 URL，普通聊天不分配搜索工具。工具 UI/SQLite 进度事件保持串行，网络并发不会制造数据库并发写。真题网络来源使用 `web_research` 导入方式并复用 `question_bank.scan → confirm → publish`，未经确认不能污染正式题库。

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

### Agent 工具与 Skill 分层

Agent 能力使用四层装配，禁止重新把逐工具说明堆进聊天系统提示词：

1. `AgentToolRegistry` 原子注册纯工具元数据和 Skill，不引用页面、数据库或执行器。
2. `AgentSkillRouter` 根据当前用户意图选择最多两个 Skill；普通陪伴聊天不加载工具。
3. `ToolExposurePlanner` 按 audience、工具数和上下文预算生成当前轮最小暴露集合。
4. `AgentSystemPromptComposer` 只组装通用行为边界和当前 Skill 摘要；工具名称、description 和输入 Schema 通过 Provider 原生 `tools` 字段发送。

风险等级、用户确认、幂等、超时、数据范围、事务和具体业务规则全部留在本地 Policy 与 Executor。供应商不支持原生工具时，只允许 Provider Adapter 对当前最小工具集合做兼容转换，业务层不得把完整工具目录拼入 Prompt。

新增工具的固定步骤：增加纯 Catalog 定义、绑定一个或多个 Skill、增加路由规则、注册 Executor、补最小暴露与策略测试。不得修改 `RunAgentLoop`，也不得在 `ChatAgentService` 增加逐工具 Prompt 文案。

公开合同只从各模块 `public.ts` 导入。Vue 页面不得直接访问 Repository，Feature 和应用服务不得直接访问 SQLite、IndexedDB 或数据库 Adapter；`check-architecture` 会阻止回退。

## 4. 不可破坏的不变量

- SQLite 是 iOS 真相源，IndexedDB 只是 Web/调试 fallback。
- AI 只能提交结构化候选，不能直接设置掌握度、计划完成度、预测分或证据有效性。
- 作答、判分和证据必须事务化、幂等并可追溯。
- iOS SQLite 只允许单写队列；高基数事实必须使用 `runBatch/executeSet` 批量写入，禁止在交卷事务内逐条跨 WebView Bridge。
- 题库来源枚举与 SQLite CHECK 必须由自动校验保持一致；新增枚举只能追加迁移，不得修改用户设备已经执行的迁移文件。
- 数据库锁等待和原生调用必须有界；超时后拒绝新操作，不能让一个任务永久阻塞整个 App。
- 启动时会回滚插件连接中的遗留事务；App 从后台回到前台时，`TutorDatabaseLifecycleCoordinator` 会先关闭数据库门禁、废弃旧锁队列和旧连接代次，再回滚、重连、恢复 PRAGMA 并执行 `quick_check`。Agent、生题、批改、Outbox、主动私教和页面查询只能在门禁恢复后继续。
- 如果原生 Bridge 超时且连接内恢复失败，`DatabaseStallRecovery` 会有冷却地重建 Web Runtime；它是最后兜底，不清空数据库，也不要求用户重装。
- iOS SQLite 与 WebView 同属 App 进程，并不存在可单独 kill 的数据库进程。强杀 App 后由 SQLite/WAL 回滚未提交事务，下一次启动再执行连接检查和严格回滚。
- 网络、模型调用和长轮询不得放在 Unit of Work 内；事务中只允许必要查询、批量写入、幂等回执与 Outbox。
- 普通核心事务预算为 20 秒，迁移/完整恢复等显式 `maintenance` 事务预算为 120 秒。事务超时后拒绝后续 SQL 并立即回滚；回滚失败升级为连接恢复。
- Repository 一旦收到 `TransactionContext`，所有读写必须复用当前事务连接。禁止在事务内部调用全局 `database.query()`；可靠性检查会扫描并阻止这种自锁重入。
- 当前已修复计划项状态更新和主动私教信号状态更新中的事务重入。模型调用、内容解析、能力计算和页面查询保持在事务外；交卷核心事实与 Outbox、生成内容与完成状态及 Outbox 仍保持必要原子性。
- `TutorDatabaseRuntime` 已收敛为 Web/Native 共用合同，平台 Composition Root 只负责选择 SQLite/IndexedDB、文件和生命周期适配器；架构门禁禁止再次维护两套 Runtime 接口。
- SQLite 001-028 现在通过带题源、发布草稿、候选题、回执和参考包的增量升级测试；枚举扩展必须追加迁移并验证旧关联数据，不允许要求用户重装 App。
- `UnitOfWork.runAutocommit` 用于消息已读/归档、主动信号单条追加、模型调用审计单条状态等独立写入，避免额外 `BEGIN/COMMIT` Bridge 往返。SQLite 对每条 SQL 仍保留隐式事务；任何多事实不变量继续使用显式 `run`。
- 题干、材料、选项、答案、解析和错因使用结构字段，不用正则拆 Markdown 章节。
- 每次模型调用必须进入 Invocation Ledger；模型思考内容不保存。
- 同一业务 scope 的活动任务只能有一个，查询必须走 AgentRun Repository 精确目标索引。
- 工具执行明细、流式增量和用户临时引导只保留当前 run 的有界内存快照，不写业务库、不无限累积。
- 普通聊天不得暴露业务工具；每轮最多选择两个 Skill、暴露八个工具。系统提示词不得包含工具代码、参数 Schema 或执行步骤。
- 页面重进必须重新查询 Repository，不以 Pinia 或 localStorage 作为业务事实。
- 新业务接入任务和消息时必须使用稳定枚举、标准事件和统一跳转参数。

## 5. 当前验证

2026-07-27 已通过：

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

其中 Web 全量构建覆盖架构边界、课程/内容元数据、跨题型内容质量基准、Prompt 哈希、Provider Gateway 超时/取消/限流、文档输入与分段读取、生成工作流、真题导入/练习/参考包、主动私教、能力校准、学习证据、IndexedDB 事务串行、交卷 Outbox 恢复、iOS 生命周期恢复、Agent Runtime/Loop、聊天上下文、掌握策略、TypeScript 和 Vite 生产构建。

P7 自动化已经证明前后台事件只启动一条数据库恢复链，数据库恢复完成后才回收 Agent 租约并恢复 Worker；导入中断可从持久草稿继续。真实 iPhone 的系统杀进程和手势切后台仍必须使用候选包人工验收，文档不把模拟事件写成真机已通过。

## 6. 后续入口

核心底座不再需要重写。后续工作按优先级为：

1. iPhone 真机验收：验证内置免费搜索、Jina/Brave 可选搜索、国内网络可达性、并行检索、每日热点来源展示，以及前后台切换、提交中切后台、杀进程恢复、SQLite 升级、限流、取消、键盘、安全区和任务完成跳转。
2. 输入适配深化：PDF 文本层、iOS 扫描 PDF 和图片 OCR 已接入；精确版面还原、原文件资产引用与 Web 图片 OCR 仍可继续增强。
3. Web Research 深化：增加官方域名策略、来源核验状态和大纲变更确认界面；不得绕过现有草稿发布管线。
4. 用真实用户真题/模考样本持续扩充离线质量基准和策略回放数据集。
5. 为长材料多问、资料图表和多图分组增加截图级视觉回归；结构与渲染合同已经纳入自动化基准。
6. 申论与面试补充更细 Rubric、评分校准、用户纠正和音频资产生命周期。
7. 数据库加密密钥轮换、备份恢复完整性和 App Store 发布检查。

这些属于产品深化和发布验收，不应重新引入旧文件数据层或第二套任务系统。
