# 内容与 Markdown 渲染架构

> 状态：设计完成，待实施  
> 适用范围：AI 对话、讲义、题干、材料、选项、解析、错因、申论、面试、每日积累、历史和闪卡。  
> 上位设计：[前端设计系统与业务模板架构](./frontend-design-system-architecture.md)

## 1. 核心边界

Markdown 是内容块的富文本格式，不是业务数据协议，也不是题目模板识别器。

```text
Question Schema
  决定材料、小题、选项、答案、批改和解析区域
        ↓
Question Renderer
  决定区域位置和交互
        ↓
Content Renderer
  渲染每个区域中的 Markdown/Table/SVG/Image/Formula
```

禁止从 Markdown 正文中用正则推断题目区域、共享材料、小题边界、答案或批改状态。

## 2. 当前组件问题

现有 `MarkdownContent.vue` 同时负责：

- 将任意 `unknown` 转成字符串。
- 识别 AI 中断标记。
- 配置并调用 `marked`。
- DOMPurify HTML/SVG 白名单。
- 用正则包装表格。
- 用正则修改 SVG 尺寸。
- 所有 Markdown 变体样式。

这会造成：

- 上游传错对象时被渲染成 `[object Object]`，真实数据问题被掩盖。
- 表格和 SVG 扩展依赖 HTML 字符串正则，容易破坏合法结构。
- 不同页面无法只复用解析或安全能力。
- 全局 `marked.setOptions` 使测试和不同配置相互影响。
- SVG 多实例 ID、外部引用和比例策略难以治理。
- 单组件继续增长，任何样式调整都可能影响全部内容类型。

## 3. 内容数据合同

### 3.1 ContentDocument

AI 和 Repository 对复杂内容使用版本化结构块：

```ts
interface ContentDocument {
  schemaVersion: string;
  blocks: ContentBlock[];
}

type ContentBlock =
  | MarkdownBlock
  | DataTableBlock
  | SvgDiagramBlock
  | ImageBlock
  | FormulaBlock
  | CalloutBlock;
```

### 3.2 Block 职责

```text
MarkdownBlock    段落、标题、列表、引用、行内代码等普通富文本
DataTableBlock   表头、行、单位、来源、对齐和列类型
SvgDiagramBlock  图推、图表和示意图，带 viewBox、分组、顺序和说明
ImageBlock       本地/受控远端图片资产引用和替代文字
FormulaBlock     公式源码和显示模式
CalloutBlock     方法、陷阱、错因、提示和结论等语义强调
```

资料分析核心表格优先使用 `DataTableBlock`，图推优先使用 `SvgDiagramBlock`。GFM 表格和内联 SVG 仍可兼容普通 Markdown 内容，但不能作为题目结构的唯一合同。

### 3.3 类型边界

- `MarkdownRenderer` 只接收 `string`，不接收 `unknown`。
- `ContentAdapter` 在 Repository/AI 输出边界把旧式 string 或合法结构转换为 `ContentDocument`。
- 类型不合法时返回 `InvalidContentBlock` 诊断，不使用 `String(value)` 隐藏错误。
- AI 输出进入数据库前先通过 Content Schema；前端不承担修复 AI JSON 的职责。

## 4. 渲染流水线

```text
Raw Content
→ ContentAdapter
→ ContentSchemaValidator
→ ContentDocument
→ BlockRendererRegistry
→ 对应 Block Renderer
→ 安全 DOM/Vue Node
→ Typography Variant
```

Markdown 子流水线：

```text
Markdown string
→ Source Policy
→ isolated Marked Engine
→ token/AST plugins
→ HTML
→ Sanitizer Policy
→ DOM transforms
→ RenderedMarkdown
```

表格 wrapper、链接属性和标题 ID 等结构在 parser renderer/plugin 阶段完成，不在最终 HTML 上使用通用正则替换。

## 5. 模块目录

```text
src/content-rendering/
  contracts/
    ContentDocument.ts
    ContentSchema.ts
    RenderContext.ts

  adapters/
    ContentAdapter.ts
    AIContentAdapter.ts
    RepositoryContentAdapter.ts

  registry/
    BlockRendererRegistry.ts
    RendererManifest.ts

  markdown/
    MarkdownEngine.ts
    MarkdownParser.ts
    MarkdownSanitizer.ts
    MarkdownCache.ts
    plugins/
      gfmTablePlugin.ts
      safeLinkPlugin.ts
      headingPlugin.ts
      taskListPlugin.ts
      interruptionPlugin.ts

  blocks/
    MarkdownBlockRenderer.vue
    DataTableRenderer.vue
    SvgDiagramRenderer.vue
    ImageRenderer.vue
    FormulaRenderer.vue
    CalloutRenderer.vue
    InvalidContentRenderer.vue

  security/
    HtmlPolicy.ts
    SvgPolicy.ts
    UrlPolicy.ts
    AssetPolicy.ts

  variants/
    content-typography.css
    chat.css
    reading.css
    data.css
    explanation.css

  components/
    ContentDocumentRenderer.vue
    MarkdownRenderer.vue

  fixtures/
    markdown/
    tables/
    svg/
    documents/
```

题目业务渲染单独放置：

```text
src/question-rendering/
  QuestionRenderer.vue
  QuestionRendererRegistry.ts
  regions/
  templates/
    SingleChoiceTemplate.vue
    VisualReasoningTemplate.vue
    SharedMaterialTemplate.vue
    LongPassageTemplate.vue
    DataAnalysisTemplate.vue
  fixtures/
```

`question-rendering` 依赖 `content-rendering`，反向依赖禁止。

## 6. Markdown Engine

### 6.1 实例隔离

- 封装 `marked` 实例和 options，不调用影响全局的配置。
- Engine 由工厂按 renderer version 创建。
- 解析输出包含 `html/warnings/contentHash/rendererVersion`。
- 解析失败返回可展示降级结果和诊断，不抛到整个页面白屏。

### 6.2 插件职责

- GFM Table Plugin：输出语义 table 和统一 scroll/scale 容器。
- Safe Link Plugin：补充 `rel`，拦截不允许协议，区分内部和外部链接。
- Heading Plugin：生成作用域内稳定锚点，不污染全局 ID。
- Task List Plugin：只读展示，不能变成业务复选框。
- Interruption Plugin：将 Agent 中断状态转换为独立状态块，不在 Markdown 字符串尾部查多种自然语言。

中断状态长期应作为 `TutorMessage.status = cancelled` 存储，Markdown 中的旧停止标记仅作为开发期迁移路径，最终删除。

### 6.3 Parser 扩展约束

- 插件只处理 Markdown 语法，不读取考试业务 Store。
- 插件按 Manifest 声明顺序、依赖和版本。
- 新语法必须有 fixture、sanitization 和移动端样式。
- 禁止页面自行修改 `marked` renderer。

## 7. 安全策略

### 7.1 HTML

- 默认不信任 AI、用户和导入内容中的 HTML。
- DOMPurify 配置集中在 `HtmlPolicy`，组件不能追加白名单。
- 禁止 script、style、iframe、form、事件属性和任意 data attribute。
- 原生 checkbox 仅作不可编辑展示，业务交互使用 Vue 组件。

### 7.2 URL 与图片

- 允许明确协议和本地资产引用，拒绝 `javascript:` 等危险 URL。
- 远端图片默认通过用户触发或受控 Asset Loader，不在后台静默泄露请求信息。
- 图片必须有 alt、最大尺寸、加载失败和占位状态。
- 大图按原比例缩放，不强行拉伸。

### 7.3 SVG

- SVG 先解析为 DOM，再按 `SvgPolicy` 清理和规范化，不用标签正则修改几何。
- 缺少 viewBox 且有合法 width/height 时生成 viewBox。
- 固定 `preserveAspectRatio="xMidYMid meet"`，CSS 只限制最大宽高。
- 每个 SVG 实例对 `id/clipPath/mask/gradient/use` 做作用域重命名，避免多题同 ID 串引用。
- 禁止外部 `use`、外部图片、脚本、事件和不受控 URL。
- 保留 `transform` 和源 DOM 顺序，防止图推规律被改变。
- 渲染失败显示“图形暂不可用”及报告入口，不直接展示源码。

## 8. Block Renderer

### 8.1 DataTableRenderer

- 接收结构化 headers/rows，不解析 Markdown 字符串猜表头。
- 支持单位、caption、对齐、数字列和来源。
- 小表自适应宽度；大表使用明确的局部横向滚动或列聚焦，不让整页横向移动。
- sticky 首列/表头只在确有必要的资料分析模板启用。
- 表格数字使用 tabular nums，保证比较直观。

### 8.2 SvgDiagramRenderer

- `fit="contain"` 等比缩放，设置题干图和选项图各自 max width/height。
- 图推选项默认纵向题目列表中的规则网格，不因 SVG 存在切换长材料模式。
- 组图保留 `group/sequence`，六图分组等题型由 template manifest 指定布局。
- 旋转、对称和比例相关题不允许非等比 CSS 尺寸。

### 8.3 CalloutRenderer

方法、解析、错因和陷阱共享基础 Callout 外观，但保留不同语义 variant：

```text
method
explanation
error
trap
tip
success
warning
```

业务层传入枚举，不根据标题文字或颜色推断类型。

## 9. 排版 Variant

解析规则全局一致，variant 只影响排版：

| Variant | 场景 | 特征 |
|---|---|---|
| `default` | 普通说明 | 标准正文 |
| `chat` | AI 消息 | 紧凑标题和段间距，无蓝色大底 |
| `reading` | 题干、材料、讲义 | 较舒适字号和行高，正文 regular |
| `data` | 表格和资料分析 | 数字对齐、表格优先 |
| `explanation` | 解析和错因 | 结构层次明确、强调克制 |
| `compact` | 列表摘要 | 限制标题层级和间距 |

Variant 样式按 CSS module 拆分，不把几百行 `:deep()` 留在单个 Vue 文件中。

## 10. 缓存与性能

- 解析缓存键：`content_hash + markdown_engine_version + sanitizer_policy_version`。
- variant 不改变 HTML 结构时复用同一解析结果。
- 长列表只渲染可见项，历史列表先展示纯文本摘要，展开后再解析正文。
- SVG 和图片解码延迟到可见区域。
- AI 流式输出按节流频率增量重渲染；完成后生成最终缓存。
- 内容更新或 Renderer 版本变化自动失效，不手工清缓存。

## 11. 错误和诊断

错误分层：

```text
invalid_input_type
schema_invalid
markdown_parse_failed
unsafe_content_removed
asset_load_failed
svg_invalid
unsupported_block
renderer_missing
```

- 用户看到简洁降级状态，不看到 JSON、SVG 源码和堆栈。
- 调试日志记录 content ID、block index、schema/renderer version 和错误码，不默认记录完整敏感正文。
- AI 生成内容在入库前失败属于内容质量问题；历史内容在前端失败属于 Renderer/数据完整性问题，两者不能混报。

## 12. 扩展流程

新增内容块或 Markdown 能力必须：

1. 定义业务使用场景，确认 Markdown 是否足够。
2. 更新 `ContentSchema` 和元数据版本。
3. 添加 Renderer Manifest 和组件。
4. 添加安全策略。
5. 添加 iPhone/Web fixture 和视觉回归。
6. 更新 AI 输出 Schema 和 Prompt 兼容声明。
7. 发布新版本，不覆盖正在执行的工作流合同。

只增加视觉样式时不应创建新 Block；只有数据语义、交互或安全策略不同才扩展类型。

## 13. 实施顺序

### Render Phase 1：拆引擎

- [ ] 抽出 `MarkdownEngine/MarkdownSanitizer/MarkdownCache`。
- [ ] 移除组件中的 `unknown → String` 和全局 marked 配置。
- [ ] 将表格 wrapper、链接和中断状态改成插件/业务状态。
- [ ] 建立现有 Markdown fixture 防回归。

### Render Phase 2：结构块

- [ ] 建立 ContentDocument 和 ContentBlock schema。
- [ ] 建立 Renderer Registry 与各 Block Renderer。
- [ ] 将资料表格、图推 SVG、图片和 Callout 迁到结构块。
- [ ] 在 AI 输出校验和 Repository 边界接入 ContentAdapter。

### Render Phase 3：题目统一

- [ ] Practice/WrongBook/History/Flashcard 全部改用 QuestionRenderer。
- [ ] 共享材料、多小题、长阅读和资料分析改为 schema/template 选择。
- [ ] 删除题干正则拆分和页面专用 SVG/Markdown 逻辑。

### Render Phase 4：质量与性能

- [ ] 补 SVG ID 隔离、URL/图片策略和降级报告。
- [ ] 建立解析缓存、可见区延迟渲染和流式节流。
- [ ] 完成所有题型、字号、主题和真机视觉回归。

## 14. 完成标准

- `MarkdownContent.vue` 不再是包含解析、安全、结构变换和全样式的巨型组件。
- 上游传错类型会明确失败，不再出现 `trim is not a function` 或 `[object Object]`。
- Markdown、表格、SVG、图片和公式可以独立扩展与测试。
- 题目区域完全由 Schema/Template 管理，不从 Markdown 猜结构。
- 同一内容在练习、错题、历史和闪卡中使用同一 Renderer。
- 图推只等比缩放、顺序稳定、多实例 SVG 不串引用。
- 解析、安全、样式和业务模板层次清晰，修改一层不会无意破坏其他层。
