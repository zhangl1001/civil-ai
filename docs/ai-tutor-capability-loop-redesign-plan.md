# AI 私教能力提升闭环重构计划

> 状态：核心底座与主要业务闭环已实现，进入真机验收和算法校准
> 决策：产品尚未上线，数据层和业务层采用 clean break，不兼容旧业务模型，不双写旧 JSON，不保留错误抽象。  
> 平台：iOS 本地 SQLite 为主，Web 使用 IndexedDB 适配器，仅 AI 请求访问用户配置的模型服务商，不依赖自建云服务。

> 架构约束：本计划受 [Zhangl Agent 架构宪法](./architecture-constitution.md) 约束；冲突时以宪法为准，重大例外必须写 ADR。

> AI 服务：模型接入、Agent Runtime、提示词、上下文、工具、工作流和供应商适配按 [AI 私教服务架构设计](./ai-service-architecture.md) 实施。

> 前端系统：字体、主题、布局、弹层、表单、业务组件和题目模板按 [前端设计系统与业务模板架构](./frontend-design-system-architecture.md) 实施。

> 内容渲染：Markdown、表格、SVG、图片、结构化内容块和题目 Renderer 按 [内容与 Markdown 渲染架构](./content-rendering-architecture.md) 实施。

> 编码标准：所有业务模块、功能能力、分层、公开合同、Registry 和运行时装配按 [模块化分层与组合编码标准](./modular-architecture-standard.md) 实施。

> 核心模块：内容生成、消息中心和个人能力分析按 [核心业务模块规划](./core-business-modules-plan.md) 划分数据所有权、接口、事件和性能预算。

## 1. 产品定位

本产品不是 AI 生题工具，也不是题库套壳，而是一个持续理解考生、制定策略并对学习结果负责的个人 AI 私教系统。

核心承诺：

> 不追求让考生刷更多题，而是用尽可能少但足够精准的讲解、训练和复习，持续解决真实能力缺口，最终达到目标分数。

产品必须让考生持续感受到：

- AI 记得我为什么错。
- AI 知道我当前处于什么备考阶段。
- AI 清楚我距离目标分还有多远。
- AI 知道今天为什么学习这些内容。
- AI 会根据我的思考、决策和训练效果改变教学方式。
- AI 不会因为偶然答对两题就错误判断我已经掌握。
- AI 会在合适的时间安排复习和迁移验证。

题目、讲义、批改、错题本和计划都是教学闭环的执行工具，不是产品中心。

## 2. 不可妥协的设计原则

### 2.1 AI 与代码的职责

AI 负责：

- 教学决策和计划解释。
- 个性化讲解与追问。
- 训练编排建议。
- 题目、讲义和变式内容生成。
- 主观题批改。
- 错因候选分析。
- 阶段复盘、陪伴和激励。

代码负责：

- 事实数据和数据正确性。
- 能力计算和可信度计算。
- 掌握状态迁移。
- 题量、时间和疲劳约束。
- 复习时间计算。
- 计划版本和任务状态。
- 事务、幂等、索引和可靠落库。
- AI 输出校验和低置信度确认。

AI 不能直接修改掌握度、计划完成度、预测分和复习状态。AI 只能提交结构化提案，由应用服务校验后写入。

### 2.2 事实源与投影

- `learning_evidence` 是个人学习事实源，尽量不可变。
- `mastery_tracks`、能力画像和预测分是可重算投影。
- `daily_plans` 是当时的教学决策记录，必须版本化。
- AI 对话不是业务事实源。
- AI 思考过程不落库、不进入后续上下文。
- AI 结论必须转化为结构化、可验证、带置信度的业务数据。

### 2.3 不做全量事件溯源

系统不采用完整 Event Sourcing。只把学习证据设计为不可变事实，其他业务使用普通关系模型和事务更新，避免个人单机产品过度复杂。

### 2.4 不兼容旧业务模型

以下旧模型不再作为新系统的数据源：

- `AbilityProfile` 的模块级 `total/correct/accuracy`。
- `ExamPlan.tasks[date]` 内嵌每日计划。
- `LearningEvent` 的粗粒度聚合统计。
- `WrongItem.nextReviewAt` 的简单倍数计算。
- JSON/Markdown 文件驱动能力画像、计划和错题状态。
- 页面直接查询 `database`。

开发阶段切换到新的数据库名称和 schema。测试设备允许清空开发数据，不实现旧数据迁移。

硬性删除项：

- 不编写 legacy data importer。
- 不回填旧 SQLite、IndexedDB、JSON 或 Markdown 数据。
- 不实现新旧数据双读。
- 不实现新旧业务双写。
- 不为旧 ID、字段、目录或文件格式保留兼容分支。
- 首次启用新核心时直接创建空的新数据库，由用户重新建档和诊断。

### 2.5 能力节点，而不只是知识点

产品目标是提升考生能力，不是让考生记住更多知识标签。系统主图谱使用 `capability_nodes`，统一表达：

- 知识：增长率、削弱论证、公文格式。
- 认知能力：信息提取、论证分析、归纳概括。
- 解题技能：估算、排除、材料定位、结构搭建。
- 考试策略：时间分配、跳题、检查和答题顺序。
- 表达能力：准确、完整、条理、语言规范。

知识点掌握是能力模型的一部分，不能代表全部个人能力。

### 2.6 长期学习主线

每日计划不能代替长期教学上下文。每次围绕薄弱点深挖必须建立 `learning_thread`，持续记录：

```text
为什么开始
当前核心能力缺口
前置能力缺口
当前教学阶段
已经尝试的教学方式及效果
退出条件
下一教学动作
暂停、恢复和完成原因
```

AI 私教的当前上下文首先读取活动 learning thread，再读取相关证据，避免每天重新猜测用户正在学什么。

### 2.7 训练与验证隔离

教过的例题、同模板题和带提示练习不能直接证明掌握。系统必须区分：

```text
teaching     教学示例
guided       引导练习
practice     独立训练
retention    间隔保持验证
transfer     迁移验证
anchor       独立锚定评估
```

只有未泄露答案、无提示、内容足够新颖的 `retention/transfer/anchor` 证据，才能推动能力节点进入 `mastered`。

### 2.8 可纠正的不可变证据

学习证据原则上追加而不是修改，但题目质量错误、AI 误判和用户纠正必须可以撤销。采用追加纠错记录：

- 原证据不物理删除。
- 新增 `evidence_corrections` 标记 `invalidate/supersede`。
- 能力投影重算时忽略已失效证据。
- 失效原因、操作者和算法版本可追溯。

否则一道答案错误的 AI 题会长期污染考生画像。

### 2.9 不同科目使用不同评估策略

行测、申论和面试不能共享一套掌握公式：

- 行测以客观正确性、速度、保持和迁移为主。
- 申论以阅读、提炼、结构、论证、对策和表达 rubric 为主。
- 面试以内容、结构、表达、语音节奏、临场稳定性和追问表现为主。

统一的是证据、计划、教学和复习框架；不同的是 `AssessmentPolicy`、`MasteryPolicy` 和 `ScoreProjectionPolicy`。

### 2.10 用户拥有最终控制权

- 用户可以质疑和纠正 AI 错因。
- 用户可以跳过、推迟或调整计划。
- 系统必须解释计划变更原因。
- AI 不能用“为你好”为由强制改变考试目标和学习安排。
- 用户拒绝某种教学方式后，应进入冷却期而不是反复建议。

### 2.11 隐私和模型服务边界

- API Key 只保存在 iOS Keychain。
- SQLite 数据库使用 Keychain 派生密钥加密。
- 发送给模型服务商的数据按任务最小化。
- 默认移除姓名、手机号、证件、具体单位等无关个人信息。
- UI 明确提示哪些内容将发送给第三方模型。
- 用户可完整导出和彻底删除本地学习数据。

### 2.12 AI 成本也是体验约束

- 本地算法完成统计、候选排序、状态迁移和基础计划。
- AI 用于真正需要语义理解和教学决策的步骤。
- 讲义、教学蓝图和稳定上下文摘要应复用。
- 每类任务配置模型角色、token 预算、超时和最大重试。
- 不为了制造“AI 感”重复调用模型。

### 2.13 时效内容必须有来源

- 时政、政策、法律和考试公告不能仅凭模型记忆声称“最新”。
- 内容保存来源、发布日期、获取时间、适用地区和可信级别。
- 没有检索或用户提供来源时，只能生成明确标注的通用训练材料。
- AI 不得伪造引用；来源链接和正文摘要由代码校验和保存。
- 训练题的原创生成与真实公开材料引用必须区分，避免版权和事实风险。

## 3. 总体架构

```text
Presentation
  Vue 页面、公共组件、Pinia 页面状态
        |
Application
  用例服务、事务边界、权限和幂等
        |
Domain
  学生模型、掌握状态机、教学策略、计划规则、复习规则
        |
Infrastructure
  SQLite、IndexedDB、AI Provider、任务队列、设备能力
```

业务主链路：

```text
考试目标
→ 能力诊断
→ 发现知识缺口
→ 分析错因和决策错误
→ 选择教学策略
→ 讲解与针对性训练
→ 批改和错因确认
→ 更新掌握轨迹
→ 安排间隔复习
→ 迁移测试
→ 更新预测分和阶段计划
```

长耗时 AI 工作流：

```text
页面命令
→ Application Service 本地落任务
→ Task Queue
→ AI Runner
→ Schema Validator
→ Domain Validator
→ Unit of Work 事务落库
→ Domain Event
→ Projection 更新
→ 页面响应
```

## 4. 领域边界

### 4.1 Candidate Context

负责一次完整考试周期中的考生目标和约束：

- 考试类型、地区、岗位和日期。
- 当前分、目标分和阶段目标。
- 每日时间、学习时段和休息安排。
- 全职或在职状态。
- 训练强度、陪伴风格和复习偏好。
- 用户自述、历史考试和现实阻碍。

建档只采集会影响教学决策的维度，不收集无关个人隐私：

- 目标：考试、日期、科目目标分和阶段目标。
- 现状：最近真实模考/考试成绩、自报水平、备考时长和已学范围。
- 时间：工作日/周末可用时间、稳定学习时段和高风险中断因素。
- 学习约束：在职/全职、可连续专注时长、设备和语音使用条件。
- 教学偏好：先讲后练或先测后讲、解释深度、主动程度和陪伴语气。
- 自我感受：信心、压力和疲劳只能作为用户自述或低置信度观察，不能当医学或心理结论。

系统后续从真实证据学习速度、保持、迁移、易错干扰项和有效教学方式，不要求用户在建档时猜出这些数据。

### 4.2 Curriculum Context

负责考试大纲、知识和能力关系：

- 模块、题型、知识点、细分知识点、认知能力和考试策略。
- 前置、组成、关联、易混和迁移关系。
- 不同考试、地区和年份的大纲版本。
- 知识点对模块得分的影响权重。
- 题目模板、适用教学动作和掌握标准。

### 4.3 Learning Evidence Context

负责记录客观学习事实：

- 作答结果和耗时。
- 答案修改次数和信心。
- 是否使用提示、讲义或答案。
- AI 批改结果和用户确认结果。
- 错误发生阶段。
- 复习和迁移测试表现。
- 教学动作前后的能力变化证据。

### 4.4 Student Model Context

负责从证据计算个人能力：

- 能力节点掌握轨迹。
- 多维能力和可信度。
- 错因分布和复发风险。
- 有效教学方式。
- 遗忘和迁移能力。
- 模块得分预测及置信区间。

### 4.5 Teaching Context

负责教学闭环：

- 补前置知识。
- 概念讲解。
- 示例演示。
- 引导练习。
- 独立练习。
- 变式训练。
- 混合辨析。
- 限时训练。
- 迁移测试。
- 教学策略切换和失败升级。
- 长期 learning thread 的创建、推进、暂停、恢复和退出。

### 4.6 Planning Context

负责整个备考周期和每日计划：

- 诊断期、基础期、强化期、冲刺期和考前期。
- 阶段里程碑。
- 每日计划和版本。
- 题量、时间、复习、维护和覆盖比例。
- 计划调整原因和执行结果。

### 4.7 Content Context

负责可学习内容资产：

- 教学蓝图。
- 结构化讲义。
- 题组和题目。
- 解析、示例和扩展材料。
- 讲义与多套题组的关联。
- 内容质量校验和去重。

### 4.8 Tutor Context

负责 AI 私教交互和工作流：

- 学生上下文摘要。
- 私教会话和当前教学目标。
- 工具选择和参数确认。
- 教学决策提案。
- 对话解释、复盘和陪伴。
- 不确定意图时向用户确认。

### 4.9 Proactive Tutor Context

负责让 AI 从被动工具变成主动私教：

- 主动发现计划偏离、薄弱点复发和复习到期。
- 主动发起错因确认和前置知识诊断。
- 主动建议调整题量、难度和教学方式。
- 主动进行每日开场、学习中检查和结束复盘。
- 主动识别连续失败、疲劳和无效训练。
- 主动提醒阶段目标、模考和报名考试节点。
- 控制触达频率、安静时段和重复提醒。

## 5. 新数据层原则

### 5.1 SQLite 使用真正的关系模型

废弃当前通用的 `id + json + idx_*` 业务表模式。核心业务字段使用明确 SQLite 类型、外键、唯一约束和索引；只有题目内容块、AI 原始结构和可扩展配置使用 JSON 列。

SQLite 初始化要求：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 3000;
```

### 5.2 新数据库

- 数据库名：`zhangl-agent-tutor-v2`，旧开发数据库不打开、不迁移。
- schema 从版本 `1` 开始。
- 不读取旧 IndexedDB/SQLite 业务数据。
- 后续 schema migration 只服务于新数据库自身的版本演进，与旧系统数据迁移无关。
- 开发构建提供“重置开发数据库”入口。
- 每个 migration 必须可重复检测，不允许静默忽略失败。

### 5.3 Repository 边界

- 只有 Repository 和 Unit of Work 可以访问数据库适配器。
- 页面、Store、Domain Service 和 AI Runner 不得直接调用数据库。
- Repository 返回领域对象或只读查询 DTO，不返回 SQLite 行结构。
- Application Service 定义事务边界。
- 查询页面使用专用 Query Service，避免把复杂聚合塞入 Store。

### 5.4 数据分类和业务归属

数据库设计先按业务语义分类，不能把所有数据都当成普通记录：

| 数据类别 | 典型数据 | 特性 | 所有者 |
|---|---|---|---|
| 元数据 | 考试大纲、能力节点、关系、题型模板、内容块 schema、评分 rubric、策略版本、领域代码表 | 低频更新、版本化、发布后不可变 | Curriculum / Policy |
| 主数据 | 考生档案、考试周期、目标分、时间约束、偏好 | 当前业务身份和约束，可审计修改 | Candidate |
| 学习事实 | 会话、作答、判分、错因确认、学习证据、证据纠错 | 高频追加、事务强一致、不可静默覆盖 | Learning Evidence |
| 内容资产 | 讲义、题组、题目、解析、申论作品、面试录音 | 体积较大、可版本化、可质检 | Content |
| 决策记录 | 学习主线、教学干预、计划版本、复习安排、AI 教学动作 | 必须可解释并关联输入证据 | Teaching / Planning / Tutor |
| 派生投影 | 掌握轨迹、能力画像、预测分、页面统计 | 可重算、带算法版本、不可反向作为事实 | Student Model |
| 运行数据 | AI 任务、步骤、调用、锁、Outbox、日志 | 有生命周期、幂等、可恢复 | Task / Infrastructure |

同一概念只能有一个权威归属。例如“题型定义”是元数据，“本次题目属于什么题型”是内容资产对元数据的引用，“该题型掌握度”是投影，三者不能混在一个 JSON 对象中。

### 5.5 元数据治理

元数据决定业务解释方式，按以下规则管理：

- 稳定闭集使用代码枚举和数据库 `CHECK` 约束，例如任务状态、证据有效性和评估角色。
- 会随考试、地区和年份演进的分类保存在版本化关系表，例如能力节点、大纲关系和题型目录。
- 复杂规则使用版本化 Policy/Rubric/Schema 表，但核心可查询字段仍列化，不能只保存不可检索 JSON。
- 元数据包先进入 `draft`，通过引用完整性、重复 code、环路、schema 和内容哈希校验后一次性发布。
- 已发布版本不可原地修改；修正时创建新版本并记录变更说明。
- 考试周期固定绑定元数据快照。更新包到达后不能静默切换正在备考的周期。
- 学习事实必须保留产生时的能力、rubric、题目 schema 和算法版本引用，确保以后仍可解释。
- 元数据删除采用 `retired`，只要仍被事实引用就禁止物理删除。

元数据不是用户配置。主题、提醒偏好和 AI 风格属于用户设置；API Key 属于安全凭据；它们不能进入元数据包。

### 5.6 ID、时间和数值约定

- 业务 ID 使用 UUIDv7 或等价的单调可排序随机 ID，由 `IdGenerator` Port 生成；禁止 `Date.now() + Math.random()`。
- 时间点统一保存 UTC epoch milliseconds，字段后缀 `_at`；持续时间保存明确单位 `_ms/_seconds/_minutes`。
- 每日计划同时保存 `plan_date` 和考试周期时区，不能用 UTC 日期直接推断用户当天。
- 计时使用单调时钟计算 duration，系统时间变化不能让耗时为负。
- 掌握、可信度、质量和权重统一定义数值范围并使用数据库 `CHECK`，例如 `[0,1]`。
- 分数始终带 `max_score` 或绑定明确考试蓝图，禁止混用 100/150 分制。

### 5.7 删除和外键策略

- 删除 `project/exam_cycle` 属于高风险用例，确认后事务级级联删除其个人业务数据。
- 元数据、Policy、Prompt、Skill、Tool 和 Schema 被事实引用时使用 `RESTRICT`，只能 retired，不能级联删除。
- 内容资产被作答或证据引用后不能物理覆盖；删除用户入口只改变可见性，真正清理按周期删除策略执行。
- 派生投影可以级联删除并重算。
- 任务、Outbox 和审计记录按所属周期和保留策略清理。
- 每个外键必须在 schema 中显式声明 `CASCADE/RESTRICT/SET NULL`，不依赖 SQLite 默认行为。

### 5.8 大文件资产

SQLite 保存图片、音频、导出包等资产的元数据、内容哈希、大小、类型和受控路径；大二进制放加密本地 Asset Store，不作为巨大 BLOB 混入高频业务表。资产写入采用临时文件、哈希校验、原子改名和数据库引用事务补偿，定期清理无引用临时资产。

## 6. 关系型数据模型

### 6.1 考生与考试周期

#### `projects`

```text
id TEXT PK
name TEXT NOT NULL
status TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

不创建隐藏默认工程。首次进入只保存 `onboarding_draft`；用户完成最低必要信息并确认后，在一个事务内创建 `project + exam_cycle + score_targets + study_constraints`。没有活动考试周期时，生题、计划和能力计算必须引导建档，不能挂到匿名默认 ID。

#### `exam_cycles`

```text
id TEXT PK
project_id TEXT FK projects ON DELETE CASCADE
exam_type TEXT NOT NULL
exam_name TEXT
province TEXT
position TEXT
exam_date TEXT NOT NULL
phase TEXT NOT NULL
status TEXT NOT NULL
curriculum_version_id TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

约束：一个项目最多一个 `active` 考试周期。

#### `score_targets`

```text
id TEXT PK
exam_cycle_id TEXT FK
subject TEXT NOT NULL
target_score REAL NOT NULL
source TEXT NOT NULL
reason TEXT
status TEXT NOT NULL
effective_from INTEGER NOT NULL
supersedes_target_id TEXT FK
created_at INTEGER NOT NULL
```

每个考试周期和科目只允许一个 `active` 目标。目标变化创建新版本，不能覆盖旧目标。

#### `score_measurements`

```text
id TEXT PK
exam_cycle_id TEXT FK
subject TEXT NOT NULL
module TEXT
score REAL NOT NULL
max_score REAL NOT NULL
measurement_type TEXT NOT NULL
source TEXT NOT NULL
measured_at INTEGER NOT NULL
confidence REAL NOT NULL
metadata_json TEXT
created_at INTEGER NOT NULL
```

`measurement_type`：`self_report/official_exam/full_mock/module_mock/initial_diagnosis`。自报现状、真实测量和系统预测分分表保存，查询时明确来源和可信度。

#### `candidate_profiles`

保存时区、备考经历、当前状态和可选称呼。`profile_json` 只允许低频扩展字段；手机号、证件、具体单位等非教学必要信息不采集。

#### `study_constraints`

```text
id TEXT PK
exam_cycle_id TEXT FK UNIQUE
study_mode TEXT NOT NULL
weekly_study_days INTEGER NOT NULL
weekday_minutes INTEGER NOT NULL
weekend_minutes INTEGER NOT NULL
max_focus_minutes INTEGER
available_windows_json TEXT NOT NULL
interruption_risks_json TEXT
updated_at INTEGER NOT NULL
version INTEGER NOT NULL
```

#### `learning_preferences`

保存教学顺序、解释深度、主动程度、安静时段、陪伴语气和无障碍偏好。偏好影响教学表达和建议，不直接改变客观掌握证据。

### 6.2 元数据、能力图谱与评估策略

#### `metadata_packages`

```text
id TEXT PK
package_type TEXT NOT NULL
exam_type TEXT NOT NULL
region_scope TEXT
applicable_year_from INTEGER
applicable_year_to INTEGER
version TEXT NOT NULL
status TEXT NOT NULL
source TEXT NOT NULL
content_hash TEXT NOT NULL
schema_version TEXT NOT NULL
release_notes TEXT
published_at INTEGER
installed_at INTEGER NOT NULL
UNIQUE(package_type, exam_type, region_scope, version)
```

元数据包是课程、大纲、题型模板和评估策略的一次原子发布单元。`status` 只允许 `draft/published/retired/rejected`，发布后内容哈希不可变化。

#### `curriculum_versions`

记录考试类型、地区、适用年份、版本和内容哈希，并强制关联一个已发布 `metadata_package_id`。

#### `capability_nodes`

```text
id TEXT PK
curriculum_version_id TEXT FK
parent_id TEXT FK capability_nodes
code TEXT NOT NULL
name TEXT NOT NULL
node_type TEXT NOT NULL
subject TEXT NOT NULL
module TEXT NOT NULL
sequence INTEGER NOT NULL
score_weight REAL NOT NULL DEFAULT 0
default_target_accuracy REAL
default_target_seconds REAL
mastery_policy_json TEXT NOT NULL
UNIQUE(curriculum_version_id, code)
```

`node_type`：

```text
subject
module
question_type
knowledge_point
sub_point
cognitive_skill
problem_solving_skill
exam_strategy
expression_skill
```

节点类型不能由页面自由填写，必须引用领域枚举。新增类型需要同步定义证据来源、掌握维度和可用教学动作。

#### `capability_edges`

```text
from_node_id TEXT FK
to_node_id TEXT FK
relation_type TEXT NOT NULL
weight REAL NOT NULL
PRIMARY KEY(from_node_id, to_node_id, relation_type)
```

`relation_type`：`prerequisite/contains/related/confusable/transfer`。

#### `exam_blueprints`

记录模块分值、题量、时间和能力节点权重，用于目标分映射和模考生成。

#### `assessment_policy_versions`

```text
id TEXT PK
subject TEXT NOT NULL
policy_type TEXT NOT NULL
version TEXT NOT NULL
config_json TEXT NOT NULL
content_hash TEXT NOT NULL
status TEXT NOT NULL
created_at INTEGER NOT NULL
UNIQUE(subject, policy_type, version)
```

保存行测客观判分、申论 rubric、面试 rubric、掌握阈值和分数投影策略。运行中的考试周期固定引用具体版本，禁止用全局常量静默改变历史含义。

#### `exam_cycle_policy_bindings`

```text
exam_cycle_id TEXT FK
subject TEXT NOT NULL
policy_type TEXT NOT NULL
assessment_policy_version_id TEXT FK
bound_at INTEGER NOT NULL
PRIMARY KEY(exam_cycle_id, subject, policy_type)
```

考试周期通过绑定表固定各科目的评分、掌握和预测策略版本，不能运行时查询“当前最新版本”。

#### `rubric_definitions` 与 `rubric_dimensions`

申论和面试 rubric 使用关系表保存维度 code、名称、权重、等级描述、证据要求和顺序。维度 code 是跨版本稳定身份，描述和权重通过 rubric version 演进。

#### `question_template_versions`

定义不同题型需要哪些内容块、材料与小题关系、答案形态、渲染模板、校验规则和适用评估角色。生题规格引用确定版本，前端根据结构化 `template_code + version` 选择渲染模板，不使用正文正则猜题型。

#### `content_schema_versions`

保存题目、讲义、解析、错因、申论作品和面试点评的结构合同版本。Schema 用于 AI 输出校验和本地内容校验；发布后不可覆盖。

#### `code_definitions`

只承载需要展示名称、顺序、停用状态和多语言映射的领域代码，例如错因和教学动作。状态机核心状态仍由代码枚举和 `CHECK` 约束控制，禁止构建一个可以随意改变核心业务语义的万能字典表。

### 6.3 长期教学主线与内容资产

#### `content_sources` 与 `content_source_links`

记录来源类型、标题、发布者、发布日期、适用地区、URL/本地资产、内容哈希、许可/使用说明、获取时间和验证状态。讲义、题目、时政、申论材料和报告通过 link 表关联来源。

`source_type` 区分 `official/user_provided/licensed/ai_generated/derived`。AI 生成内容保存模型调用与生成规格来源，但不得伪造为官方材料。

#### `learning_threads`

```text
id TEXT PK
exam_cycle_id TEXT FK
primary_capability_node_id TEXT FK
origin_type TEXT NOT NULL
origin_ref_id TEXT
goal TEXT NOT NULL
gap_snapshot_json TEXT NOT NULL
stage TEXT NOT NULL
status TEXT NOT NULL
exit_criteria_json TEXT NOT NULL
next_action_json TEXT
started_at INTEGER NOT NULL
paused_at INTEGER
completed_at INTEGER
closed_reason TEXT
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`stage`：`diagnose/prerequisite/teach/guided/independent/consolidate/retention/transfer/maintain`。同一考试周期和主能力节点默认只允许一个活动主线；确需并行时必须由不同教学目标区分并写 ADR。

`learning_thread_events` 追加记录阶段推进、暂停、恢复、策略切换、退出条件达成和用户干预。当前状态由 `learning_threads` 提供快速读取，事件用于解释和审计。

#### `teaching_blueprints`

```text
id TEXT PK
exam_cycle_id TEXT FK
learning_thread_id TEXT FK
capability_node_id TEXT FK
objective TEXT NOT NULL
prerequisite_snapshot_json TEXT NOT NULL
teaching_strategy TEXT NOT NULL
difficulty_path_json TEXT NOT NULL
version INTEGER NOT NULL
status TEXT NOT NULL
created_by TEXT NOT NULL
created_at INTEGER NOT NULL
```

#### `lectures`

讲义必须关联教学蓝图、学习主线和能力节点，正文使用结构化内容块 JSON，支持概念、边界、方法、示例、反例、陷阱、总结和训练建议。讲义是可版本化资产，一套讲义可以关联多套题组；更新讲义创建新版本，不能覆盖已经用于教学和评估的内容。

#### `question_sets`

```text
id TEXT PK
exam_cycle_id TEXT FK
learning_thread_id TEXT FK
teaching_blueprint_id TEXT FK
generation_spec_id TEXT FK
purpose TEXT NOT NULL
assessment_role TEXT NOT NULL
module TEXT NOT NULL
status TEXT NOT NULL
question_count INTEGER NOT NULL
content_hash TEXT
content_version INTEGER NOT NULL
created_at INTEGER NOT NULL
```

`assessment_role`：`teaching/guided/practice/retention/transfer/anchor`。`retention/transfer/anchor` 题组必须满足无答案泄露、无提示和新颖度要求；`anchor` 内容在正式作答前不得用于讲义示例或训练。

#### `questions`

保留现有结构化渲染思想，但增加：

- `capability_node_id`。
- `difficulty`。
- `cognitive_level`。
- `purpose`。
- `assessment_role`。
- `variant_group_id`。
- `quality_status`。
- `content_hash`。
- `content_schema_version`。
- `content_version`。
- `generator_task_id`。

题干、材料、选项、图表和解析保存在 `content_json`，可查询字段单独列化。

#### `question_capabilities`

```text
question_id TEXT FK
capability_node_id TEXT FK
relation_role TEXT NOT NULL
weight REAL NOT NULL
PRIMARY KEY(question_id, capability_node_id, relation_role)
```

题目保留一个 primary capability 便于常用查询，综合题通过关联表表达前置、次要和迁移能力，不能把多个能力拼成一个字符串。

#### `question_exposures`

记录题目何时以讲义示例、预览、提示、训练或正式评估形式展示给用户。独立验证前由 `AssessmentIntegrityPolicy` 检查暴露记录，防止已见题进入保持、迁移或锚定证据。

### 6.4 学习会话与作答

#### `learning_sessions`

统一练习、复习、诊断、模考、申论和迁移测试。记录 `learning_thread_id`、计划项、题组、`assessment_role`、开始时间、结束时间和中断恢复状态。

#### `attempts`

```text
id TEXT PK
session_id TEXT FK
question_id TEXT FK
exam_cycle_id TEXT FK
capability_node_id TEXT FK
learning_thread_id TEXT FK
assessment_role TEXT NOT NULL
question_content_version INTEGER NOT NULL
answer_json TEXT NOT NULL
result TEXT NOT NULL
score REAL
elapsed_ms INTEGER
confidence REAL
hint_level INTEGER NOT NULL DEFAULT 0
answer_change_count INTEGER NOT NULL DEFAULT 0
submitted_at INTEGER NOT NULL
idempotency_key TEXT NOT NULL UNIQUE
```

#### `decision_observations`

记录题型识别、方法选择、关键条件提取、排除选项、错误阶段和用户确认。只保存结构化决策证据，不保存模型思考过程。

#### `grading_results`

保存客观判分、AI 分析、rubric 版本、错因候选、置信度和用户确认状态。AI 原始返回单独保存，业务读取标准化字段。

#### `learning_evidence`

```text
id TEXT PK
exam_cycle_id TEXT FK
capability_node_id TEXT FK
attempt_id TEXT FK
intervention_id TEXT FK
assessment_role TEXT NOT NULL
evidence_type TEXT NOT NULL
value REAL
weight REAL NOT NULL
quality REAL NOT NULL
source TEXT NOT NULL
validation_policy_version TEXT NOT NULL
occurred_at INTEGER NOT NULL
idempotency_key TEXT NOT NULL UNIQUE
metadata_json TEXT
```

证据类型包括正确性、速度、保持度、迁移、方法识别、错因复发、讲解理解和用户确认。

`learning_evidence` 核心记录追加后不可更新。证据产生时使用的验证策略版本作为事实字段保存。

#### `evidence_corrections`

```text
id TEXT PK
exam_cycle_id TEXT FK
evidence_id TEXT FK
action TEXT NOT NULL
reason_code TEXT NOT NULL
reason_detail TEXT
replacement_evidence_id TEXT FK
actor_type TEXT NOT NULL
created_at INTEGER NOT NULL
idempotency_key TEXT NOT NULL UNIQUE
```

纠错和受影响投影重算必须在同一工作流中完成。原证据保留审计记录，但不再参与掌握、复习、计划和分数预测。

#### `evidence_validity_projection`

```text
evidence_id TEXT PK FK
validity_status TEXT NOT NULL
latest_correction_id TEXT FK
updated_at INTEGER NOT NULL
version INTEGER NOT NULL
```

`validity_status` 只允许 `valid/invalid/superseded/disputed`。这是可重建的当前投影，不是学习事实。查询默认只连接 `valid`；争议证据不推动掌握升级。

### 6.5 错因与教学干预

#### `error_diagnoses`

错误分类必须使用统一枚举：

```text
concept_gap
recognition_error
method_selection_error
reasoning_error
calculation_error
evidence_extraction_error
trap_misjudgment
time_management_error
careless_error
transfer_failure
retention_failure
unknown
```

记录错误阶段、细节、AI 置信度、是否用户确认、关联前置知识点和建议教学动作。

#### `teaching_interventions`

```text
id TEXT PK
exam_cycle_id TEXT FK
learning_thread_id TEXT FK
capability_node_id TEXT FK
intervention_type TEXT NOT NULL
strategy_code TEXT NOT NULL
input_snapshot_json TEXT NOT NULL
content_ref_type TEXT
content_ref_id TEXT
expected_outcome_json TEXT NOT NULL
actual_outcome_json TEXT
effectiveness REAL
status TEXT NOT NULL
started_at INTEGER NOT NULL
completed_at INTEGER
```

记录 AI 私教实际采用的教学动作及效果，系统才能学习“什么教学方式对这个人有效”。`intervention_type` 和 `strategy_code` 使用版本化领域枚举，不以任意自然语言作为统计键。

### 6.6 掌握轨迹与复习

#### `mastery_tracks`

```text
id TEXT PK
exam_cycle_id TEXT FK
capability_node_id TEXT FK
state TEXT NOT NULL
concept REAL NOT NULL
recognition REAL NOT NULL
method REAL NOT NULL
accuracy REAL NOT NULL
speed REAL NOT NULL
retention REAL NOT NULL
transfer REAL NOT NULL
stability REAL NOT NULL
confidence REAL NOT NULL
effective_sample REAL NOT NULL
last_evidence_at INTEGER
last_state_change_at INTEGER NOT NULL
algorithm_version TEXT NOT NULL
version INTEGER NOT NULL
UNIQUE(exam_cycle_id, capability_node_id)
```

状态：

```text
unassessed
diagnosed
learning
practicing
consolidating
mastered
maintaining
regressed
```

#### `mastery_snapshots`

低频保存阶段快照，用于趋势、算法比较和分数回溯。日常页面读取当前轨迹，不扫描全部证据。

#### `score_projections`

```text
id TEXT PK
exam_cycle_id TEXT FK
subject TEXT NOT NULL
point_estimate REAL NOT NULL
lower_bound REAL NOT NULL
upper_bound REAL NOT NULL
confidence REAL NOT NULL
evidence_cutoff_at INTEGER NOT NULL
algorithm_version TEXT NOT NULL
factors_json TEXT NOT NULL
created_at INTEGER NOT NULL
```

界面优先显示预测区间、可信度和主要差距，不把数据不足时的点估计包装成精确结论。真实模考和正式考试成绩用于校准，不直接覆盖能力轨迹。

#### `review_queue`

```text
id TEXT PK
exam_cycle_id TEXT FK
capability_node_id TEXT FK
mastery_track_id TEXT FK
review_type TEXT NOT NULL
due_at INTEGER NOT NULL
priority REAL NOT NULL
interval_days REAL NOT NULL
stability_before REAL NOT NULL
status TEXT NOT NULL
reason TEXT NOT NULL
source_evidence_id TEXT FK
updated_at INTEGER NOT NULL
```

业务唯一性使用部分唯一索引实现，仅限制 `scheduled/in_progress` 活动状态；`completed/cancelled/failed` 历史可以保留多条。

### 6.7 计划与生成规格

#### `study_plans`

记录整个周期和阶段目标。

#### `daily_plans`

```text
id TEXT PK
exam_cycle_id TEXT FK
plan_date TEXT NOT NULL
version INTEGER NOT NULL
status TEXT NOT NULL
phase TEXT NOT NULL
available_minutes INTEGER NOT NULL
decision_summary TEXT NOT NULL
decision_factors_json TEXT NOT NULL
created_by TEXT NOT NULL
created_at INTEGER NOT NULL
supersedes_plan_id TEXT FK
UNIQUE(exam_cycle_id, plan_date, version)
```

#### `daily_plan_items`

```text
id TEXT PK
daily_plan_id TEXT FK
learning_thread_id TEXT FK
capability_node_id TEXT FK
item_type TEXT NOT NULL
sequence INTEGER NOT NULL
target_minutes INTEGER NOT NULL
target_count INTEGER
exit_criteria_json TEXT NOT NULL
reason TEXT NOT NULL
status TEXT NOT NULL
actual_minutes INTEGER NOT NULL DEFAULT 0
result_summary_json TEXT
UNIQUE(daily_plan_id, sequence)
```

`item_type`：`diagnosis/lecture/guided_practice/independent_practice/variant/timed/review/transfer/mock/essay/digest`。

#### `generation_specs`

是 AI 生题的不可变合同，包含学习主线、教学目标、能力节点、评估角色、题量、难度分布、认知层级、题型模板、讲义关系、去重范围、材料与小题结构和质量要求。

规格一经任务执行即不可修改；调整时创建新版本。`retention/transfer/anchor` 规格必须声明独立性约束和允许使用的历史上下文，不能把此前解析或答案发送给生成模型。

### 6.8 AI 私教和任务

#### Agent Workspace：会话索引

一个私教会话可以绑定当前考试周期、活动学习主线、每日计划和掌握轨迹。普通聊天不创建教学任务，但从聊天触发教学工具后，后续工具、任务、结果和消息都必须携带同一 `workflow_id`。

会话不是业务关系表。会话 ID、标题、摘要和更新时间以 append-only JSONL 事件写入 Agent Workspace；删除会话写入删除事件并删除该会话消息文件。日志需要支持回放、压缩和整会话删除，不参与业务 SQLite 外键。

#### Agent Workspace：消息日志

```text
version
operation: put
message:
  id
  session_id
  role
  content
  tool_name?
  tool_call_id?
  created_at
```

每个会话使用独立日志文件。流式 delta 只更新内存中的临时消息，不逐 token 写文件；回复完成或中断后只追加一次最终完整消息。删除会话同时删除消息文件、摘要和该会话作用域的 Agent memory。

#### `agent_runs`

```text
id TEXT PK
workflow_id TEXT
chat_session_id TEXT
exam_cycle_id TEXT FK
learning_thread_id TEXT FK
goal_type TEXT NOT NULL
goal_json TEXT NOT NULL
prompt_bundle_version TEXT NOT NULL
tool_catalog_version TEXT NOT NULL
status TEXT NOT NULL
turn_count INTEGER NOT NULL DEFAULT 0
tool_call_count INTEGER NOT NULL DEFAULT 0
token_budget INTEGER NOT NULL
checkpoint_json TEXT
started_at INTEGER NOT NULL
completed_at INTEGER
version INTEGER NOT NULL
```

`chat_session_id` 仅是运行相关键，不是数据库外键。AgentRun 保存的是任务状态、恢复检查点和稳定业务结果引用，不复制对话正文、会话摘要或隐藏思考。

#### `agent_tool_calls`

```text
id TEXT PK
agent_run_id TEXT FK
turn_index INTEGER NOT NULL
tool_name TEXT NOT NULL
tool_version TEXT NOT NULL
arguments_json TEXT NOT NULL
risk_level TEXT NOT NULL
confirmation_status TEXT NOT NULL
status TEXT NOT NULL
result_summary_json TEXT
result_resource_type TEXT
result_resource_id TEXT
idempotency_key TEXT NOT NULL UNIQUE
started_at INTEGER
completed_at INTEGER
```

需要崩溃恢复或产生业务写入的工具调用和结果必须成对。完整大结果保存在所属业务模块，Agent 运行记录只保存恢复所需摘要、幂等键和资源引用。对话框顶部的工具执行列表不是历史账本，只使用当前 run 的有界内存快照；下一次 run 开始时整体覆盖。

#### `prompt_versions`、`skill_versions` 与 `tool_catalog_versions`

属于 AI Runtime 元数据。保存 Manifest、依赖、兼容 Schema、内容哈希、发布状态和评测结果；可执行工具代码仍随签名 App 发布，数据库不加载任意脚本。

#### `tutor_actions`

保存 AI 提出的结构化教学动作、依据、置信度、校验结果和执行状态。

#### `proactive_signals`

```text
id TEXT PK
exam_cycle_id TEXT FK
signal_type TEXT NOT NULL
priority REAL NOT NULL
evidence_refs_json TEXT NOT NULL
dedupe_key TEXT NOT NULL UNIQUE
detected_at INTEGER NOT NULL
expires_at INTEGER
status TEXT NOT NULL
payload_json TEXT NOT NULL
```

用于保存代码检测出的主动教学信号，而不是保存 AI 的主观猜测。

`signal_type` 包括：

```text
daily_plan_ready
review_due
plan_stalled
repeated_wrong_cause
mastery_regressed
prerequisite_gap
low_confidence_diagnosis
training_saturation
fatigue_risk
pace_behind_target
score_projection_risk
stage_milestone_due
mock_due
positive_breakthrough
```

#### `tutor_nudges`

记录主动干预的内容、渠道、用户响应、是否有效和冷却时间。系统据此学习什么提醒方式对当前考生有效。

```text
id TEXT PK
exam_cycle_id TEXT FK
signal_id TEXT FK
tutor_action_id TEXT FK
channel TEXT NOT NULL
status TEXT NOT NULL
message TEXT NOT NULL
suggested_action_json TEXT
shown_at INTEGER
acted_at INTEGER
dismissed_at INTEGER
cooldown_until INTEGER
created_at INTEGER NOT NULL
```

#### `tutor_agent_runs`、`tutor_agent_run_events`

`AgentRun` 是用户可见长任务的唯一事实源。生成工作流只保存内容生成内部检查点，不再作为第二套任务；旧 `LocalTask/TaskQueue` 已删除。

统一状态：

```text
queued
running
waiting_user
completed
failed
cancelled
```

统一执行阶段：

```text
queued
resolving_plan
preparing_context
compiling_prompt
invoking_model
parsing_response
validating_content
committing_result
completed
```

任务增加：

- `workflow_id`。
- `learning_thread_id`。
- `plan_item_id`。
- `mastery_track_id`。
- `target_resource_type` 和 `target_resource_id`。
- `generation_spec_id`。
- `idempotency_key`。
- `attempt_count`。
- `next_run_at`。
- `provider_request_id`。
- `checkpoint_json`。

同一 `learning_thread` 默认只允许一个会改变教学阶段或掌握投影的活动工作流；纯内容预生成可以并行，但必须写入独立资源并在最终提交时做版本检查。

#### `system_messages`

消息中心与任务中心职责分离：

- 任务中心回答“正在执行什么、到哪一步、能否取消”。
- 消息中心回答“发生了什么需要用户知道、属于哪条业务线、可以跳到哪里处理”。
- 任务的细粒度进度不写消息；排队、完成、失败、取消等关键事件可投影为消息。
- 所有业务只能通过 `MessageCenter.publish()` 发布，页面不得直接写消息表。

业务线固定为：

```text
tutor       私教
practice    刷题
essay       申论
interview   面试
planning    计划
review      复习
exam        模考
digest      积累
profile     档案
system      系统
```

消息类别固定为 `task/learning/reminder/result/warning/system`；每条消息必须有 `event_code`、`source_type/source_id`、幂等 `dedup_key`，需要处理时携带内部 `action_route/action_params`。

#### `ai_invocations`

```text
id TEXT PK
task_id TEXT FK
task_step_id TEXT FK
provider TEXT NOT NULL
model TEXT NOT NULL
model_role TEXT NOT NULL
prompt_version TEXT NOT NULL
tool_schema_version TEXT
request_hash TEXT NOT NULL
provider_request_id TEXT
input_tokens INTEGER
output_tokens INTEGER
latency_ms INTEGER
finish_reason TEXT
validation_status TEXT NOT NULL
created_at INTEGER NOT NULL
```

业务表只保存标准化结果，原始 AI 请求/响应放受控审计存储并设置保留期限。禁止记录模型思考内容；生产日志不得包含 API Key。

#### `domain_outbox`

```text
id TEXT PK
aggregate_type TEXT NOT NULL
aggregate_id TEXT NOT NULL
event_type TEXT NOT NULL
payload_json TEXT NOT NULL
occurred_at INTEGER NOT NULL
published_at INTEGER
attempt_count INTEGER NOT NULL DEFAULT 0
idempotency_key TEXT NOT NULL UNIQUE
```

业务事实和 Outbox 事件在同一 SQLite 事务写入。Outbox consumer 负责刷新页面投影、创建后续 AI 任务和触发主动信号；崩溃重启后继续处理未发布事件。

## 7. 索引和查询预算

必须建立以下复合索引：

```text
mastery_tracks(exam_cycle_id, state, confidence)
learning_threads(exam_cycle_id, status, updated_at DESC)
learning_threads(exam_cycle_id, primary_capability_node_id, status)
learning_evidence(exam_cycle_id, capability_node_id, occurred_at DESC)
evidence_validity_projection(validity_status, evidence_id)
attempts(exam_cycle_id, capability_node_id, submitted_at DESC)
error_diagnoses(exam_cycle_id, capability_node_id, error_type, created_at DESC)
review_queue(exam_cycle_id, status, due_at, priority DESC)
daily_plans(exam_cycle_id, plan_date, version DESC)
daily_plan_items(daily_plan_id, status, sequence)
questions(question_set_id, sequence)
questions(exam_cycle_id, capability_node_id, created_at DESC)
ai_tasks(status, next_run_at, priority DESC)
ai_tasks(exam_cycle_id, lock_key, status)
ai_invocations(task_id, created_at)
agent_runs(chat_session_id, status, started_at DESC)
agent_runs(workflow_id, status)
agent_tool_calls(agent_run_id, turn_index, status)
domain_outbox(published_at, occurred_at)
```

Agent Workspace 文件日志不建立 SQL 索引；会话按独立文件读取，会话索引日志通过内存回放并按阈值压缩。

额外唯一约束：

```text
一个 exam_cycle 仅一个 active 状态
一个 exam_cycle + primary_capability 默认仅一个 active learning_thread
一个 session + question + final submission 仅一个有效 attempt
一个 task + step + provider attempt 仅一个 invocation
一个命令结果仅一个 idempotency_key
```

性能预算：

| 操作 | 目标 |
|---|---:|
| 普通点击反馈 | 100ms 内 |
| 本地首屏查询 | 300ms 内 |
| 本地基础每日计划 | 500ms 内 |
| 任务进入任务栏 | 150ms 内 |
| 单次事务提交 | 100ms 内，批量数据除外 |
| 页面查询结果 | 默认不超过 100 行，历史分页 |

禁止页面加载时扫描整个考试周期的题目、答案或 Markdown。

## 8. 能力模型

### 8.1 多维掌握度

每个可训练能力节点不能只有单一百分比，至少包含：

- 概念理解 `concept`。
- 题型识别 `recognition`。
- 方法选择 `method`。
- 正确性 `accuracy`。
- 速度 `speed`。
- 间隔保持 `retention`。
- 变式迁移 `transfer`。
- 跨时间稳定性 `stability`。
- 判断可信度 `confidence`。

### 8.2 证据权重

初始权重可配置并版本化：

```text
查看答案后的练习       0.15
强提示引导练习         0.35
弱提示引导练习         0.55
独立基础练习           1.00
独立变式练习           1.10
限时练习               1.15
间隔复习               1.20
跨题型迁移测试         1.30
```

难度、题目质量、作答信心和是否中断可以调整最终权重。

### 8.3 正确性估计

使用带先验的 Beta 后验估计，避免少量样本造成极端判断：

```text
accuracy = (alpha0 + weighted_correct) /
           (alpha0 + beta0 + weighted_attempts)
```

具体先验按模块、题型和阶段配置，并记录 `algorithm_version`。

### 8.4 可信度

可信度由以下因素共同决定：

- 有效样本量。
- 题目难度覆盖。
- 题型和材料多样性。
- 时间跨度。
- 是否经过间隔复习。
- 是否经过迁移测试。
- 题目质量和批改置信度。

样本多但全部是同模板题，可信度不能很高。

### 8.5 掌握状态迁移

状态迁移由 `MasteryPolicy` 统一执行，不允许页面或 AI 直接设置。

初始建议条件：

- `learning → practicing`：概念和方法达到基础阈值。
- `practicing → consolidating`：独立练习后验正确率达到阶段阈值，且有效样本充分。
- `consolidating → mastered`：速度、间隔保持和迁移均达标，可信度达到阈值。
- `mastered → maintaining`：进入低频维护。
- `maintaining → regressed`：复习失败或同错因复发。
- `regressed → learning/practicing`：根据错误阶段决定回退深度。

不同模块使用不同阈值，不能把行测和申论套进同一标准。

### 8.6 科目策略

统一 `MasteryEngine` 只负责编排证据、版本和状态迁移，不假设所有科目都有标准答案：

- 行测：客观判分为主，正确率、耗时、难度、保持和迁移进入量化模型。
- 申论：每次作品保存版本，以 rubric 维度、证据引用、结构完整度和跨主题迁移形成轨迹；单次 AI 总分不能直接代表掌握。
- 面试：保存回答文本、音频指标和追问表现，以内容、结构、表达、节奏和临场稳定性分别建轨迹。
- 通用策略能力：时间分配、跳题和检查使用完整练习或模考中的行为证据，不从单题结果臆测。

每个科目策略必须实现 `validateEvidence`、`calculateDimensions`、`canAdvanceState`、`projectScoreRange` 和 `explainDecision`，并绑定具体 `assessment_policy_version`。

## 9. 错因驱动教学

答错只是触发器，错误阶段决定教学动作：

| 错因 | 教学动作 |
|---|---|
| 概念不清 | 概念、边界和反例讲解 |
| 题型识别错误 | 题型辨识和易混对比 |
| 方法选择错误 | 方法适用条件对比 |
| 推理链错误 | 分步推理和关键跳步检查 |
| 计算错误 | 计算专项、估算和检查流程 |
| 材料定位错误 | 信息定位和材料标记训练 |
| 干扰项误判 | 选项强弱和陷阱对比 |
| 时间管理错误 | 限时、跳题和顺序策略 |
| 粗心 | 检查清单和高风险步骤训练 |
| 迁移失败 | 变式、综合和跨材料训练 |
| 遗忘 | 调整复习间隔和检索练习 |

AI 置信度不足时只保存 `candidate`，必须通过一次简短追问确认，不能把猜测写成事实。

## 10. 每日计划引擎

### 10.1 冷启动和初始诊断

新用户不能凭自报分直接生成长期画像，也不能要求完成整套模考后才能开始使用。采用渐进式诊断：

1. 建档采集考试目标、时间、最近真实成绩、自评和现实限制。
2. 用少量覆盖面广的锚定题建立模块级粗画像。
3. 根据作答动态选择信息增益最高的下一题，逐步下钻到能力节点。
4. 对自报薄弱点和诊断冲突处安排确认题，不让 AI 直接裁决。
5. 达到最低可信度后立即生成短期计划，后续训练继续补全画像。

冷启动期间显示“数据不足/正在确认”，预测分使用宽区间。系统不得伪造精确掌握百分比。

### 10.2 两阶段计划

第一阶段由本地代码在 500ms 内生成可靠基础计划：

- 读取考试目标和剩余时间。
- 读取当前阶段。
- 读取掌握轨迹和可信度。
- 读取到期复习。
- 读取大纲覆盖欠账。
- 读取最近完成率、疲劳和训练饱和度。
- 计算时间预算和候选教学动作。

第二阶段由 AI 私教审核：

- 选择今天的核心教学目标。
- 调整教学顺序和教学方式。
- 给考生解释安排原因。
- 提交结构化调整提案。

`PlanValidator` 对 AI 提案执行题量、时间、重复度、阶段和疲劳校验。通过后生成新版本，不能覆盖旧计划。

### 10.3 优先级

候选能力节点和学习主线优先级由以下标准化因子组成：

```text
目标分贡献
掌握缺口
复习紧迫度
前置知识阻塞
迁移能力欠账
大纲覆盖欠账
数据不确定性
错因复发风险
- 最近训练饱和度
- 疲劳和连续失败风险
```

权重配置化并版本化，不能散落在页面和 Service 中。

### 10.4 题量

题量首先由时间预算计算：

```text
可训练题量 =
可用训练分钟 × 训练时间占比 ÷ 个人该题型稳健平均耗时
```

再由阶段、难度、教学动作和完成率调整。使用中位数或截尾均值，避免异常耗时污染。

每日变化设置上下限，防止题量剧烈波动。AI 可以提出调整，但不能突破硬约束。

### 10.5 训练结构

默认动态区间：

```text
薄弱点突破 50%～65%
到期复习   20%～30%
强项维护   10%～15%
新知识覆盖  5%～15%
```

冲刺期增加模考、速度和稳定性训练，但不能完全停止薄弱点闭环。

## 11. 能力教学闭环

每个能力缺口创建或恢复一条 `learning_thread`，按需执行：

```text
发现薄弱点
→ 确认具体错因
→ 检查前置知识
→ 针对性讲解
→ 示例演示
→ 引导练习
→ 独立练习
→ 变式训练
→ 混合辨析
→ 限时训练
→ 间隔复习
→ 迁移测试
→ 确认掌握
```

每个计划项必须保存明确的退出条件和失败路径。连续三次教学干预无效时：

1. 停止重复生成同类题。
2. 重新诊断前置知识和错因。
3. 更换讲解方式或难度。
4. 向考生确认实际困难。
5. 必要时降低当天负荷，避免无效消耗。

### 11.1 主线推进规则

- 日计划只能引用、暂停或创建学习主线，不能复制一份主线状态。
- 同一主线的讲义、题组、错因、干预、复习和迁移测试都通过 `learning_thread_id` 串联。
- 下一动作由 `TeachingStrategyEngine` 根据当前阶段、最新有效证据和退出条件决定。
- 用户离开页面、切换会话或跨天不会结束主线。
- 主线完成后进入维护期；发生退化时恢复原主线或创建有明确原因的新版本。
- 关闭主线必须保存 `closed_reason`，区分真正掌握、目标变化、用户暂停和策略失败。

### 11.2 独立掌握验证

进入 `mastered` 前至少满足：

- 独立练习达到科目策略要求。
- 在时间间隔后通过一次保持验证。
- 使用未暴露的新材料通过一次迁移验证。
- 证据质量和样本多样性达到阈值。
- 没有未解决的高置信度重复错因。

锚定评估与训练内容池隔离，AI 生成时不接收相关讲义答案和逐题解析。若内容暴露、题目质量被判无效或批改存在争议，本次验证不推动状态升级。

## 12. AI 私教上下文

每次只动态加载当前任务所需的学生摘要：

```text
考试目标和剩余时间
当前阶段和预测分差距
今日可用时间
当前教学目标
当前活动 learning thread、阶段和退出条件
相关能力节点掌握维度和可信度
前置知识状态
最近错因和用户确认结果
到期复习
最近教学动作及效果
完成率、疲劳和中断情况
当前计划和硬约束
```

上下文禁止包含：

- 全量历史聊天。
- 全量题目和作答记录。
- 模型思考内容。
- 与当前教学目标无关的其他模块详情。

上下文结论必须标注来源和时间边界，例如“基于最近 30 天 6 条有效独立证据”。旧摘要不能覆盖更新后的事实；对话摘要只承载沟通连续性，不参与掌握计算。

## 13. AI 工具体系

AI 对话中只暴露标准化工具 description 和参数 schema，不提前加载完整提示词。

核心工具：

```text
get_candidate_snapshot
get_active_mastery_tracks
get_capability_context
propose_daily_plan_revision
start_teaching_intervention
generate_lecture
generate_practice_set
grade_practice
diagnose_error
schedule_review
request_transfer_test
create_daily_review
create_stage_review
acknowledge_proactive_signal
accept_tutor_suggestion
dismiss_tutor_suggestion
```

页面按钮走确定性 Application Command；自然语言走 AI 意图识别和工具调用。参数不确定时必须向用户确认。

## 13.1 主动私教引擎

主动性采用“代码发现信号，AI形成干预，用户保留控制权”的三层结构：

```text
Signal Detector
  基于真实学习数据检测事件
        ↓
Proactive Tutor Policy
  判断是否值得打扰、优先级和冷却时间
        ↓
AI Tutor
  生成自然、具体、有依据的提醒和下一步动作
```

AI 不能自行定时无限唤醒，也不能仅凭聊天语气判断考生状态。疲劳和情绪属于低确定性信号，必须使用“可能、是否”进行确认。

### 主动场景

#### 学习前

- 打开 App 时主动说明今日重点及原因。
- 昨日未完成时给出继续、缩减或重新安排三种选择。
- 有到期复习时说明遗忘风险，而不是只显示数字。
- 计划明显落后于考试目标时主动提出阶段调整。

#### 学习中

- 同一错因连续出现时暂停机械刷题，发起针对性讲解。
- 连续失败时检查前置知识，而不是继续加题。
- 正确率高但耗时过长时主动切换为速度训练。
- 作答速度和正确率同时下降时询问是否疲劳，并建议短暂休息或降负荷。
- AI 错因置信度不足时主动追问一次关键决策。

#### 学习后

- 主动总结今天真正解决的知识缺口。
- 说明哪些能力节点仍未达到退出条件。
- 安排下一次复习并解释时间依据。
- 达成阶段突破时给予具体反馈，不使用空洞鼓励。

#### 周期把控

- 每周主动复盘计划完成率、能力变化和无效训练。
- 模考结果偏离目标时主动重排下一阶段重点。
- 临近考试时主动切换训练策略。
- 对长期未改善能力缺口主动更换教学方式。

### 打扰控制

主动不等于频繁弹窗。必须具备：

- 用户可选 `安静/标准/积极` 三档主动程度。
- 用户可设置安静时段和每日触达上限。
- 同类信号使用 `dedupe_key` 去重。
- 被忽略或关闭后进入冷却期。
- 高优先级信号合并展示，不连续弹多个窗口。
- 普通建议进入 AI 气泡或计划页，不使用系统通知。
- 只有到期复习、用户设置的学习时间和关键考试节点使用本地通知。
- 任何计划大改、批量生题和耗时 AI 操作必须经用户确认。

### 主动程度权限

```text
低风险：自动执行
  更新本地摘要、刷新候选优先级、安排内部复习候选

中风险：先提示，可一键接受
  调整今日顺序、降低题量、增加一次讲解或复习

高风险：必须明确确认
  改变阶段计划、生成大题组、删除计划、切换考试目标
```

### 无服务器条件

App 未运行时，本地 AI 无法主动推理。系统应提前根据计划和 review queue 安排 iOS 本地通知；用户进入 App 后再由 AI 读取最新状态形成具体教学干预。不能为了“主动”引入隐性云端常驻服务。

## 13.2 可扩展业务方向

所有扩展必须复用考试周期、知识图谱、学习证据、掌握轨迹和主动信号，不建立平行业务孤岛。

### 学习节奏教练

- 在职和全职备考的动态时间安排。
- 学习中断后的恢复计划。
- 疲劳、拖延和计划完成率干预。
- 根据个人完成习惯选择短任务或深度任务。

### 阶段陪练

- 初期诊断营。
- 单能力缺口突破周期。
- 模块强化周期。
- 考前冲刺和状态保持。
- 模考后的专项修复周期。

### 申论长期能力训练

- 素材积累与题目主题关联。
- 阅读、概括、分析、对策和表达维度轨迹。
- 同类错误持续追踪。
- 写作版本对比和阶段复盘。

### 面试私教

- 结构、内容、表达、语速和临场稳定性轨迹。
- 主动发现高频表达问题。
- 按岗位和面试阶段安排训练。
- 语音作答后的针对性复盘和复练。

### 目标与报考决策

- 多考试时间冲突提醒。
- 岗位要求与个人条件整理。
- 报名、缴费、准考证和考试节点提醒。
- 目标变化后重新计算整个备考周期。

该方向只能辅助整理和提醒，不能替用户作出报考承诺或保证录取结果。

## 14. 生题质量和性能

### 14.1 生成合同

AI 只按照不可变 `GenerationSpec` 生题。规格至少包含：

- 学习主线、教学蓝图和能力节点。
- `assessment_role` 和独立性要求。
- 前置知识边界。
- 题量和难度分布。
- 认知层级。
- 基础题、变式题和迁移题比例。
- 内容模板和渲染模板。
- 讲义关联。
- 去重范围。
- 答案唯一性和解析要求。

### 14.2 分批生成

较大题组使用：

```text
教学蓝图
→ 讲义或讲义摘要
→ 4 题一批并行生成
→ 分批结构校验
→ 分批质量校验
→ 首批落库并展示
→ 后续批次继续
```

所有批次共享同一个教学蓝图，避免讲义和题目不一致。

默认并发 3；服务商限流时自动降到 2、再降到 1。失败只重试当前批次，不重新生成整套题。

### 14.3 质量校验

- JSON Schema 校验。
- 题型模板校验。
- 能力节点和教学目标一致性校验。
- 答案唯一性校验。
- 解析与答案一致性校验。
- SVG、表格、材料和选项区域校验。
- 题目内容哈希和语义近似去重。
- 难度分布校验。
- 变式是否真正变化的校验。

## 15. 事务与幂等

一次练习提交必须在一个 Unit of Work 中完成：

```text
保存 session
保存 attempts
保存客观判分
写 learning_evidence
写或更新错题诊断状态
推进 daily_plan_item
更新 mastery_tracks
更新 review_queue
写 domain_outbox
```

AI 深度错因分析异步完成后，在第二个事务中追加：

```text
grading_result
error_diagnosis
decision_observation
新增 learning_evidence
重新计算受影响 mastery_track
调整 review_queue
生成下一教学动作候选
```

所有命令、任务、批改和证据都必须有 `idempotency_key`。同一结果重复提交不得重复累计。

### 15.1 并发控制

- SQLite 使用单写入队列，读操作可以并发，业务层不得自行创建多个写连接竞争。
- 聚合根更新使用乐观锁：`UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`。
- 影响学习主线、掌握轨迹、计划和任务状态的命令必须检查受影响行数；冲突时重新读取并重新决策，不能覆盖。
- 长 AI 请求期间不持有数据库事务和写锁，只在最终提交时开启短事务。
- 任务资源锁使用有租约的 `lock_key/owner/expires_at`，崩溃后可回收；锁不是事实源。
- 同一 `learning_thread` 的状态推进串行，独立内容批次可并行生成。
- 超时后重试前先按幂等键查询结果，避免供应商已返回但客户端误判失败造成重复写入。

### 15.2 可靠事件

领域事件先写 `domain_outbox`，不能在事务提交前直接通知页面或创建下一任务。Consumer 处理成功后标记 `published_at`；处理失败保留事件并退避重试。

页面刷新、掌握增量重算、复习更新、主动信号和后续 Agent 动作都订阅 Outbox。Consumer 自身也必须幂等。

## 16. 增量计算和投影

- 每次提交只重算本次涉及的能力节点及其父节点。
- 页面读取 mastery、daily plan 和 score projection，不扫描 attempts。
- 父节点掌握度由子节点权重聚合。
- 分数预测由考试蓝图、能力掌握和历史模考共同计算。
- 完整重算只用于算法升级、开发校验和数据修复。
- 每次算法结果记录版本，支持对照验证。

## 17. 任务稳定性

任务系统必须支持：

- task/workflow/plan item/mastery track 全链路关联。
- 资源锁和重复派发限制。
- 可取消、可重试、可恢复。
- 指数退避和随机抖动。
- 限流识别和并发降级。
- 阶段检查点。
- 部分成功保留。
- 超时和错误分类。
- 页面重进后读取真实任务状态。
- 任务完成后发布领域事件并刷新目标页面。

iOS 杀进程后无法继续网络 AI 请求。系统必须持久化输入、检查点和已落库批次，恢复后从最近可靠阶段重试，不能伪装成后台持续执行。

### 17.1 App 生命周期恢复

- `background`：停止接收新长任务，节流 flush 流式消息，保存 Agent/Workflow 检查点。
- `foreground`：先检查数据库连接和未发布 Outbox，再恢复任务视图与目标页面。
- 被系统杀死后重启：扫描 `running/cancelling` 任务，根据检查点转为 `resumable/failed/completed`，不能一直显示执行中。
- 供应商请求是否真正完成不可确认时，先检查本地提交和 provider request ID；无可靠结果才重试。
- UI 的内存 Store 只作缓存，恢复逻辑以 Repository 查询为准。

### 17.2 数据加密、备份和恢复

- API Key 仅存 iOS Keychain，不进入 Pinia、日志、任务 payload 和数据库备份。
- SQLite 使用 SQLCipher 或所选 Capacitor SQLite 实现提供的等价加密能力，密钥由 Keychain 随机生成和管理，不从用户弱密码直接派生。
- schema migration 前创建加密本地快照；迁移完成后执行外键检查和 `quick_check`。
- 恢复时先解密到临时数据库，校验 schema、哈希、外键和完整性，通过后再原子替换活动数据库。
- 自动保留数量受控的最近快照，用户可创建加密导出并明确选择是否包含题目资产和音频。
- 启动发现损坏时立即停止业务写入，进入只读诊断、恢复或重置流程，不能边报错边继续污染数据。
- “不迁移旧数据”只针对旧系统；新数据库一旦投入使用，后续 schema 必须前向迁移并保护新学习事实。

### 17.3 数据生命周期

- 考试周期、作答、有效证据、纠错、学习主线和计划决策按用户考试周期保留，用户删除周期时事务级级联清理。
- 掌握快照按阶段和时间降采样，保留关键里程碑，不无限保存每日重复快照。
- 原始 AI 响应默认不长期保存；只有诊断模式或解析失败时短期保留，并限制时间和总空间。
- 已标准化的题目、讲义、评分和错因按内容资产策略保存。
- 任务详细事件完成后可压缩为摘要，但错误、取消、重试和提交边界必须保留审计信息。
- 面试原始音频单独统计空间，允许用户配置保留和一键删除；结构化评分可独立保留。
- 本地日志按时间和空间双上限滚动，不保存密钥和无关个人内容。

### 17.4 元数据升级

- 元数据包安装到 staging 表，完整校验后一次性发布。
- 活动考试周期继续绑定原 curriculum/policy/schema 版本，不自动切换。
- 用户选择升级时先生成差异和影响报告：新增、停用、拆分、合并的能力节点以及受影响计划和投影。
- 节点映射只服务于新架构自身未来版本，不承担旧系统兼容。
- 历史事实保留原版本引用；新证据写入升级后的版本。跨版本趋势必须通过显式映射视图计算。

## 18. Application Service

建议建立以下用例服务：

```text
CreateExamCycleUseCase
RunInitialDiagnosisUseCase
CreateLearningThreadUseCase
AdvanceLearningThreadUseCase
PauseLearningThreadUseCase
BuildDailyPlanUseCase
ReviseDailyPlanUseCase
StartTeachingItemUseCase
SubmitPracticeUseCase
ApplyAIGradingUseCase
ConfirmErrorDiagnosisUseCase
CorrectLearningEvidenceUseCase
CompleteInterventionUseCase
ScheduleReviewUseCase
RunTransferTestUseCase
RecalculateMasteryUseCase
ProjectScoreUseCase
ResumeAIWorkflowUseCase
DetectProactiveSignalsUseCase
DeliverTutorNudgeUseCase
RespondToTutorNudgeUseCase
InstallMetadataPackageUseCase
UpgradeExamCycleMetadataUseCase
CreateEncryptedBackupUseCase
RestoreEncryptedBackupUseCase
```

Domain Service：

```text
MasteryEngine
MasteryPolicy
AssessmentIntegrityPolicy
EvidenceWeightPolicy
ErrorDiagnosisPolicy
TeachingStrategyEngine
DailyPlanEngine
PlanValidator
ReviewScheduler
ScoreProjectionEngine
GenerationSpecBuilder
QuestionQualityValidator
MetadataPackageValidator
TutorContextBuilder
ProactiveSignalDetector
ProactiveTutorPolicy
```

Repository：

```text
ExamCycleRepository
MetadataRepository
CurriculumRepository
ContentRepository
LearningThreadRepository
LearningSessionRepository
LearningEvidenceRepository
ErrorDiagnosisRepository
MasteryTrackRepository
ReviewQueueRepository
DailyPlanRepository
TutorRepository
TaskRepository
ProactiveTutorRepository
OutboxRepository
AIInvocationRepository
```

## 19. 前端业务体验

### 19.1 首页

首页是私教计划中心，不是功能堆叠：

- 今日核心目标和原因。
- 当前正在解决的薄弱点。
- 今日讲解、训练和复习顺序。
- 预计用时。
- 目标分差距和阶段进度。
- AI 私教建议。

### 19.2 刷题页

- 展示当前教学目标，不堆砌统计。
- 错题批改后直接在原题显示对错、解析和错因。
- 低置信度错因触发一个简短追问。
- 一条能力主线推进后明确显示为什么升级或继续。
- 讲义、题目、作答、解析和错因使用固定内容区域模板。

### 19.3 AI 对话框

- AI 始终知道当前考试周期和教学目标。
- 工具执行显示实际工具，不与任务摘要混淆。
- 普通聊天不创建 task。
- 教学任务关联 plan item 和 mastery track。
- AI 在教学过程中分阶段反馈，不只在结束时追加固定总结。

### 19.4 能力页面

不以刷题数量为中心，展示：

- 已解决知识缺口。
- 正在改善的薄弱点。
- 已稳定掌握和发生退化的能力节点。
- 错因复发趋势。
- 保持度和迁移能力。
- 当前预测分、置信度和目标差距。

## 20. 可观测性

本地记录不含 API Key 和敏感完整内容的运行指标：

- SQLite 查询和事务耗时。
- 页面首屏耗时。
- 任务排队、首 token 和完成耗时。
- AI 重试、限流和结构修复次数。
- 生题批次通过率。
- 任务恢复成功率。
- 掌握状态迁移原因。
- 算法版本和计算耗时。

调试日志本地保存并限制数量，支持用户主动导出，不自动上传。

### 20.1 产品效果指标

北极星指标不是日活和刷题量，而是个人能力提升效率：

```text
time_to_stable_mastery       从发现缺口到稳定掌握的时间
items_to_stable_mastery      达到稳定掌握消耗的有效题量
retention_pass_rate          间隔保持通过率
transfer_pass_rate           新材料迁移通过率
error_recurrence_rate        同类确认错因复发率
thread_completion_quality    学习主线按独立证据完成的比例
score_projection_calibration 预测区间对真实模考的覆盖和误差
```

护栏指标包括无效题率、用户纠错率、错误工具调用率、计划拒绝率、主动提醒关闭率、每个成功教学动作 token 和任务恢复失败率。

产品只展示有足够证据支持的变化。数据不足时显示趋势和区间，不能把相关性包装成“AI 已帮你提升 X 分”。

## 21. 测试策略

### 21.1 数据层

- 外键、唯一约束和级联删除。
- migration 重复执行。
- Unit of Work 回滚。
- 幂等重复提交。
- SQLite 和 IndexedDB Repository 合约一致性。
- 大量证据下的索引性能。
- 元数据包原子发布、版本固定和升级影响测试。
- 乐观锁冲突、Outbox 重放和多任务写入测试。
- 加密备份、完整性校验、恢复失败不替换原库。

### 21.2 领域层

- 掌握状态迁移表驱动测试。
- 少量样本不会过度提升掌握度。
- 提示作答权重低于独立作答。
- 复习失败触发退化。
- 迁移失败不会标记完全掌握。
- 连续失败触发教学策略切换。
- 每日计划遵守时间和比例约束。
- 训练题不能作为锚定掌握证据。
- 证据纠错后掌握、计划、复习和预测分正确重算。
- 行测、申论和面试使用各自评估策略。
- 学习主线跨日、暂停、恢复和退出条件测试。

### 21.3 AI 合同

- 工具参数 schema。
- 生题 JSON schema。
- 批改和错因枚举。
- 不确定意图确认。
- 结构修复重试上限。
- 不允许 AI 直接写掌握状态。
- Prompt/Skill/Tool/Schema 版本和按需加载。
- Agent 循环、工具权限、预算耗尽和重复调用收束。
- Context Compiler 相关性、脱敏、摘要失效和 token 预算。
- Anthropic/OpenAI Provider 合约和事件归一化。

### 21.4 端到端

```text
建档
→ 初始诊断
→ 创建学习主线
→ 生成今日计划
→ 讲解
→ 生题
→ 作答
→ 批改
→ 错因确认
→ 掌握轨迹更新
→ 复习到期
→ 复习
→ 迁移测试
→ 独立确认掌握
→ 预测分更新
```

## 22. 实施阶段

### Phase 0：冻结旧模型

- [ ] 将架构索引、宪法和本文档设为新架构实施依据，按文档优先级处理冲突。
- [ ] 禁止继续扩展旧 `AbilityProfile`、`LearningEvent` 和 `ExamPlan.tasks`。
- [ ] 新增架构检查，禁止新业务直接导入 `database`。
- [ ] 新增架构检查，禁止页面、AI Runner 和工具直接修改核心领域表。
- [ ] 建立新数据库和开发重置入口。

验收：旧业务模型不再新增字段和分支。

### Phase 1：关系型数据基础

- [ ] 建立仅服务于新数据库后续版本演进的 SQLite schema migration runner。
- [ ] 建立新 schema、外键、约束和索引。
- [ ] 建立元数据包、能力图谱、Policy、Rubric、Prompt、Skill 和 Schema 版本基础。
- [ ] 建立 Unit of Work。
- [ ] 建立乐观锁、资源租约和事务 Outbox。
- [ ] 建立 Repository 接口和 SQLite 实现。
- [ ] 建立 IndexedDB 合约实现。
- [ ] 建立 Keychain 密钥、数据库加密、备份和恢复骨架。
- [ ] 增加 Repository 合约测试。

验收：业务层不感知 SQLite/IndexedDB，事务和幂等测试通过。

### Phase 2：考试周期、能力图谱和诊断

- [ ] 重做建档，创建 exam cycle、目标和时间约束。
- [ ] 建立版本化元数据包、能力图谱和考试蓝图。
- [ ] 建立前置、关联和迁移关系。
- [ ] 实现渐进式冷启动和自适应初始诊断。
- [ ] 首页和“我的”改读新档案。

验收：每个项目有且只有一个活动考试周期；知识、认知、技能、策略和表达能力拥有稳定 ID；数据不足时不伪造精确画像。

### Phase 3：学习会话和证据链

- [ ] 重写题组、会话、作答和判分写入。
- [ ] 采集耗时、修改、信心和提示级别。
- [ ] 建立结构化错因和用户确认。
- [ ] 标记教学、引导、练习、保持、迁移和锚定评估角色。
- [ ] 建立题目暴露记录、证据有效性和追加纠错。
- [ ] 一次提交使用一个事务。
- [ ] 移除旧练习统计回写。

验收：重复提交不重复累计，任意失败不会产生半份数据。

### Phase 4：掌握引擎和复习调度

- [ ] 实现证据权重策略。
- [ ] 实现多维掌握模型。
- [ ] 实现行测、申论、面试独立 Assessment/Mastery Policy。
- [ ] 实现状态机和可信度。
- [ ] 实现 learning thread 创建、推进、暂停、恢复和退出。
- [ ] 实现前置知识下钻。
- [ ] 实现 review queue 和遗忘调度。
- [ ] 实现保持、迁移和锚定评估隔离。
- [ ] 实现增量父节点聚合。

验收：同样答错但错因不同，会生成不同教学动作和复习安排；未经独立验证不能进入稳定掌握。

### Phase 5：每日计划和周期把控

- [ ] 实现本地基础计划。
- [ ] 实现 AI 计划审核。
- [ ] 实现计划版本、调整原因和退出条件。
- [ ] 实现题量、时间、疲劳和比例约束。
- [ ] 实现阶段里程碑和预测分。
- [ ] 首页切换到新计划模型。

验收：每日计划可解释、可追溯、可恢复，不依赖 AI 才能打开。

### Phase 6：教学闭环和内容生成

- [ ] 建立教学蓝图、讲义和题组关联。
- [ ] 所有内容绑定 learning thread、能力节点、评估角色和元数据版本。
- [ ] 实现讲解、引导、独立、变式、限时和迁移动作。
- [ ] 实现 GenerationSpec。
- [ ] 实现分批生题和首批展示。
- [ ] 实现质量校验、修复和去重。
- [ ] 实现连续失败后的策略切换。

验收：能力主线能由浅入深推进，题目与讲义一致，失败不会无限重复刷题。

### Phase 7：AI 私教编排

- [ ] 按 `ai-service-architecture.md` 建立 Provider Gateway、Model Router 和类型化响应。
- [ ] 建立 Prompt Registry/Compiler、Skill Registry/Resolver 和 Context Compiler。
- [ ] 将生成、批改和计划拆为可恢复工作流状态机。
- [ ] 建立标准化私教工具、Policy Guard 和多 turn Tutor Agent Runtime。
- [ ] 对话工具关联考试周期、学习主线、计划项、掌握轨迹和目标资源。
- [ ] 实现低置信度确认。
- [ ] 实现教学过程中的阶段反馈。
- [ ] 实现每日和阶段复盘。
- [ ] 实现主动信号检测和去重。
- [ ] 实现主动程度、安静时段和冷却策略。
- [ ] 实现学习前、学习中、学习后和周期型主动干预。
- [ ] 实现主动建议的接受、忽略和效果回流。
- [ ] 建立调用账本、token/成本预算、Provider 限流降级和固定评测集。

验收：Tutor Agent 能受控执行多步工具并根据结果继续教学；每次调用可追溯且不串会话；AI 能解释为什么学、如何教、是否掌握以及下一步做什么；关键学习信号出现时能够适时主动介入但不会重复打扰。

### Phase 8：页面切换和旧代码删除

- [ ] 首页、计划、刷题、错题本、能力画像全部切新 Query Service。
- [ ] 删除旧 database store 和 Repository。
- [ ] 删除旧 JSON/Markdown 业务兼容逻辑。
- [ ] 删除旧能力和计划算法。
- [ ] 完成老版 Agent 有效能力迁移后，删除旧提示词、一次性 Router、巨型 Runner 和文件工具业务依赖。
- [ ] 全量构建、真机回归和性能基准。

验收：运行时不再读取旧业务模型，核心页面无全表扫描。

### Phase 9：算法校准

- [ ] 使用固定模拟考生数据回放。
- [ ] 校准证据权重和掌握阈值。
- [ ] 校准题量和疲劳约束。
- [ ] 校准分数预测误差。
- [ ] 对比不同教学策略效果。
- [ ] 校准冷启动题量、保持/迁移阈值和预测区间覆盖率。
- [ ] 校准 Agent 工具选择、主动干预和每个成功教学动作成本。
- [ ] 所有算法记录版本。

验收：算法变化可解释、可回放、可比较，不凭主观调整常量。

## 23. 完成标准

只有同时满足以下条件，才算完成本次重构：

- 同一道错题可以因不同错因进入不同教学路径。
- 每个重点能力缺口都有跨日学习主线、长期掌握轨迹和明确状态。
- 掌握必须经过独立、变式、间隔和迁移证据验证。
- 每日计划由目标差距、薄弱点、复习、时间和疲劳共同决定。
- AI 能解释计划，并在约束内调整教学策略。
- 生题、批改、错因、掌握、复习和计划形成完整事务链路。
- 退出重进后任务、计划和掌握状态一致。
- AI 失败、限流和 iOS 杀进程后可以从可靠检查点恢复。
- 页面不扫描完整历史，常用本地查询符合性能预算。
- 数据层具有明确外键、索引、唯一约束、事务和幂等。
- 元数据、主数据、学习事实、内容、决策、投影和运行数据边界清晰。
- 错误 AI 内容和误判证据可以纠正，并完整消除对投影的污染。
- Tutor Agent 具备多步工具循环、Skills 按需加载、上下文预算和风险防线。
- 新数据库具备加密、备份、恢复、完整性检查和自身版本演进能力。
- 新增业务通过领域边界扩展，不直接修改页面和数据库。
- 旧业务与数据兼容代码全部删除。

## 24. 当前实施进度

| 阶段 | 状态 |
|---|---|
| 产品定位与架构设计 | done |
| Phase 0 冻结旧模型 | done |
| Phase 1 关系型数据基础 | done |
| Phase 2 考试周期和知识图谱 | done |
| Phase 3 学习证据链 | done |
| Phase 4 掌握与复习引擎 | in_progress |
| Phase 5 每日计划与周期把控 | in_progress |
| Phase 6 教学闭环和内容生成 | in_progress |
| Phase 7 AI 私教编排 | done（发布前保留真机供应商回归） |
| Phase 8 页面切换和旧代码删除 | done（旧 AI/Task/legacy fallback 已删除） |
| Phase 9 算法校准 | pending |

当前代码执行入口以 [拆分实施计划](./implementation-roadmap.md) 为准。新核心已具备考试周期和能力元数据、内容 Schema/Repository、统一 Markdown 内核、版本化 Prompt、Provider Gateway、可信 Context Compiler、调用账本、客观题作答事实、错因候选、掌握投影、复习队列、每日计划提案和计划项状态回写。

2026-07-26 可靠性收口：

- IndexedDB Unit of Work 串行覆盖“读取、暂存写入、提交”完整临界区，避免并发丢更新。
- 全量备份不再受页面查询上限影响，恢复在单事务内清理并重建学习事实。
- 客观题交卷后处理由同一应用用例执行，并由限定事件类型的 Outbox Worker 持久恢复。
- Agent 调度按最早可执行时间取任务，不再由最近 50 条视图造成旧任务饥饿。
- 页面任务栏、铃铛和 AI 对话框共用单一 Pinia 状态源。
- 能力质量报表按模块计算正确率、速度、未闭环错题和重复错误，不再混用全局错题数。
- Vue 页面直接 Repository 访问已清零，并加入架构检查。
- 完整 Web 构建、数据库 Schema、设计系统、元数据和 iOS 资源同步已通过。

最新断点：

- 客观题链路已经可以把作答、判分、错因候选、掌握刷新、复习队列和每日计划项关联起来；退出重进、前后台恢复和真机限流场景仍需回归。
- `AgentRun` 已成为新业务唯一任务实体；结构化刷题生题已具备计划解析、上下文准备、提示词编译、模型调用、解析、质检、落库等持久进度，支持最多 3 个并发、取消、限流退避、页面重进恢复和完成跳转。`GenerationWorkflow` 只负责内部生成检查点。
- `MessageCenter` 已建立 SQLite/IndexedDB 双适配和公开发布接口，按私教、刷题、申论、面试、计划、复习、模考、积累、档案、系统分类；铃铛支持业务线过滤、未读、归档和业务跳转。
- AI 气泡、输入框上方任务栏、铃铛和顶部轻提示已统一读取 `AgentRun`，页面发起的生题不再是黑盒；聊天工具执行区与业务任务区保持分离。
- 所有用户可见长任务统一使用 `AgentRun`；旧 `LocalTask/TaskQueue/TaskStore`、旧 AI Provider 和 legacy fallback 已删除。
- 内容生成、长期学习主线、客观学习证据、计划/复习联动和主观题 Rubric 证据已形成基础闭环；复杂题型专用模板和主观评分校准属于下一阶段深化。
- 旧 Python Agent、旧 HTML 页面、旧 LocalTask/TaskQueue、旧数据库访问层和 legacy fallback 已删除；保留的 Service 是面向页面的应用门面，数据真相仍归模块 Repository。
