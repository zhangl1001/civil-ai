# AI 私教新核心拆分实施计划

> 状态：执行中  
> 入口：[架构与实施索引](./architecture-index.md)  
> 策略：clean break，新旧运行时不双写；先完成“削弱论证”纵向参考切片，再扩展其他能力和题型。

## 1. 交付原则

- 每个工作包必须可以独立构建、测试和验收。
- 新功能只写入新模块和新数据库，不扩展旧业务模型。
- 尚未切换的页面继续运行旧实现，但新旧数据不互相读取或同步。
- 一个 Feature 切换到新核心后，删除该 Feature 对应旧路径，不保留运行时 fallback。
- 每批结束更新状态、已知风险和下一批入口。

## 2. 工作包总览

| 工作包 | 目标 | 依赖 | 状态 |
|---|---|---|---|
| WP0 | 架构护栏、目录、类型和质量门槛 | 无 | done |
| WP1 | 新数据库内核、元数据和 Repository 合同 | WP0 | done |
| WP2 | 无默认工程的建档与考试周期 | WP1 | done |
| WP3 | 内容 Schema、Markdown/Renderer 和 AI 确定性工作流 | WP1 | done |
| WP4 | “削弱论证”作答、证据、错因和学习主线纵向闭环 | WP2-3 | in_progress |
| WP5 | 掌握、复习、每日计划和主动信号 | WP4 | in_progress |
| WP6 | Tutor Agent、Skills、Tools 和多任务并发 | WP3-5 | in_progress |
| WP7 | 行测复杂模板和全模块扩展 | WP4-6 | pending |
| WP8 | 申论、面试和主观题策略 | WP5-6 | pending |
| WP9 | 全局 UI 收敛、旧代码删除、校准和发布质量 | WP2-8 | pending |

## 3. WP0：架构护栏

状态：done（2026-07-14）

交付：

- 新 `modules/capabilities/features/composition-root` 目录。
- 公共 branded ID、Clock、IdGenerator、Result 和 AppError 合同。
- 稳定领域 code/enum 的统一定义方式。
- 模块 public API 和 import boundary 检查脚本。
- 现有违规依赖 baseline，新代码不得增加。
- `typecheck + architecture check + build` 基础命令。

验收：

- 新 Domain 不能导入 Vue、Pinia、Capacitor、SQLite 和 AI Provider。
- 新页面/Feature 不能导入 `@/db/database`。
- 循环依赖和跨模块 internal import 被检查阻止。
- 现有 Vue 构建不受影响。

完成记录：已建立 Kernel 合同、模块公共入口、领域 code、数据库 Unit of Work 合同和架构检查器；检查器覆盖越层数据库访问、跨模块内部引用、非法层级依赖和循环依赖。`check:architecture + vue-tsc + vite build` 已通过。

## 4. WP1：数据与元数据内核

状态：done（2026-07-14）

已完成：

- 独立数据库名、SQL Port、原生 Capacitor SQLite Driver、连接串行化和生命周期关闭保护。
- Migration Runner、连续版本校验、checksum 防篡改、重复调用合并、外键、WAL 和 busy timeout。
- `001_foundation`：考生周期、目标/测量、约束/偏好、元数据包、课程/能力图谱、评估策略和带租约 Outbox。
- Candidate/Curriculum/Outbox Repository Port 与 SQLite 实现。
- Candidate/Curriculum/Outbox Repository 的 IndexedDB Web fallback；业务合同不暴露 SQLite/IndexedDB 类型。
- SQLite Schema 自动验收：分数范围、唯一活动周期、Outbox 幂等、外键和级联删除。
- 固定国考元数据包：行测/申论基础能力、削弱论证纵向切片、评估策略、SHA-256 与图结构构建校验。
- 命令回执幂等、UUIDv7 单调 ID、开发环境新库重置入口和统一平台运行时工厂。

后续工作包边界：

- Content Repository 的表和实现归入 WP3，与 Content Schema 同批落地。
- Evidence Repository 的表和实现归入 WP4，与不可变证据及纠错投影同批落地。
- Content/Evidence 的表、Port 和双适配器必须分别在 WP3/WP4 与完整领域不变量同批实现，禁止先造万能 JSON Repository。

交付：

- 新数据库名 `zhangl-agent-tutor-v1`。
- migration runner、schema version、外键、WAL 和 busy timeout。
- Unit of Work、乐观锁、幂等和 Outbox。
- Metadata Package、Curriculum、Capability、Policy、Rubric、Prompt、Skill 和 Schema 基础表。
- Candidate/Curriculum/Task Repository Port 与双适配器实现；Content/Evidence 分别由 WP3/WP4 按完整不变量落地。
- IndexedDB 对同一 Repository 合同的最小实现。
- 开发数据库重置入口。

验收：

- migration 重复检测、失败回滚和约束测试通过。
- SQLite/IndexedDB 合约 fixture 一致。
- 业务层看不到 SQLite Row 和 IndexedDB 类型。
- 不创建或读取旧业务表。

## 5. WP2：建档与考试周期

状态：done（2026-07-14）

已完成：

- Onboarding Draft Port、唯一活动工程/周期约束和当前周期 Query。
- `CreateCandidateCycle`：目标分、现状分、时区、学习约束、策略版本验证。
- Project/Profile/Exam Cycle/Targets/Measurements/Constraints/Preferences/Policy Bindings/Outbox/Command Receipt 单事务创建。
- 重复确认幂等返回原周期，行测与申论都绑定明确 mastery policy，申论额外绑定 rubric。
- 建档业务自动验收覆盖无默认工程、完整创建、重复命令和非法分数。
- 统一分步建档页复用 FormField/SegmentedControl/StickyActionBar，草稿自动保存并支持恢复。
- 首次启动和受保护业务路由守卫；没有活动周期时统一进入建档。
- Candidate Home Query、首页和“我的”切换新数据；自报成绩明确标记为数据不足。
- 初始诊断入口和渐进式诊断骨架；真正锚定题由 WP3 内容工作流提供。
- `UpdateScoreTargets` 追加目标版本，旧目标变为 superseded；Outbox/Command Receipt 同事务写入。
- SQLite/IndexedDB 双适配器、数据库约束、建档/幂等/目标版本自动验收和完整构建通过。

交付：

- onboarding draft，不创建默认工程。
- 建档表单使用统一表单控件和移动端固定操作栏。
- Project、Exam Cycle、目标版本、真实测量、时间约束和学习偏好事务创建。
- 初始元数据版本和科目 Policy 绑定。
- 渐进式初始诊断骨架和数据不足状态。
- 首页改读新 Candidate Query。

验收：

- 未建档不能生题、计划和计算画像。
- 目标、自报现状、真实成绩和预测分来源清晰。
- 建档失败无半份工程。
- 目标修改生成版本，不覆盖历史。

## 6. WP3：内容与 AI 确定性工作流

状态：done（2026-07-14）

已完成：

- `002_content_ai_foundation`：内容元数据发布包、Schema、题型模板、Prompt、生成规格/工作流、讲义、题组、题目和调用账本表及约束。
- Content Schema 严格校验、`single_choice` fixture 和负向协议测试；非法对象不再静默转字符串。
- 隔离 Marked 实例、集中 DOMPurify/URL Policy、GFM 表格 renderer 和原 `MarkdownContent` 无侵入切换。
- Content Repository Port 及 SQLite/IndexedDB 双适配器，发布元数据安装、题组聚合提交和查询合同。
- 书本章节式 Prompt Registry/Compiler，削弱论证按需 Prompt Bundle、变量完整性和内容哈希校验。
- Anthropic/OpenAI Compatible Provider Gateway 合同、统一响应/usage/finish reason 和流式增量解析测试。
- Prompt Repository、AI Invocation Ledger 双适配器及运行时装配。
- Generation Workflow 合法步骤、终态、失败和取消状态机测试。
- Generation Repository Port 与 SQLite/IndexedDB 双适配器：请求先落库、幂等键查询、版本乐观锁推进；内容聚合不再重复创建生成记录。
- Context Compiler 从考试周期、目标、自报/测量证据、学习约束和能力图谱编译不可变最小快照；明确禁止从自报成绩或聊天推断掌握度。
- `CreateGenerationWorkflow` 单事务创建不可变 GenerationSpec、Queued Workflow 和 Outbox，绑定内容 Schema、题型模板与 Prompt 版本，重复命令按幂等键返回原聚合。
- “削弱论证讲义 + 题组”确定性运行器已贯通 Provider 调用、严格 JSON/Schema 解析、领域质量门禁、staging、内容聚合提交和 committed Outbox。
- AI 调用在请求发出前写入 pending 账本，返回后补齐 token/耗时/finish reason；失败、限流、取消和进程中断均可审计。
- 失败工作流支持显式 retry；遗留 pending 调用恢复时先标记 `generation.process_interrupted`，不与新尝试混用。
- `GetGenerationStatus` 按 `workflow_id` 查询状态，并在 committed 时通过 `generation_spec_id` 恢复最终题组；重复执行已完成任务不会再次调用模型。
- 端到端固定测试覆盖可信上下文、幂等创建、成功发布、重复执行、非法输出不发布、Provider 失败账本、失败重试、取消和结果恢复。

交付：

- ContentDocument/ContentBlock Schema。
- Markdown Engine、Sanitizer、Renderer Registry 和基础 Block Renderer。
- Question Template Registry，先实现 `single_choice`。
- Provider Gateway、Prompt Registry/Compiler、Context Compiler 和调用账本。
- Generation Workflow 状态机和 staging/validation/commit。
- 第一版“削弱论证”讲义 + 题组 GenerationSpec。

验收：

- Prompt 按需加载且有版本、哈希和固定 fixture。
- Anthropic/OpenAI Compatible 返回统一结构。
- 生成失败不会留下可练习半成品。
- 页面重进可恢复生成状态，完成后自动查询新题组。
- Markdown 类型错误、表格和 SVG 失败有明确诊断，不白屏。

完成证据：`npm run check:generation-foundation`、`npm run check:database-schema` 和 `web/npm run build` 通过。下一执行入口为 WP4，详见 [核心底座交接](./core-foundation-handoff.md)。

## 7. WP4：参考能力纵向闭环

范围：判断推理 → 逻辑判断 → 削弱论证及必要前置能力。

状态：in_progress（2026-07-14）

当前断点：

- 已新增并注册 `003_learning_evidence.sql`，覆盖 learning thread/event、teaching blueprint、learning session、question exposure、attempt、decision observation、grading result、error diagnosis、learning evidence、evidence correction 和 validity projection。
- 已增加稳定领域枚举、branded ID、Learning Thread 与 Learning Evidence Repository 合同。
- 已建立 Learning Thread 的 SQLite/IndexedDB 适配器，以及学习会话/错因/证据的 SQLite 适配器。
- IndexedDB 已升级到 v12 并创建 WP4 学习事实与 Agent Run 聚合 Store。
- 数据库验收覆盖活动主线唯一性、题组与作答一致性、重复作答约束、学习证据不可原地修改和考试周期级联删除。
- 已补齐学习会话、错因和证据的 IndexedDB 适配器，Web 与 iOS runtime 均暴露同一 Repository Port。
- 已实现受限 Learning Thread 状态机与创建/推进/暂停/恢复/完成/放弃应用服务，所有转换追加事件并使用乐观锁和事件幂等键。
- 已实现版本化 `ObjectiveEvidencePolicy`、`SubmitObjectiveSession`、`CorrectLearningEvidence`：客观题提交在一个 Unit of Work 内写 session、attempt、判分、题目暴露、保守初始错因、证据/有效性投影和 Outbox；原 evidence 不可修改。
- 初始错因只写 `unknown` 并明确缺少决策证据，AI/用户后续才能补充具体结构化归因，禁止从错误选项直接臆断“粗心/概念不清”。
- 已实现 `GetObjectiveSessionReview` Query DTO，练习详情、历史、错题本和闪卡可复用同一题目/作答/判分/错因聚合。
- 已新增并注册 `004_error_diagnosis_confirmations.sql`：原始错因不可覆盖，用户/AI 确认、拒绝和纠正追加为确认事实，并通过乐观锁维护当前诊断投影。
- 已实现 `ConfirmErrorDiagnosis`，确认结果在一个 Unit of Work 内连同 Outbox 写入；错误答案的确定性学习证据与“具体错因”保持边界，不因拒绝某个错因而被错误失效。
- `GenerationSpec`、讲义和题组记录已透传可选 `learning_thread_id` / `teaching_blueprint_id`；生成内容可追溯到长期教学主线和教学策略版本，下一步 Feature Adapter 绑定时负责校验考试周期和能力节点一致。
- 已新增 `check:learning-evidence`，覆盖主线创建与推进、整套提交幂等、证据权重、保守错因、错因纠正、纠错后有效查询和 Outbox。
- 已新增 `005_tutor_agent_runtime.sql` 及通用 Agent Run：双适配器、创建/推进、原子 claim、默认并发 3、lease 恢复、调用账本、受控模型执行器和 `errorDiagnosisPromptV1`。
- 已新增 `RequestAiErrorDiagnosis` / `RunAiErrorDiagnosis` / `CompleteObjectivePractice`，后端可将确定性错误转为异步 AI 候选诊断，再等待用户确认。
- 当前 `npm run check:database-schema`、`npm run check:learning-evidence`、`npm run check:architecture` 和 `web/npm run build` 通过。

下一入口：把第一个削弱论证页面切换到 `CreateLearningThread → CreateGenerationWorkflow(threadId) → CompleteObjectivePractice → GetObjectiveSessionReview`，并由 Agent Runner 执行错因候选诊断。必须先写 Agent Runtime 专项回归，再删除该 Feature 的旧 `PracticeSessionRepository` 路径。详细断点见 [核心底座交接](./core-foundation-handoff.md#8-wp4-当前开发断点)。

交付：

- Learning Thread 创建、阶段推进、暂停和恢复。
- 讲义、独立练习、作答会话、客观判分和 AI 错因分析。
- Attempts、Decision Observations、Learning Evidence 和 Evidence Correction。
- 原题标记、解析、错因、AI 分析和错题入口。
- 训练/保持/迁移/锚定角色及题目暴露记录。
- Practice/History/WrongBook/Flashcard 复用同一 Renderer。

验收：

- 同样答错但错因不同会进入不同下一动作。
- 退出重进后答题、批改和错因状态一致。
- 用户报告错题后证据失效并重算，历史仍可审计。
- 已见题不能作为独立掌握验证。

## 8. WP5：掌握、复习与计划

交付：

- Mastery Policy、多维轨迹、可信度和状态机。
- Review Queue、保持测试、迁移测试和退化。
- 本地 Daily Plan Engine、AI 审核、版本和退出条件。
- Score Projection 区间和真实模考校准入口。
- Proactive Signal、Nudge、冷却和用户主动程度。
- 首页切换为真实私教计划中心。

验收：

- 少量或提示作答不会误判掌握。
- 只有保持和迁移证据满足 Policy 才进入 mastered。
- 每日计划在 500ms 内有本地结果，AI 不可用仍可打开。
- 错题复发和计划偏离能产生不重复的主动信号。

## 9. WP6：Tutor Agent

交付：

- Agent Run/Memory/Event/Checkpoint。
- Skill Registry/Resolver 和最小 Tool Catalog。
- 多 turn 原生工具调用、参数补齐和风险确认。
- 页面命令与 Agent 领域事件联动。
- 工具执行条、Task Dock、铃铛和对话使用统一 View DTO。
- 全局并发 3、供应商自适应降级、资源锁、取消和恢复。

验收：

- Agent 可以查档案 → 找活动主线 → 生成练习 → 观察结果 → 继续说明下一步。
- 普通聊天不创建任务。
- 三个并发任务不串消息、工具、题组和目标页面。
- 循环、token、工具调用、重试和费用预算可收束。
- 思考过程不落库、不进入上下文。

## 10. WP7：行测复杂模板

扩展顺序：

1. 言语单题和长篇多问。
2. 资料分析表格/图表共享材料。
3. 判断推理图推和多图分组。
4. 数量关系。
5. 常识判断和时效来源。
6. 完整模考与时间策略证据。

每类题型必须新增 Metadata、Content Schema、Renderer Manifest、Prompt Skill、Validator 和 fixture，不复制页面。

验收：所有入口复用 Renderer，图形等比、材料不拆乱、共享材料只在结构字段出现一次。

## 11. WP8：申论与面试

交付：

- 申论 rubric、作品版本、逐维度证据、讲义、题目、批改和迁移。
- 面试文本/语音作答、音频资产、rubric、追问和复盘。
- Subject-specific Assessment/Mastery/Score Projection Policy。
- 对应 Skills、Tools、Prompt、Renderer 和主动教学动作。

验收：主观题不套客观正确率；AI 评分有 rubric、证据、置信度和用户纠正路径。

## 12. WP9：收敛与发布

交付：

- 全局 Design Token、Page Layout、Overlay、Form 和业务组件收敛。
- 加密、备份、恢复、完整性和数据删除。
- 删除旧 database store、旧 Repository/Service、旧提示词/Runner 和 legacy 资源。
- 模拟考生回放、Prompt eval、算法校准、性能基准和真机回归。
- App Store 隐私、权限、错误恢复和发布检查。

验收：运行时无旧业务读取；核心链路性能达标；前后台、键盘、离线、限流、杀进程和恢复通过真机测试。

## 13. 每批进度模板

```text
工作包：
完成：
验证：
未完成：
已知风险：
下一入口：
涉及文档/ADR：
```

不能只写“started/done”；完成状态必须对应可运行代码和验收证据。
