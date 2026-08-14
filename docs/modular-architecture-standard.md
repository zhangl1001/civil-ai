# 模块化分层与组合编码标准

> 状态：生效  
> 适用范围：TypeScript、Vue、Capacitor/iOS 插件、SQLite、AI Runtime、提示词、Skills、Tools 和测试。  
> 架构形态：本地优先的模块化单体（Modular Monolith）+ Ports/Adapters + 纵向业务切片。

## 1. 总原则

所有编码按业务类别和功能类别拆成不同模块，再按层级通过稳定合同组合：

```text
业务决定模块边界
不变量决定数据和写入所有权
功能类别决定可复用能力
层级决定依赖方向
合同决定组合方式
Composition Root 决定运行时装配
```

“自由组装”不等于任意 import。只有公开合同、事件、Port、Registry Slot 和组件 Slot 可以被组合；模块内部实现默认不可见。

## 2. 两个拆分维度

### 2.1 业务模块

围绕独立业务事实和规则拆分：

以下名称对应当前公考参考应用的代码边界。可复用基础能力通过公开合同与这些领域模块协作，不得把 `exam`、题型或公考评分规则反向写入通用 Agent、证据、任务、渲染和持久化能力。

```text
candidate       考生、考试周期、目标和现实约束
curriculum      元数据、能力图谱、题型和 rubric
evidence        会话、作答、评分事实和证据纠错
student-model   掌握轨迹、预测分和能力投影
teaching        学习主线、教学干预和教学策略
planning        周期计划、日计划和调整
content         讲义、题组、题目和内容质量
tutor           Tutor Agent、会话、主动干预和用户确认
task            工作流、任务、锁、检查点和 Outbox 消费
```

### 2.2 功能能力模块

为多个业务模块提供非业务能力：

```text
database            SQLite/IndexedDB、事务和 migration
ai-runtime          Agent、Provider、Prompt、Skill、Tool 和 Model Router
content-rendering   Markdown、Table、SVG、Image 和 Formula
design-system       tokens、primitives、overlay 和 layout
notifications       iOS 本地通知
security            Keychain、加密、脱敏和导出
observability       指标、日志和诊断
platform            Capacitor、音频、生命周期和文件资产
```

功能模块不能拥有考试业务规则。例如 `database` 不判断掌握，`ai-runtime` 不决定错因是否生效，`design-system` 不读取计划状态。

## 3. 模块内分层

每个业务模块按需包含：

```text
contracts/
  对外 Command、Query、DTO、Event、Port

domain/
  Entity、Value Object、Policy、State Machine、Invariant

application/
  Use Case、事务边界、编排、授权和幂等

adapters/
  Repository、Provider、平台实现和序列化

presentation/
  Feature Store、Presenter、业务组件和页面组合
```

依赖方向：

```text
presentation → application → domain
adapters ────────────────→ contracts/domain ports
composition-root → concrete adapters
```

Domain 不依赖 Vue、Pinia、SQLite、Capacitor、AI Provider、DOM 和系统时间实现。

## 4. 模块公开合同

每个模块只有 `public.ts` 或 `index.ts` 作为公开入口，明确导出：

- Commands 和 Queries。
- 只读 DTO。
- Domain Events。
- 需要外部实现的 Ports。
- 可注册的扩展 Manifest。
- 页面允许使用的业务组件。

禁止：

- 跨模块导入 `internal/`、Repository 实现和数据库 Row。
- 通过相对路径穿透另一个模块目录。
- 为了方便把全部类型重新导出。
- 在 `shared/common/utils` 放没有明确所有者的业务逻辑。

## 5. 数据所有权

每张核心表只有一个业务模块拥有写权限：

| 表/聚合 | 写入所有者 | 其他模块使用方式 |
|---|---|---|
| exam_cycles/targets/constraints | candidate | Query/Event |
| metadata/capability/policy/rubric | curriculum | Query/Version reference |
| sessions/attempts/grading/evidence | evidence | Query/Event |
| mastery/score projections | student-model | Query/Event |
| learning_threads/interventions | teaching | Command/Query/Event |
| study/daily plans | planning | Command/Query/Event |
| lectures/questions/question_sets | content | Command/Query/Event |
| tutor sessions/actions/nudges | tutor | Command/Query/Event |
| tasks/steps/outbox delivery | task | Command/Query/Event |

跨模块事务由 Application Use Case 通过 Unit of Work 和各模块 Repository Port 编排，不能让一个 Repository 顺手更新其他模块表。

## 6. 组合机制

### 6.1 直接组合

同一用例内的同步强一致操作，通过 Application Service 调用明确 Port，并在一个 Unit of Work 中提交。

### 6.2 事件组合

提交后触发的投影、页面刷新、主动信号和后续任务，通过 Domain Outbox Event 组合。Consumer 幂等，不假设执行顺序之外的隐藏状态。

### 6.3 Registry 组合

可扩展但有稳定类型的能力通过 Registry：

```text
AssessmentPolicyRegistry
QuestionRendererRegistry
ContentBlockRendererRegistry
PromptRegistry
SkillRegistry
ToolRegistry
WorkflowRegistry
ProviderRegistry
```

Registry 只注册符合 Manifest 和合同的实现。业务代码按稳定 code/version 解析，不写巨大 `if/else`。

### 6.4 UI 组合

- Layout 通过 slot 组合 Header/Content/Footer。
- Overlay 通过类型化配置组合 Header/Body/Actions。
- Question Template 通过固定区域 slot 组合内容块。
- 业务组件组合 UI Primitive，不复制 Primitive 样式。

### 6.5 Composition Root

`composition-root` 是唯一知道具体实现的位置：

```text
createDatabaseAdapter()
registerRepositories()
registerDomainPolicies()
registerAIProviders()
registerSkillsAndTools()
registerContentRenderers()
registerQuestionTemplates()
createApplicationServices()
mountVueApplication()
```

Web 和 iOS 使用不同 Adapter，业务模块和 Vue Feature 不出现平台分支。

## 7. 抽象准则

### 应该抽象

- 相同业务语义、状态机和生命周期。
- 多处需要保持完全一致的不变量。
- 由稳定 code/version 选择的可替换实现。
- 页面重复实现同一种交互合同。

### 不应该抽象

- 只是颜色和布局相似的不同业务对象。
- 只有一次使用、规则尚未稳定的实现。
- 用 `entityType + json` 掩盖完全不同的数据语义。
- 用万能 Service、万能 Repository 或万能 Dialog 承载任意行为。
- 为消除几行重复创建多层继承。

优先组合和小接口，避免深继承。抽象必须减少真实复杂度，而不是把复杂度藏进配置。

## 8. 类型和枚举归属

- 业务状态和闭集枚举由所属 Domain 定义。
- 会演进的大纲、题型、rubric 和展示 code 由 Curriculum 元数据定义。
- Provider 原始类型只存在于 Provider Adapter。
- Database Row 只存在于 Repository Adapter。
- 页面使用 Query DTO，不使用 Entity 或 Row 直接双向绑定。
- 相同中文名称通过 Presenter 映射，不在模板里写多层三元表达式。

### 8.1 确定性标识分类

| 类别 | 示例 | 单一来源 |
|---|---|---|
| 领域闭集 | task status、assessment role、evidence validity、page level | 所属 Domain `as const` code + union type + DB CHECK |
| 可演进业务元数据 | 能力节点、题型目录、rubric 维度、教学策略目录 | 版本化 Metadata Repository |
| 技术标识 | route name、event type、store key、platform capability | 所属能力模块常量 |
| 展示文案 | 页面标题、状态名称、错误提示、按钮文案 | Presenter/Message Catalog |
| 规则参数 | 掌握阈值、题量比例、超时、重试、token budget | 版本化 Policy/Runtime Config |
| 文件命名 | 加密备份、用户导出、诊断包 | Export/Backup Naming Policy |

禁止把可演进元数据编译成巨大代码枚举，也禁止把稳定状态放进可随意修改的万能字典表。

### 8.2 TypeScript 约定

优先使用可运行时校验的常量对象和字面量联合，而不是散落字符串：

```ts
export const AssessmentRole = {
  Teaching: 'teaching',
  Guided: 'guided',
  Practice: 'practice',
  Retention: 'retention',
  Transfer: 'transfer',
  Anchor: 'anchor'
} as const;

export type AssessmentRole = typeof AssessmentRole[keyof typeof AssessmentRole];
```

同时提供 `isAssessmentRole/parseAssessmentRole`，外部数据必须解析后进入 Domain。数据库 migration 使用同一 code 清单生成或校验 `CHECK`，避免 TS 和 SQLite 各写一份。

ID 使用 branded type，防止把 `taskId/sessionId/threadId` 互相传错：

```ts
type TaskId = string & { readonly __brand: 'TaskId' };
type LearningThreadId = string & { readonly __brand: 'LearningThreadId' };
```

### 8.3 标题和展示名称

- 业务对象保存稳定 code 和必要的用户自定义 title，不重复保存系统中文名称。
- 页面标题由 Route Meta/Feature Presenter 统一提供。
- 模块、任务、状态、工具和错因名称通过 `LabelResolver(code, metadataVersion)` 解析。
- AI Prompt 使用稳定 code 和元数据提供的正式名称，不从 UI 文案反推业务参数。
- 用户自定义标题与系统标题分字段保存，不能覆盖系统 code。

### 8.4 文件和存储 Key

新核心业务以 SQLite ID 为定位，不再用中文文件名作为业务主键。只有导出、备份和用户可见资产需要文件名：

- `BackupNamingPolicy` 生成加密备份名。
- `ExportNamingPolicy` 生成题组、讲义和报告导出名。
- 文件名包含稳定资源类型、可读标题、时间和短 ID，处理非法字符与重复名。
- IndexedDB store、SQLite table、settings key 和通知 category 由所属基础设施模块集中定义。
- 页面和 Service 禁止直接写 `能力画像.json`、`练习统计.json`、`practice:*` 等魔法路径和 key。

### 8.5 数值和时间常量

- 教学算法参数进入版本化 Policy，不作为 `const 0.7` 散落代码。
- AI 并发、超时和重试进入 Runtime Policy。
- UI 尺寸、z-index、动效和 safe-area 进入 Design Token。
- 分页大小、缓存上限和日志保留进入 Infrastructure Config。
- 单次局部计算中含义显然的 `0/1`、数组索引等无需过度常量化。

常量名称必须表达单位，例如 `providerTimeoutMs`、`reviewIntervalDays`，禁止无单位数字。

## 9. 错误模型

统一错误外壳，不统一业务错误内容：

```ts
interface AppError {
  code: string;
  category: 'validation' | 'conflict' | 'not_found' | 'provider' | 'storage' | 'permission' | 'cancelled';
  retryable: boolean;
  userMessageKey: string;
  details?: Record<string, unknown>;
  causeId?: string;
}
```

每个模块拥有自己的错误 code。UI 通过 Error Presenter 显示；禁止到处 `String(error)` 并按中文字符串判断业务流程。

## 10. 配置和元数据

- 运行环境配置：构建/平台模块拥有。
- 用户配置：Settings/Candidate 拥有。
- 课程与策略元数据：Curriculum 拥有。
- AI Prompt/Skill/Tool Manifest：AI Runtime 元数据拥有。
- 视觉主题：Design System/Settings 拥有。

配置必须类型化、可校验、可版本化。禁止建立一个全局 settings map 保存所有业务对象。

## 11. 示例：个性化生题的组合

```text
Practice Feature
→ GenerateTargetedPracticeCommand
→ Teaching 查询活动 learning_thread
→ Student Model 查询有效掌握证据
→ Planning 提供今日约束
→ Curriculum 解析 capability/template/policy 版本
→ Content 创建 GenerationSpec
→ Task 创建 Workflow
→ AI Runtime 解析 Skill/Prompt/Tool bundle
→ Provider 生成
→ Content Validator 校验并 staging
→ Unit of Work 提交题组 + Outbox
→ Practice Query 重新读取目标题组
→ QuestionRendererRegistry 选择模板
→ ContentRenderer 渲染各结构块
```

每层只做自己的判断，任意实现可按合同替换。

## 12. 建议目录

```text
src/
  modules/
    candidate/
    curriculum/
    evidence/
    student-model/
    teaching/
    planning/
    content/
    tutor/
    task/

  capabilities/
    database/
    ai-runtime/
    content-rendering/
    design-system/
    notifications/
    security/
    observability/
    platform/

  features/
    home/
    practice/
    essay/
    interview/
    wrong-book/
    profile/

  composition-root/
    web.ts
    ios.ts
```

Feature 是用例入口和页面组合，不拥有跨域事实；Module 拥有业务；Capability 提供技术能力。

## 13. 架构检查

自动化检查至少包含：

- Domain 禁止导入 Vue/Pinia/Capacitor/SQLite/AI Provider。
- Presentation 禁止导入 DatabaseAdapter 和 Repository 实现。
- Feature 禁止跨模块导入 internal 文件。
- Provider 类型不得出现在 Application Command。
- Database Row 不得离开 Adapter。
- 页面禁止直接写核心表和构建 AI system prompt。
- Registry code/version 必须能在启动时完整解析。
- 循环依赖构建失败。
- `shared/common/utils` 新增业务代码构建失败或审查失败。
- 页面和 Service 出现未登记的 task/status/route/tool/error code 时检查失败。
- 领域算法出现未归属 Policy 的阈值和比例时检查失败。
- UI 出现未归属 Token 的 z-index、字号和状态颜色时检查失败。

建议用 TypeScript path alias、ESLint import boundary、依赖图和架构单测共同执行，不能只依赖文档自觉。

## 14. 模块设计模板

新增模块前必须写清：

```text
模块目的
业务边界与非目标
拥有的事实和不变量
公开 Commands/Queries/Events
依赖的 Ports
数据表和索引所有权
幂等、事务和并发策略
扩展点和版本策略
失败与恢复
测试合同
```

无法说明事实所有权和不变量的“模块”，通常只是文件夹分类，不是真正的业务模块。

## 15. 完成标准

- 新功能能够明确归属 Business Module、Capability 和 Feature。
- 所有跨模块调用经过公开合同，没有路径穿透。
- 业务规则只在 Domain/Policy 存在一份。
- Web/iOS、Anthropic/OpenAI、不同题型和主题通过 Adapter/Registry 组合。
- 页面只组合 Use Case、Query、业务组件和 UI Primitive。
- 模块可独立测试，替换实现不修改调用者。
- 扩展能力通过版本化 Manifest 注册，不继续扩大巨型 Service 和组件。
