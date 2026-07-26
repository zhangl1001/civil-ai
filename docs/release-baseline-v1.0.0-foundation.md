# v1.0.0-foundation 封版记录

> 封版日期：2026-07-26
> 远端分支：`feature/vue-migration-refactor`
> 远端标签：`v1.0.0-foundation`
> 基线提交：`3c2ce32`
> 上一个父提交：`8abca71`

## 1. 封版范围

本版本固化当前已经完成的 Vue + Capacitor iOS + SQLite/IndexedDB 业务底座：

- Vue 页面和公共设计系统。
- iOS 真机 SQLite 主数据层，IndexedDB Web/调试 fallback。
- 统一 Repository、UnitOfWork、迁移和数据库恢复机制。
- Agent Run、工作池、任务状态、消息中心和任务跳转。
- 对话 Agent Loop、工具调用、上下文预算和当前 run 临时工具明细。
- 结构化讲义、题目、解析、错因和 Markdown 渲染。
- 建档、能力轨迹、每日计划、客观题生成、答题、批改、错因和复习底座。
- 交卷核心事务、Outbox 后处理和异常恢复。

## 2. 当前版本明确不包含

以下内容进入后续版本，不在 `v1.0.0-foundation` 中混入：

- 独立真题来源、试卷和导入模型。
- 真题扫描 Agent 和局部确认流程。
- 真题参考包和 AI 变式题 lineage。
- 完整主动私教 Observe/Diagnose/Propose/Assess 循环。
- 全科目初始能力基线覆盖。
- 真题校准后的预测分和能力模型升级。

后续方案见：[真题基础设施与主动私教闭环改造计划](./true-question-and-proactive-tutor-redesign-plan.md)。

## 3. 封版验证

封版前已完成：

```text
cd web && npm run build
npm run ios:sync
xcodebuild -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination 'id=00008130-000E0C990289001C' \
  -derivedDataPath build/ios/device-debug \
  CODE_SIGNING_ALLOWED=YES build
```

结果：

```text
Web production build: passed
Architecture/content/prompt/provider/agent/learning checks: passed
iOS Capacitor sync: passed
Xcode device Debug build: BUILD SUCCEEDED
```

构建产物：

`build/ios/device-debug/Build/Products/Debug-iphoneos/App.app`

## 4. 基线使用规则

- 后续新功能从 `v1.0.0-foundation` 创建分支或提交开始。
- 不在基线提交中直接追加真题表和主动私教逻辑。
- 不回滚或恢复已删除的旧 Python Agent、旧 HTML 页面、旧 JSON/Markdown 数据层。
- 每个后续版本必须保持新数据库 clean break，不实现旧业务双读和双写。
- 真题改造的每个阶段单独提交，并在计划文档中记录验收结果。
