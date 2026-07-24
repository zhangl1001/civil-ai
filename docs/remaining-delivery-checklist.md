# 剩余交付任务清单

> 状态：执行中  
> 原则：以新 SQLite/IndexedDB Repository、Feature Adapter 和版本化事实链路为唯一实现路径；不再扩展旧 Service。

## A. 核心学习闭环

- [x] 新刷题中心：题组查询、真实生题、结构化内容渲染。
- [x] 新做题页：结构题干/选项、客观提交、证据与掌握度更新。
- [x] 自动下一题、答题卡、未答交卷确认；左右滑动待真机手势统一时补充。
- [x] 批改后逐题解析与错因分区展示；提交后会创建并驱动受限 Agent 批处理，AI 候选错因写回学习事实。
- [x] 新错题本、闪卡和重练流程读取同一学习事实；不再扫描 Markdown 或读取旧错题索引。
- [x] 复习队列执行实体：领取、生成关联题组、完成/失败回写、失败重试、学习会话绑定和完成回写。
- [ ] 复习队列页面恢复真机验收：前后台、模型失败、重复点击、退出重进后继续当前队列项。

## B. Agent 与对话

- [x] Agent Run、调用账本、三并发、租约恢复、退避、白名单 handler。
- [x] Skill/Tool 元数据 Registry。
- [x] AgentRun 读取 DTO：`GetAgentRunViews` 已接入 Web/iOS runtime，铃铛面板会合并展示新 AgentRun 和旧 TaskQueue。
- [x] AI 对话框任务过滤：底部任务栏只展示当前会话关联业务任务；普通聊天和其他页面任务不再兜底挤占当前聊天空间。
- [x] 对话工具调用 AgentRun 迁移桥：AI 工具执行会创建 `AgentRun`，记录 running/completed/failed；聊天工具和页面生成入口均已包进 AgentRun，旧 TaskQueue 只作为执行内核。
- [x] AgentRun 跳转桥：`GetAgentRunViews` 暴露 `linkedTaskId/toolName/chatSessionId`，铃铛内 AgentRun 可通过关联旧任务进入目标模块。
- [x] 自然语言意图识别、参数补齐和高影响操作确认：规则解析、AI classifier、缺参追问和二次确认已接入对话路由。
- [x] Agent worker 支持无模型网关的本地 handler；需要模型的 handler 通过 `requiresGateway` 显式声明，缺失网关时可审计失败。
- [x] AI 对话框顶部工具执行条优先读取当前会话 `AgentRunView`，缺少 AgentRun 时回退旧 tool message。
- [ ] 流式对话和 Task Dock 完全切到 AgentRun/View DTO；底层旧 TaskQueue 仍作为执行内核保留，UI 侧已不再只依赖它。
- [x] 普通聊天上下文清理：`ChatContextBuilder` 统一预算、截断和清洗，中断标记、失败回复和空助手消息不进入下一轮模型上下文。
- [x] 学生档案上下文：普通聊天系统提示会按需注入考试目标、分差、优先薄弱点、最近错因分布和今日计划摘要，缺建档数据时降级为空。
- [x] 会话摘要：普通聊天成功回复后写入确定性本地摘要，下一轮进入系统提示，不额外调用模型。
- [ ] Agent 取消/恢复细节和页面跳转一致性。

## C. 计划与能力提升

- [x] 掌握投影、快照、复习队列、本地每日计划提案和持久化。
- [x] 新计划中心路由。
- [x] 计划项开始/完成回写：复习计划项启动后进入 `in_progress`，交卷后按 `reviewQueueItemId` 完成。
- [x] 计划项跳过入口：绑定 `reviewQueueItemId` 的复习计划项可在计划中心标记 skipped。
- [ ] 计划项取消、失败原因展示和结果触发计划版本重排。
- [ ] 主动信号、提醒冷却、用户可控频率。
- [ ] 目标差距、预测分区间、真实模考校准。

## D. 内容与题型

- [x] ContentDocument 公共渲染器：Markdown、表格、SVG、图片、公式、callout。
- [ ] 长材料多问、资料分析图表、图推、多图分组的专用结构 Schema/Renderer/Fixture。
- [ ] 申论 Rubric、作品版本、批改证据、讲义和题目闭环。
- [ ] 面试语音资产、Rubric、追问、深度点评与任务恢复。

## E. 收敛与发布

- [ ] 日历、错题本、质量追踪、知识图谱等读取侧切到新 Query DTO。
- [ ] 删除已迁移页面对应旧 Service/Store/Repository 路径。
- [ ] iOS SQLite 真机、前后台、杀进程、离线、限流、键盘和安全区回归。
- [ ] 数据库加密、备份/恢复、导出与彻底删除。
- [ ] IPA 归档、安装验证、App Store 发布检查。

## 当前入口

下一步优先做 B 线的对话工具 handler 化和学生上下文预算，再做 A/C 的真机恢复、计划重排和主动提醒。
