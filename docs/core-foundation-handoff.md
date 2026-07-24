# AI 私教核心底座交接

> 基线日期：2026-07-14  
> 完成范围：WP0-WP3、WP4 后端事实链路、WP5 掌握投影基础、WP6 Agent 执行底座  
> 下一工作包：首个削弱论证 Feature Adapter 和页面纵向闭环

## 1. 接手顺序

1. 先读 `architecture-index.md`，按其中优先级处理文档冲突。
2. 阅读 `architecture-constitution.md` 和 `implementation-roadmap.md` 的 WP4。
3. 从本文件列出的 public API 和 composition root 接入，不从旧 Service、旧 JSON 或页面数据库调用继续开发。
4. 每批完成后更新 `implementation-roadmap.md` 和本文件的下一入口。

## 2. 已完成底座

- Kernel：branded ID、Clock、IdGenerator、Result、稳定 JSON 哈希。
- 架构护栏：模块 public API、分层和循环依赖检查，新 Feature 禁止直接访问数据库。
- 数据内核：SQLite 主实现、IndexedDB Web fallback、Migration、Unit of Work、乐观锁、幂等回执和 Outbox。
- 建档：无默认工程，Project/Profile/Exam Cycle/目标/现状/约束/偏好单事务创建。
- 元数据：版本化课程、能力节点/边、评估策略、内容 Schema 和题型模板。
- 内容：结构化 ContentDocument/ContentBlock、单选题合同、统一 Markdown/Sanitizer 和题组聚合仓储。
- AI：Prompt Registry/Compiler、Anthropic/OpenAI Compatible Gateway、调用账本和最小可信 Context Compiler。
- 生成：不可变 GenerationSpec、工作流检查点、严格解析、质量门禁、原子发布、取消、失败重试和结果恢复。

## 3. 运行入口

平台装配：

- Web：`web/src/composition-root/database/createWebTutorDatabase.ts`
- iOS：`web/src/composition-root/database/createNativeTutorDatabase.ts`

两个 runtime 暴露同一应用能力：

- `createCandidateCycle`
- `getCandidateHome`
- `updateScoreTargets`
- `createGenerationWorkflow`
- `runWeakeningGenerationWorkflow`
- `getGenerationStatus`
- `startWeakeningTeaching` / `requestWeakeningPractice`
- `completeObjectivePractice` / `getObjectiveSessionReview`
- `refreshMasteryTrack`
- `startReviewQueueItem` / `completeReviewQueueItem` / `failReviewQueueItem` / `retryReviewQueueItem`
- `buildDailyPlanProposal` / `persistDailyPlanProposal` / `updateDailyPlanItemStatus`
- `runTutorAgentBatch`

公开合同只从以下入口导入：

- `@/kernel/public`
- `@/modules/candidate/public`
- `@/modules/curriculum/public`
- `@/modules/content/public`
- `@/modules/task/public`
- `@/capabilities/ai-runtime/public`

## 4. 不可破坏的不变量

- UI 和 Feature 不得直接查询 SQLite、IndexedDB 或 `@/db/database`。
- SQLite 是 iOS 真相源，IndexedDB 只实现相同 Repository Port；业务类型不得暴露存储类型。
- AI 对话、自报成绩和模型思考不是掌握事实；WP4 只能由作答和判分产生学习证据。
- GenerationSpec 执行后不可修改，必须绑定 Prompt、Schema、模板和 Context Snapshot 版本。
- AI 输出先 staging 和校验，只有内容聚合、工作流完成和 Outbox 同事务成功后才可练习。
- 每次模型调用必须有 AI Invocation Ledger；pending 遗留必须先结束再发起新尝试。
- 页面重进按 `workflow_id` 查询 `getGenerationStatus`，不得依赖 Pinia 内存状态判断是否完成。
- 题干、材料、选项、答案和解析使用结构字段，禁止靠正则拆 Markdown 区域。
- 新核心 clean break，不增加旧数据导入、双读、双写和 fallback。

## 5. WP4 建议拆分

1. `003_learning_evidence.sql`：作答会话、attempt、decision observation、判分结果、错因、题目暴露、learning evidence、evidence correction、learning thread/event。
2. Evidence/Learning Repository Port 与 SQLite/IndexedDB 双适配器，同批定义索引、唯一约束和事务边界。
3. 客观题 `SubmitAnswerSession`：重复提交幂等，一次提交原题标记、判分和证据单事务写入。
4. 错因工作流：代码先生成确定性候选，AI 只补结构化分析；用户可确认、纠正和使证据失效。
5. Learning Thread：创建、阶段推进、暂停、恢复和退出条件；不在页面写状态机。
6. Query DTO：Practice/History/WrongBook/Flashcard 读取同一题目、作答、解析和错因聚合。`GetWrongBookEntries` 已落地到 SQLite/IndexedDB；错题页面不再依赖旧错题索引或 Markdown 扫描。
7. 首个页面切片：削弱论证讲义 → 作答 → 原题判分标记 → 错因 → 下一动作，退出重进状态一致。

## 6. 验证命令

```bash
npm run check:database-schema
npm run check:generation-foundation
cd web && npm run build
```

`web` 完整构建已包含架构、课程/内容元数据、内容 Schema、Prompt、Provider、状态机、生成底座、TypeScript 和 Vite 生产构建检查。

## 7. 当前明确未完成

- WP4 的后端学习事实、错因、证据纠错、learning thread、新刷题中心、新做题页和新错题本读模型已实现；旧 PracticeView/legacy 路径仍保留，后续只做删除和回归，不再扩展。
- WP5 已有掌握轨迹、可追溯快照、去重复习队列、保守的 `mastery-evidence:v1`、每日计划提案/持久化、复习队列执行成功路径、失败重试和计划项开始/完成回写；分数预测、主动信号、跳过/重排和真机恢复验收尚未实现。
- WP6 已有 Agent Run、调用账本、最多 3 并发 claim、lease 恢复、限流/瞬断退避和错误诊断白名单 handler；Skills/Tools Registry、对话 Agent 编排和 UI 状态 DTO 尚未实现。
- 当前确定性生成只完成“削弱论证 + single_choice”参考切片，复杂材料、图推、申论和面试按 WP7-WP8 扩展。
- Provider Gateway 已完成，但从用户 AI 配置解析具体 Gateway、任务队列消费和页面接入应由后续 Feature/Application Adapter 完成，不能写进 Domain。
- 数据库加密、备份/恢复、旧代码最终删除、全量真机和发布回归属于 WP9。

## 8. WP4 当前开发断点

本节是 2026-07-14 暂停时的精确状态。WP4 仍为 `in_progress`，不能视为页面可用。

已落盘并验证：

- `web/src/capabilities/database/migrations/003_learning_evidence.sql`
  - 已加入 `tutorMigrations`，版本为 3。
  - checksum：`sha256:ffaf25d47ea107d08c9c1387279f6a288ac711f41e3510b277b4b90dbb26dcfa`。
  - `scripts/verify-tutor-database.sh` 已读取并验证新表、唯一约束、证据不可变和级联删除。
- `web/src/kernel/ids.ts` 已增加 Thread Event、Blueprint、Attempt、Exposure、Observation、Grading、Diagnosis 和 Correction branded ID。
- `web/src/modules/evidence/domain/EvidenceCodes.ts` 已定义会话、作答、判分、错因、证据、纠错和暴露稳定枚举。
- `web/src/modules/evidence/contracts/LearningFacts.ts` 与 `LearningRepositories.ts` 已定义学习事实和三个 Repository Port。
- `web/src/modules/teaching/domain/LearningThreadCodes.ts` 与 `contracts/LearningThreadRepository.ts` 已定义主线合同。
- `web/src/capabilities/database/adapters/indexeddb/TutorIndexedDb.ts` 已升级至 v14，并创建 WP4 学习事实、Agent Run、掌握轨迹、快照和复习队列 Store。
- `web/src/modules/teaching/adapters/SqliteLearningThreadRepository.ts` 已实现。
- `web/src/modules/teaching/adapters/IndexedDbLearningThreadRepository.ts` 已实现。
- `web/src/modules/evidence/adapters/SqliteLearningFactRepositories.ts` 已实现 Session、ErrorDiagnosis 和 LearningEvidence 三个 SQLite Repository。
- 暂停前 `npm run check:database-schema` 和 `cd web && npm run typecheck` 均通过。

本轮已完成：

- SQLite/IndexedDB 双适配器、`LearningThreadMachine`、`CreateLearningThread`、`TransitionLearningThread`、`ObjectiveEvidencePolicy`、`SubmitObjectiveSession`、`CorrectLearningEvidence`、`ConfirmErrorDiagnosis`、`GetObjectiveSessionReview` 和 Web/iOS runtime 装配。
- `scripts/verify-learning-evidence.mjs` 已覆盖主线、客观提交、保守错因、纠错、幂等与 Outbox；`cd web && npm run build` 已通过。
- 为消除 Content/Evidence 公共出口循环，`AssessmentRole` 已下沉到 `kernel/assessmentRole.ts`，两个模块共同依赖 Kernel。
- `004_error_diagnosis_confirmations.sql` 已建立不可变确认记录和当前投影；拒绝/纠正错因不会篡改原始诊断，也不会错误失效“客观答案错误”这一确定性证据。
- Content `GenerationSpec`、Lecture、QuestionSet 已暴露并持久化可选 `learningThreadId` / `teachingBlueprintId`，生成内容可被长期教学主线和策略版本追溯。
- `005_tutor_agent_runtime.sql` 已建立 `tutor_agent_runs`、事件和调用账本；支持 SQLite/IndexedDB 双适配、原子 claim、最多 3 个并行任务、lease 过期恢复、状态迁移、调用结果/失败/取消账本写回。
- `InvokeAgentModel` 只负责受控模型调用与审计，不保存思考过程；`errorDiagnosisPromptV1` 是版本化、结构化的保守错因诊断提示词。
- `RequestAiErrorDiagnosis`、`RunAiErrorDiagnosis`、`CompleteObjectivePractice` 已形成后端编排：确定性客观判分 → unknown 初诊断 → Agent Run → AI 候选诊断 → 用户确认/纠正。Vue 做题页提交后会触发受限 Agent 批处理，并重新读取会话 Review。

下一位 AI 按此顺序继续：

1. 继续 Agent/Chat/View DTO：由 Runner claim 后调用 `RunAiErrorDiagnosis`，任务状态、工具执行和错误诊断候选必须显示在同一会话链路；普通聊天不能进入任务栏。
2. 为 Agent Runtime 增加 UI 读取侧：当前会话工具执行列表、Task Dock、铃铛通知应统一读取 AgentRun/View DTO，不能各页面各自拼状态。
3. 增加复习队列退出重进的 Web/真机回归，并验证模型失败、重复点击、前后台切换、交卷后计划项完成状态。
4. 增加计划项跳过/取消/失败原因展示和结果触发计划版本重排。
5. 在切换一个页面后删除该 Feature 对应旧路径，不做双写。

接手注意：

- `teachingBlueprintId` 已透传到 Content，但目前只是可选元数据；必须由未来的 Feature Adapter 在创建生成命令前校验它与学习主线、考试周期和能力节点一致。
- 当前后端已有 AI 结构化诊断 Runner，Vue 做题页已能提交后触发批处理；但 Provider 真机链路、任务栏展示、取消/恢复和跳转体验仍未完成，不能误认为对话 Agent 已完整可用。
- 2026-07-15 已更新 `check:mastery-policy`，覆盖复习队列 `scheduled -> in_progress -> failed -> retry -> in_progress -> completed` 和计划项 `pending -> in_progress -> completed`。页面切换后的 Web/真机回归仍未完成。

## 9. 2026-07-15 最新断点

本轮已完成并通过构建：

- 数据迁移：新增 `007_review_execution_linkage.sql`，为 `review_queue` 增加 `version/claimed_at/completed_at/failure_code`，为 `learning_sessions` 和 `daily_plan_items` 增加 `review_queue_item_id`。
- 复习队列执行：新增 `StartReviewQueueItem`、`CompleteReviewQueueItem`、`FailReviewQueueItem`、`RetryReviewQueueItem`，SQLite/IndexedDB 均通过同一 Repository Port 和乐观版本写入。
- 复习计划启动：`ReviewPracticeFeature` 会先重试 failed 队列项，再领取队列，使用 `review.id + review.version` 作为 thread/generation 幂等键，生成失败会回写 failed 并把计划项恢复 pending。
- 做题交卷：`SubmitObjectiveSessionCommand` 支持 `reviewQueueItemId`；`CompleteObjectivePractice` 完成队列项、更新计划项实际耗时，并继续刷新掌握度和触发 AI 错因诊断。
- 每日计划：`DailyPlanItemRecord` 支持 `reviewQueueItemId`，`UpdateDailyPlanItemStatus` 已接入 Web/iOS runtime；计划页会显示进行中/已完成/已跳过状态，绑定复习队列的计划项可从页面跳过。
- 错题本：`GetWrongBookEntries` 读取学习事实、题组、错因投影和题组模块；错题本筛选已改为按 `questionSet.module`，不再用 `question.purpose` 代替模块。
- Agent 读取侧：`AgentRunRepository.listRecent`、`GetAgentRunViews` 和 `CancelAgentRun` 已落地并挂入 Web/iOS runtime；铃铛面板会合并展示新 AgentRun 和旧 TaskQueue。`AgentRunView` 暴露 `linkedTaskId/toolName/chatSessionId`，可通过迁移桥跳转到旧任务目标模块。
- 对话工具迁移桥：`AICommandRouter.executeToolCall` 会为每次确认执行的业务工具创建 AgentRun，并记录 `chatSessionId/toolName/arguments/taskId`；聊天工具和页面生成入口都已包进 AgentRun，旧 `TaskQueue` 只作为执行内核保留。
- Agent worker：`RunTutorAgentBatch` 支持本地 handler 不传模型网关执行；需要模型的 handler 必须声明 `requiresGateway`，缺失网关时会以 `agent_run.gateway_missing` 失败并可审计。
- AI 工具条：`AIChatSheet` 顶部工具执行条优先读取当前会话 `AgentRunView`，没有 AgentRun 时再回退旧 `tool` 消息，避免普通聊天和其他会话任务混入。
- AI 对话框：普通聊天不创建任务；底部任务栏只展示当前会话通过 `sessionId` 或 `toolCallId` 关联的业务任务，不再兜底显示全局运行任务；非任务寒暄不会额外调用工具分类模型。
- 对话上下文：`ChatContextBuilder` 已从 Pinia store 抽出，统一处理预算、截断、当前输入去重、`[[ZH_AI_STOPPED]]` 和失败回复清理；普通聊天成功回复后会写入确定性本地会话摘要，下一轮进入系统提示；`AIStudentContextService` 会在普通聊天系统提示中注入考试目标、分差、优先薄弱点、最近错因分布和今日计划摘要，缺建档数据时降级为空。
- 回归脚本：`verify-mastery-policy.mjs` 已覆盖复习队列失败重试和计划项状态回写。

已验证命令：

```bash
npm run check:database-schema
npm run check:architecture
npm run check:learning-evidence
npm run check:mastery-policy
npm run check:agent-runtime
cd web && npm run typecheck
cd web && npm run build
```

下一个入口：

1. 从 B 线继续：把剩余工具执行、恢复/取消和跳转一致性继续收口到 AgentRun handler。当前聊天工具和页面生成入口都已进入 AgentRun。
2. Task Dock 仍需继续统一：底部任务栏和铃铛面板已能合并 AgentRun/TaskQueue，但 UI 上仍有少量旧任务字段需要继续清理。
3. 学生档案摘要仍需增强：下一步补正在执行的 learning thread、疲劳/完成率和会话摘要，不把完整历史或思考内容塞进上下文。
4. 复习队列仍需真机恢复验证：前后台、模型失败、重复点击、退出重进和交卷后刷新。
