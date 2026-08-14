# 前端设计系统与业务模板架构

> 文档性质：公开架构参考
> 上位约束：[Civil AI 教育 Agent 架构宪法](./architecture-constitution.md)
> 目标：统一字体、主题、布局、弹层、表单、状态和业务模板，同时保持不同业务语义的扩展能力。

> 内容渲染：Markdown、表格、SVG、图片、结构化内容块和题目 Renderer 按 [内容与 Markdown 渲染架构](./content-rendering-architecture.md) 实施。

## 1. 设计原则

前端统一不能等同于“所有页面长得一模一样”。正确分层是：

```text
Design Tokens       统一视觉语言
UI Primitives       统一基础交互
Layout Patterns     统一页面结构
Business Components 统一业务语义
Feature Views       组合具体用例
```

- 相同语义必须复用同一组件。
- 仅外观相似、业务生命周期不同的内容不能强行合并。
- 页面只组合组件和绑定用例，不定义另一套按钮、弹窗、字体和任务状态。
- 业务模板由结构化数据和元数据选择，不能从正文正则猜测。
- 真机安全区、键盘、前后台恢复和触控体验属于组件合同。

## 2. 现状取舍

保留并升级：

- `design-tokens.css` 的字体、颜色和主题变量。
- `PageHeader` 的页面层级意识。
- `BottomSheet/CenterDialog/ConfirmDialog/HeaderMoreMenu` 的弹层分类。
- `MarkdownContent` 的统一内容入口。
- `QuestionTemplateLayout` 的区域化渲染思想。
- 小猫 AI 气泡、Task Dock、工具执行区和铃铛的产品交互。

需要收敛：

- 页面内重复的按钮、表单、卡片、标题和弹层 CSS。
- 页面直接使用原生 `select/alert/confirm`。
- 弹层内容依赖 `:deep()` 猜内部类名。
- 页面自己计算安全区、底部留白和吸底高度。
- 题目、错题、历史和闪卡分别实现 Markdown/SVG/选项渲染。
- 组件通过自然语言和 progress 百分比猜任务状态。

## 3. Design Tokens

### 3.1 Token 层级

```text
Primitive Token
  原始色阶、字号、间距、圆角、时长
        ↓
Semantic Token
  text-primary、surface-sheet、status-success
        ↓
Component Token
  header-height-detail、dialog-padding、option-gap
```

页面禁止直接使用原始色值、任意字号、任意阴影和新的 z-index。

### 3.2 字体系统

统一角色而不是按页面命名字号：

| 角色 | 用途 | 建议特征 |
|---|---|---|
| `display` | 极少数关键结果 | 只用于真正的大指标 |
| `page-title` | 一级页面标题 | semibold |
| `detail-title` | 二/三级页标题 | medium/semibold |
| `section-title` | 页面分组标题 | semibold |
| `card-title` | 功能入口和列表标题 | medium |
| `body` | 普通正文 | regular，舒适行高 |
| `reading` | 长题干、申论材料、讲义 | regular，较大行高，避免粗体疲劳 |
| `secondary` | 说明和摘要 | regular |
| `caption` | 状态、时间、标签 | medium/regular |
| `metric` | 分数、数量、倒计时 | tabular nums |
| `code` | 仅代码和结构文本 | monospace |

题干、材料和解析不能继承按钮或标题粗细。`strong` 只强调局部语义，不让 Markdown 标题把整页变粗。

支持用户选择标准、较大、超大三档阅读字号；通过 token 集切换，不使用 `vw` 缩放。

### 3.3 主题系统

主题只覆盖语义 token：品牌色、画布、文字、表面、状态对比和背景资源。业务组件不识别主题名称。

自定义图片主题：

- 图片只作为 `AppCanvas` 背景资产。
- 自动生成缩略图和适配尺寸，保留原图比例。
- 计算可读性并叠加低强度实色遮罩，不使用大面积模糊导致 iOS 合成异常。
- 弹层、题目和输入区仍使用稳定语义表面，不能让背景图破坏文字对比。
- 主题偏好和图片资产属于用户设置，不属于课程元数据。

### 3.4 其他基础 Token

- 间距采用有限 scale，不允许页面出现随机 `7/11/13/19px` 组合。
- 卡片、控件、弹层使用固定圆角层级。
- 阴影只表达层级，不给每张卡片加浮起效果。
- z-index 由 `base/header/nav/fab/popover/sheet/dialog/toast/critical` 统一定义。
- 动效分 `fast/normal/slow`，支持 `prefers-reduced-motion`。
- 安全区、键盘高度、底部导航预留和吸底控件高度使用统一布局变量。

## 4. UI Primitives

基础组件不包含考试业务：

```text
UiButton            primary/secondary/ghost/danger
UiIconButton        固定触控区、tooltip/aria-label
UiInput
UiTextarea
UiSelectTrigger     打开统一选择器，不直接暴露原生样式
UiSegmentedControl
UiToggle
UiCheckbox
UiRadioGroup
UiChip/UiTag
UiStepper
UiSlider
UiStatusIcon
UiSpinner/UiSkeleton
UiDivider
UiScrollArea
```

约束：

- 所有按钮高度、图标尺寸、禁用、加载和危险状态统一。
- 图标优先使用 `lucide-vue-next`，同类动作只用一个图标映射。
- 状态使用图标、颜色和文字共同表达，不只依赖颜色。
- 题目选项不能直接复用普通按钮，使用业务级 `AnswerOption`。
- 不再用线性进度条表达离散任务状态；任务使用状态图标和步骤计数。

## 5. 布局系统

### 5.1 App Shell

```text
AppCanvas
  ├─ RouteViewport
  │   ├─ PageHeader
  │   ├─ PageContent
  │   └─ ContextFooter（按需）
  ├─ PrimaryBottomNav（仅一级页面）
  ├─ TutorAgentLayer
  └─ OverlayHost
```

底层只有一张稳定画布。页面 section 在画布上自然排版，不能把整个页面再包成一张大卡片。

### 5.2 页面层级

| 层级 | 头部 | 底部导航 | 返回行为 |
|---|---|---|---|
| 一级中心页 | 图标、标题、简述、全局任务入口 | 显示 | 切换一级导航 |
| 二级任务页 | 返回、居中标题、上下文动作 | 隐藏 | Router history，缺失则回所属中心 |
| 三级沉浸页 | 紧凑返回、任务状态、必要动作 | 隐藏 | 返回来源详情 |
| 沉浸作答页 | 最小头部或安全区工具条 | 隐藏 | 离开确认按作答状态决定 |

来源由 Router history 和显式 `fallbackRoute` 管理，不自行维护页面 index 栈。

### 5.3 页面 Pattern

```text
CenterPageLayout       首页、刷题中心、我的、模考中心
DetailPageLayout       历史详情、讲义、质量追踪
WorkspacePageLayout    行测/申论作答
DashboardPageLayout    能力画像、阶段复盘
SettingsPageLayout     设置入口与分组
```

Pattern 统一 header/content/footer/safe-area，不规定具体业务卡片。

## 6. 卡片和分组语义

不是所有内容都应放卡片：

- `PageSection`：页面功能分类，使用 H1/H2 语义标题和简述，无浮动卡片背景。
- `FeatureEntry`：进入独立功能的导航项，可使用轻量卡片。
- `MetricTile`：可比较的少量指标，保持统一尺寸。
- `TaskItem`：真实任务状态和目标资源。
- `LearningThreadCard`：当前能力主线、阶段和下一动作。
- `ContentListItem`：历史题组、讲义和复盘记录。
- `InlineFeedback`：解析、错因和教学反馈，不作为页面导航卡片。

卡片密集页面必须按业务域分组，例如“今日执行、能力突破、复习维护、评估复盘”，而不是把所有入口平铺。

## 7. 弹层分类

统一由 `OverlayHost + OverlayManager` 管理焦点、滚动锁、键盘、安全区、返回键和前后台恢复。

### 7.1 Popover

`ActionPopover` 用于头部三个点等少量就地动作：历史、删除、导出、更多设置。锚定触发按钮，不从底部弹出，不与筛选 Sheet 重叠。

### 7.2 Bottom Sheet

- `FilterSheet`：筛选、排序、题型、模块、难度和时间范围。
- `FormSheet`：新建计划、AI 配置、备考档案、自定义生题。
- `ActionSheet`：移动端互斥操作列表。
- `PickerSheet`：日期、单选和多选，不使用样式突兀的原生选择框。
- `AnswerSheet`：长材料多小题选项和申论作答，支持限定范围拖动。

Sheet 两侧和底部贴合屏幕；内容底部统一预留安全区与少量视觉间距。拖动范围、手柄、键盘避让和最大高度由组件负责。

### 7.3 Center Dialog

- `ConfirmDialog`：删除、丢弃、交卷和高风险确认。
- `ContentDialog`：闪卡、短内容详情和轻量结果。
- `FormDialog`：仅平板/大屏短表单，手机优先 FormSheet。

确认弹窗只包含明确问题、影响说明、确认和取消，不塞筛选或长内容。

### 7.4 Fullscreen/Side Overlay

- AI 对话框属于可调整高度的 `TutorWorkspace`。
- 页面目录使用侧边 `IndexRail`，不是底部 Sheet。
- 复杂历史浏览或大篇幅预览使用全屏二级页，不塞进超长弹窗。

### 7.5 Overlay 约束

- 默认只允许一个主 Modal；确认框可以作为受控二级层叠。
- 点击遮罩、关闭图标、系统返回和 Escape 行为统一。
- 危险操作关闭只能通过明确结果，不因后台切换误触。
- 弹层状态需要恢复时存业务状态，不持久化 DOM 尺寸。
- 禁止页面自行 Teleport 到 body 并定义另一套 overlay z-index。

## 8. 表单体系

```text
FormSection
FormField
FormLabel
FormHint
FormError
TextField
NumberField
SelectField
MultiSelectField
DateField
ToggleField
SegmentedField
FormActions
```

- 字段高度、标签、错误、帮助文本和必填状态统一。
- 表单值使用类型化 schema 和统一 validator，不从 DOM 字符串临时转换。
- 选择器的 option 来自领域枚举或元数据 Query，不在页面写中文三元表达式。
- 页面标题、模块名、任务状态和错误文案通过 Route Meta/Presenter/Label Resolver 提供，不在模板重复写确定性标题。
- 提交按钮由表单状态控制；异步提交有明确 pending/error/success。
- 关闭未保存表单时由通用 dirty guard 决定是否确认。

## 9. 业务组件分类

### 9.1 Candidate 与 Planning

```text
ExamCycleSummary
ScoreGapSummary
StudyConstraintForm
TodayPlan
PlanItem
LearningThreadSummary
StageTimeline
```

### 9.2 Learning 与 Assessment

```text
LectureViewer
QuestionRenderer
AnswerOption
AnswerSheet
GradingFeedback
ErrorDiagnosisPanel
MasteryStatus
ReviewDueItem
ScoreProjectionRange
```

### 9.3 Tutor 与 Task

```text
TutorBubble
TutorWorkspace
TutorMessage
ToolExecutionStrip
TaskDock
TaskList
ConfirmationRequest
ProactiveNudge
```

### 9.4 Content 与 History

```text
ContentSummary
QuestionSetHistory
LectureHistory
AttemptHistory
FlashcardReview
MarkdownDocument
```

业务组件只能调用 Feature Use Case/Query，不直接访问数据库适配器。

## 10. 题目模板管理

### 10.1 固定内容区域

所有题目统一结构块：

```text
meta
material
prompt
answer
grading
explanation
error_diagnosis
actions
```

新增区域通过内容 Schema 和 Renderer Slot 扩展，不在题干字符串中混入“查看选项并作答”等 UI 文案。

### 10.2 Renderer Registry

前端根据 `question_template_code + content_schema_version` 选择 Renderer：

```text
single_choice
visual_reasoning
shared_material_multi_question
long_passage_multi_question
data_table_analysis
essay_prompt
interview_prompt
```

Renderer Manifest 定义支持区域、交互模式、选项布局、是否使用 AnswerSheet、手势和可用批改组件。

禁止：

- 根据题干长度猜模板。
- 用正则识别“小题一/问题二/A.” 拆数据。
- 因选项含 SVG 就进入共享材料模式。
- 在错题本重新实现一套图推和 Markdown 渲染。

实践页、历史、错题本和闪卡都复用 `QuestionRenderer`；只通过 mode 控制是否显示作答、解析和错因。

### 10.3 图形和长材料

- SVG 使用统一 sanitization 和 `preserveAspectRatio`，只等比缩放。
- 图推题干和选项分别设置最大宽高，不允许横向拖动画布改变题序关系。
- 多图布局保留源顺序和分组信息，禁止 CSS 自动重排破坏规律。
- 共享材料主体占主页面，选项使用可拖动 AnswerSheet；切换小题时材料保持，prompt/选项按结构切换。
- 只有真正一份材料对应多小题才使用多题模板。

## 11. Markdown 与内容渲染

`MarkdownContent` 是全系统唯一 Markdown 入口：

- 使用成熟解析插件和 AST/Token 扩展，不自己写正则 Markdown 解析器。
- 支持标题、段落、列表、引用、表格、代码、公式扩展、受控图片和安全 SVG。
- 统一 GFM 表格的移动端策略；数据表优先列宽和可读缩放，不把普通选项变成横向表格。
- 链接、图片、SVG 和 HTML 经过 allowlist sanitization。
- `chat/reading/data/explanation` variant 只改变排版 token，不改变解析规则。
- 所有页面复用同一个内容规范和 fixture 测试集。

## 12. 状态与数据流

```text
Route
→ Feature Query/Use Case
→ Pinia Feature Store
→ Business Component
→ UI Primitive
```

- Repository 数据是事实源，Store 是页面缓存和临时交互状态。
- 页面进入、目标资源变更和任务提交事件后重新 Query。
- 弹层开关、选中 Tab 和拖动高度属于 UI state。
- 题目、任务、计划和 Agent run 不以弹层状态作为是否存在的依据。
- 公共组件通过 props/events 工作，不自行查任意业务 Repository。

## 13. Agent 前端统一模型

前端统一消费：

```text
TutorPresenceView
AgentRunView
ToolExecutionView
WorkflowTaskView
TutorMessageView
ConfirmationRequestView
TargetResourceView
```

小猫动画由 `TutorPresenceView.state` 控制；工具条、Task Dock 和铃铛分别读取自己的 View，不从同一个标题字符串复制。不同页面只传 `target_resource`，不能各写任务关联逻辑。

## 14. 组件治理

### 14.1 目录

```text
src/ui/
  tokens/
  primitives/
  overlays/
  layout/
  icons/

src/components/domain/
  candidate/
  planning/
  learning/
  assessment/
  tutor/
  content/

src/features/
  */views
  */stores
  */queries
  */use-cases
```

### 14.2 组件合同

每个公共组件必须定义：用途、不适用场景、props/events/slots、状态、尺寸、安全区、键盘、可访问性和示例。不得依赖页面里的特定 class 才能正常显示。

### 14.3 发布门槛

- 新基础样式必须先成为 token 或 primitive variant。
- 新弹层必须先归类，无法归类时说明特殊业务原因。
- 新题目展示必须注册 template/schema，不允许正文启发式判断。
- 页面新增超过两处同语义实现时必须抽取业务组件。
- 修改公共组件必须运行组件 fixture 和关键页面视觉回归。

## 15. 测试和验收

- Token lint：禁止页面新增硬编码颜色、z-index 和未批准字号。
- 组件单测：键盘、关闭、禁用、加载、错误和事件。
- Overlay 测试：安全区、输入键盘、滚动锁、后台恢复和叠层。
- Renderer fixture：所有题型、Markdown、表格、SVG、共享材料和错题模式。
- Playwright 视觉回归：小屏 iPhone、常规 iPhone、大屏和 Web。
- 动态字体：标准/较大/超大不重叠、不截断。
- 可访问性：VoiceOver label、焦点顺序、44px 触控区和对比度。
- 性能：长列表虚拟化、Markdown 缓存、图片解码和首屏查询预算。

## 16. 架构符合性标准

- 修改字体、主题、圆角和状态颜色只需要调整 token 或组件，不逐页修改。
- 每种弹层都有明确业务分类，同类内容外观和行为一致。
- 一级、二级、三级和沉浸页面使用统一布局且不浪费移动端空间。
- 题目结构由 schema/template 驱动，所有入口使用同一 Renderer。
- 页面不直接实现 Markdown、SVG、任务状态和数据库查询细节。
- Agent、工具、任务和铃铛显示同源但不混淆。
- 自定义主题不牺牲可读性和 iOS 前后台稳定性。
- 公共组件具备 fixture、视觉回归和真机验收。
