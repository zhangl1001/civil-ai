# 编码质量与工程规范

> 状态：生效  
> 上位规范：[模块化分层与组合编码标准](./modular-architecture-standard.md)  
> 原则：类型在边界收紧，规则在领域集中，副作用在适配器隔离，失败可诊断，行为可测试。

## 1. TypeScript

- 启用 `strict`，逐步开启 `noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。
- 禁止新增显式 `any`；外部输入使用 `unknown`，通过 parser/schema 转换。
- 公开 API、Use Case、Repository Port 和复杂函数写明确返回类型。
- 使用判别联合表达状态，不用多个可能互相矛盾的 boolean。
- 业务 ID 使用 branded type；时间和数值变量带单位后缀。
- 稳定闭集使用 `as const + union + parser`，不散落字符串。
- 不使用非空断言掩盖生命周期问题；确有不变量时由构造器或 guard 保证。
- 领域对象避免可变共享引用，Command/DTO 默认只读。

## 2. 命名和文件

- 代码标识使用英文；用户可见中文由 Presenter/Message Catalog 提供。
- Use Case 使用动词，如 `SubmitPracticeUseCase`；Policy 使用规则名；Repository 使用聚合名。
- boolean 使用 `is/has/can/should`；时间使用 `createdAt/durationMs`；集合使用复数。
- 一个文件围绕一个主要职责。出现提示词、网络、解析、校验、落库混在一起时必须拆层。
- 不用 `CommonService/Helper/Utils/Manager` 隐藏不明确职责。
- 注释解释原因、约束和非显然权衡，不复述代码。

## 3. 函数和领域逻辑

- Domain 函数保持纯净，Clock、IdGenerator、随机源和外部能力通过 Port 注入。
- 规则返回类型化 Decision/Result，并携带 reason code，不只返回 boolean。
- Application Use Case 负责权限、幂等、事务和跨模块编排，不包含 UI 文案。
- Adapter 负责格式转换和副作用，不决定教学业务。
- 避免深继承；使用小接口、组合、Policy 和 Registry。
- 公共抽象必须有两个以上稳定使用场景或明确领域合同，不能只为减少几行代码。

## 4. 边界解析

以下入口一律视为不可信：

- AI 返回。
- SQLite/IndexedDB Row。
- Router query。
- 表单输入。
- 本地文件、导入包和通知 payload。
- Provider 响应和系统插件结果。

边界必须执行：类型解析、枚举校验、范围校验、版本校验和错误映射。解析完成后 Domain 内不再到处 `String/Number/trim` 防御。

## 5. 异步、取消和并发

- 所有长操作接受 `AbortSignal` 或领域 Cancel Token。
- Promise 必须 await、return 或显式 `void` 并由统一错误通道接管。
- 不在长网络请求期间持有 SQLite 事务。
- 并发使用调度器和资源锁，不在业务页面直接 `Promise.all` 写同一聚合。
- 超时、取消、限流、认证、Schema 和领域错误分开处理。
- 重试只用于可重试错误，带预算、退避、抖动和幂等检查。
- 流式写入节流，结束、取消和失败都执行最终状态 flush。

## 6. 数据库

- SQL 参数化，不拼接用户和 AI 输入。
- Repository 不返回 Row，不接受页面 DTO 直接落库。
- 核心写入通过 Unit of Work；事务保持短小。
- migration 前向、编号、可检测；失败立即中止，不静默 catch。
- 表必须明确主键、外键、删除策略、非空、范围和唯一约束。
- 常用 Query 必须有索引依据和分页；禁止页面触发全表扫描。
- JSON 列进入/离开 Repository 时使用版本化 Schema。
- 投影必须带算法版本和输入水位线，可重算。

## 7. Vue 和 Pinia

- 页面负责路由用例和布局组合，不放领域算法、SQL、Prompt 和 Provider 解析。
- Feature Store 只保存 Query 结果和 UI 状态，不成为第二事实源。
- 进入页面、目标 ID 改变和 Outbox 提交事件后重新 Query。
- 公共组件使用类型化 props/events；不得读取任意全局 Store 完成隐藏业务。
- 列表 key 使用稳定业务 ID，不使用 index。
- watcher 必须说明副作用、取消旧请求并在卸载时清理。
- Teleport、全局事件、pointer listener 和 timer 必须成对释放。
- 样式使用 token；页面不新增魔法颜色、字号、z-index 和 safe-area 公式。

## 8. AI Runtime

- 页面和普通 Service 禁止构建 system prompt。
- Prompt/Skill/Tool/Schema 按版本从 Registry 解析。
- Provider Adapter 是唯一解析供应商原始响应的位置。
- AI 输出先 staging，再经过 Schema/Domain/Quality Validator，最后提交。
- Agent Tool 只能调用 Application Use Case，不访问 Repository 实现。
- 工具调用携带 run/workflow/session/resource ID 和幂等键。
- 不保存或转发隐藏思考过程。
- Agent 所有循环、token、工具次数、重试和费用都有硬预算。

## 9. 错误和日志

- 抛出/返回类型化 `AppError`，不按中文错误字符串驱动业务分支。
- 用户文案与诊断详情分离；UI 显示可操作的信息。
- 禁止空 catch；忽略可预期错误时写明确 reason。
- 生产代码不散落 `console.log`，使用结构化 Logger Port。
- 日志不记录 API Key、完整个人档案、完整作答和未脱敏 Provider payload。
- 每条错误关联 run/task/workflow/resource ID，便于本地诊断。

## 10. 安全

- 密钥只经 Credential Port 访问，不进入普通配置 DTO。
- HTML/SVG/URL 统一走内容安全策略。
- 导入包、元数据包和备份先验证版本、哈希和大小。
- 高风险命令显式确认，确认状态绑定具体参数哈希，参数改变后确认失效。
- 不向 Agent 暴露任意 SQL、文件系统、网络和系统命令。

## 11. 测试要求

- Domain Policy：表驱动单测和边界值。
- Repository：SQLite/IndexedDB 合约测试、事务、约束和幂等。
- Application Use Case：成功、失败、重试、并发冲突和权限。
- AI：Prompt 快照、Provider 回放、Schema、工具循环和故障注入。
- Vue：组件状态、事件、键盘、安全区和关键用户流程。
- Renderer：Markdown/Table/SVG/所有题型 fixture 与视觉回归。
- 修复缺陷必须增加能复现该缺陷的测试或 fixture。

## 12. 提交质量门槛

每批代码至少通过：

```text
typecheck
unit tests
architecture boundary tests
schema/migration tests（涉及数据时）
build
targeted UI/Provider fixtures（涉及对应模块时）
```

核心链路改动还需检查：

- 是否新增双事实源。
- 是否绕过模块公开 API。
- 是否遗漏取消、重试、恢复和幂等。
- 是否引入无版本 Prompt/Schema/Policy。
- 是否对真机 safe-area、键盘和前后台行为有影响。
- 是否有不必要的 AI 调用和全量查询。

## 13. Definition of Done

- 行为、数据所有权和失败路径清晰。
- 无新增 `any`、魔法业务 code、无单位阈值和页面级 Provider/SQL/Prompt。
- 边界输入已解析，错误可诊断。
- 测试覆盖本次风险，不只验证 happy path。
- 文档、Schema、Manifest 和实现版本一致。
- 未完成项显式记录，不用兼容分支或 TODO 掩盖。
