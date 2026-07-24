---
name: exam-formats
description: All format specifications — question, grading, error types, difficulty tables, topic distribution, lecture, file structure, wrong answer archive, essay grading
license: MIT
compatibility: zhangl-agent
allowed-tools: Read, Write, Edit
metadata:
  package: zhangl-exam-formats
  version: 2.0.0
  category: exam
match_keywords: [出题, 批改, 格式, 题目, 讲义, 图推, 图形推理, 申论作答, 申论]
---

## INDEX — jump directly to the section you need

| ID | Section | When to read |
|----|---------|--------------|
| A1 | Question Format | Generating questions, writing practice files |
| A2 | Grading Format | Grading answers, inserting feedback inline |
| A3 | Error Types | Classifying wrong answers |
| A4 | Difficulty & Distribution | Difficulty mix (★/★★/★★★ ratio) and topic allocation by proficiency |
| A5 | Lecture & File Structure | Writing lecture notes, creating/structuring files |
| A6 | Wrong Answer Archive | Archiving wrong answers to 错题本 |
| A7 | Essay Grading | Grading 申论 answers |

---

## A1 — Question Format

Every question MUST follow this exact structure. The `<div class="answer-block">` wrapper is REQUIRED — the frontend uses it to detect answer sections for collapse/expand.

**Think, then write.** Figure out the answer completely in your head before writing. 解题步骤 is the polished final solution — never a discovery trail with wrong turns.

**Diagram reasoning MUST use SVG.** No text-only diagram questions. Each figure: independent SVG, max 200px, stroke="#333", fill="none".

**REQUIRED structure for every question:**

**N.** （★★ 考点）题目正文

(blank line)
A. 选项一
(blank line)
B. 选项二
(blank line)
C. 选项三
(blank line)
D. 选项四
(blank line)

&lt;div class="answer-block"&gt;

**答案** C

**解题步骤**
1. First step — one line per step, no paragraphs
2. Second step

**考点** topic name, ≤15 chars

**避坑** one-line tip

&lt;/div&gt;

---

Rules:
- One blank line between every option. One blank line between question text and first option.
- `<div class="answer-block">` wraps ALL answer content. Real HTML div, NOT inside markdown code block.
- **CRITICAL: Each bold label (like **答案**, **解题步骤**) goes on its OWN line. Content goes on the NEXT line. Never put label and content on the same line like "**答案** B" — write "**答案**" then newline then "B".**
- Blank line between fields (after content, before next bold label).
- 解题步骤: each step is a numbered line (1. 2. 3.), one reasoning step per line, max 4 steps.
- `---` on its own line separates every question.

---

## A2 — Grading Format

### 插入位置

每道题以 `---` 结尾。**批改块紧贴 `---` 前面插入。`---` 不动不删。**

```
批改前：答案区最后一行 → ---

批改后：答案区最后一行 → 批改块 → ---
```

### 答对格式

```
<div class="grading-block correct">

### ✅ 正确

</div>
```

### 答错格式

```
<div class="grading-block wrong">

### ❌ 错误

**你的答案** B

**错因** {概念性错误 / 理解性错误 / 执行性错误}
{具体说明，一针见血}

</div>
```

规则：
- 批改块只放批改结果（✅/❌、你的答案、错因），不放正确答案和解题步骤——那些在答案块里已经有了。
- 每题只有**一个**批改块。不改原题文字。
- 批改块用 `<div class="grading-block correct">` 或 `<div class="grading-block wrong">` 包裹，紧贴 `---` 前面插入。
- 正确题只写 `### ✅ 正确`。错因从 A3 三选一。

---

## A3 — Error Types

Exactly one of three. **IMPORTANT: update_stats tool requires Chinese values.**

| Value to pass | English meaning | Criteria |
|---------------|---------|----------|
| `概念性错误` | Conceptual error — didn't grasp concept | Wrong formula, confused definitions — entire approach wrong |
| `理解性错误` | Comprehension error — right direction, wrong middle | Misunderstood question, misread data, logical leap |
| `执行性错误` | Execution error — careless mistake | Calculation error, copied wrong option, missed condition — right method, flawed execution |

---

## A4 — Difficulty & Distribution

**Difficulty** by module accuracy (read `能力画像.json`):

| Accuracy | ★:★★:★★★ | Note |
|----------|-----------|------|
| < 40% | 5:4:1 | Fundamentals |
| 40-60% | 3:5:2 | Medium focus |
| 60-80% | 2:4:4 | Mid-high balance |
| ≥ 80% | 1:3:6 | Advanced |
| No data | 3:4:3 | Default |

**Topic distribution** by proficiency: <0.40 → 40% / 0.40-0.60 → 30% / 0.60-0.80 → 15% / 0.80-0.90 → 10% / >0.90 → 5%.

---

## A5 — Lecture & File Structure

**Lecture (行测):** concept → solution steps → common types (≥2) → pitfalls (≥2) → worked examples

**Lecture (申论):** type identification → answer framework → scoring points → common mistakes (≥2) → worked examples. Check `每日热点/{date}.md` first.

**File (行测):** `练习/{module}/YYYY-MM-DD.md`
```
# {module} | {date}
## 间隔复习              ← if review items
## 讲义：{topic}
## 练习题                ← REQUIRED for frontend
```
Answers inline. No separate answer section.

**File (申论):** `练习/申论/YYYY-MM-DD.md`
```
## 讲义
...lecture content (format reference)...

<div class="question-block">
## 题目                   ← materials + requirements
...question content...
</div>

<div class="answer-block">
## 答案                   ← reference answer / scoring guide
...参考范文/评分要点...
</div>

## 答案区（用户作答）
```

**CRITICAL:** Both `<div class="question-block">` and `<div class="answer-block">` wrappers are REQUIRED — same convention as 行测 A1. The frontend uses `question-block` to identify the question section for tab splitting, and `answer-block` to collapse standard answers by default.

**Extra practice:** Insert `## 加练题`, continue numbering.

---

## A6 — Wrong Answer Archive

Append to `错题本/{module}.md`:
```markdown
### Q4 | topic | date
**Question:** [full question text — include the complete stem and options]
- Your answer: B | Correct answer: A
- Error cause: ...
- Correct approach: ...
- Tip: ...
```

**CRITICAL — @see rule:** Only use `@see 练习/module/date.md Q4` for **资料分析** questions (which contain charts/tables/SVGs that cannot be reproduced in plain text). For ALL other modules (言语理解, 判断推理, 数量关系, 常识判断), write the **full question text** inline — never use @see for non-资料分析 items.

---

## A7 — Essay Grading

Append after `## 答案区`:
```
### AI 批改
> **Total X/{score}** | Coverage X/5 | Logic X/3 | Expression X/4 | Word count ✓/✗
> ❌ Missing points: ...
> ✅ Highlights: ...
```

---

*Daily Completion JSON auto-generated by update_stats.*

## A8 — Sample Questions (Template Reference)

When generating questions, ALWAYS reference these samples for style, structure, and quality. Mimic the exact format, option phrasing, and solution step granularity.

### 言语理解 — 逻辑填空

**1.** （★★ 实词辨析）传统戏曲的传承困境，很大程度上在于其与当代生活的＿＿。让传统戏曲在保持艺术特质的同时，以更＿＿的方式融入现代人的文化生活，是破解传承难题的关键。

A. 脱节 多元  
B. 割裂 亲和  
C. 疏离 恰当  
D. 断层 快捷

**答案** B
**解题步骤** 1. 第一空需表达"分离、不融合"之意，"割裂""断层"程度较重，"脱节""疏离"偏轻，结合语境选"割裂"。2. 第二空需与"融入现代人生活"呼应，"亲和"最贴切。
**考点** 实词辨析：词语的程度轻重和语境搭配
**避坑** "断层"语义过重，戏曲和当代生活并非完全断裂，只是连接不够。

### 判断推理 — 逻辑判断

**1.** （★★★ 削弱论证）某研究机构对 5000 名成年人进行了为期 10 年的追踪调查，发现每天饮茶超过 3 杯的人群中，心血管疾病发病率比不饮茶人群低 28%。因此研究者认为，饮茶能够有效降低心血管疾病风险。

以下哪项如果为真，最能削弱上述结论？

A. 每天饮茶超过 3 杯的人群中，同时有较高比例的人保持规律运动习惯  
B. 该研究的调查对象主要集中在产茶地区，饮茶文化较浓厚  
C. 心血管疾病发病率受遗传因素影响较大，饮茶的作用相对有限  
D. 不饮茶人群中有一部分人每天饮用咖啡，咖啡也有类似功效

**答案** A
**解题步骤** 1. 论点：饮茶降低心血管疾病风险。2. 论据：饮茶人群发病率低 28%。3. A 指出存在他因（运动习惯），直接削弱因果关系。B 仅质疑样本代表性，力度弱于 A。C 承认有作用但有限，不完全否定。D 讨论咖啡，不直接削弱茶的作用。
**考点** 因果削弱的优先级：他因 > 因果倒置 > 样本偏差 > 作用有限
**避坑** 削弱题优先找"他因解释"，而非质疑样本或淡化效果。

### 资料分析 — 增长率

**1.** （★★ 同比增长率）2022 年上半年，某省规模以上工业增加值同比增长 7.2%，增速比一季度加快 1.5 个百分点。其中，3 月份同比增长 8.1%，4 月份同比增长 6.5%，5 月份同比增长 7.8%，6 月份同比增长 9.2%。

2022 年一季度该省规模以上工业增加值同比增长率约为：

A. 5.7%  
B. 6.2%  
C. 6.8%  
D. 7.2%

**答案** A
**解题步骤** 1. 上半年增速 7.2%，比一季度快 1.5 个百分点。2. 一季度增速 = 7.2% - 1.5% = 5.7%。
**考点** 百分点与百分比的区别：增速加快 X 个百分点 = 直接加减
**避坑** 不要被 3-6 月的单月数据迷惑，题目问的是一季度整体。

### 数量关系

**1.** （★★ 工程问题）一项工程，甲队单独完成需要 12 天，乙队单独完成需要 18 天。现甲队先单独工作 3 天后，乙队加入，两队合作完成剩余工程。问完成整个工程共需要多少天？

A. 6.6 天  
B. 7.2 天  
C. 8.4 天  
D. 9 天

**答案** C
**解题步骤** 1. 设工程总量为 36（12 和 18 的最小公倍数）。2. 甲效率 = 36/12 = 3/天，乙效率 = 36/18 = 2/天。3. 甲单独 3 天完成 9，剩余 27。4. 合作效率 = 3+2 = 5/天。5. 剩余天数 = 27/5 = 5.4 天。6. 总天数 = 3 + 5.4 = 8.4 天。
**考点** 设工程总量为最小公倍数，简化计算
**避坑** 注意问的是"总天数"，包含甲单独工作的 3 天。

### 常识判断

**1.** （★★ 法律常识）根据我国《民法典》，下列关于诉讼时效的说法，正确的是：

A. 所有民事权利的诉讼时效均为 3 年  
B. 诉讼时效期间自权利人知道权利受损之日起计算  
C. 超过诉讼时效，权利人丧失起诉权  
D. 当事人可以约定延长或缩短诉讼时效期间

**答案** B
**解题步骤** 1. A 错误：有特殊规定（如国际货物买卖 4 年等）。2. B 正确：民法典 188 条。3. C 错误：丧失胜诉权而非起诉权（仍可起诉）。4. D 错误：诉讼时效法定，不可约定变更。
**考点** 诉讼时效的基本规则和常见误区
**避坑** 特别注意"起诉权 ≠ 胜诉权"这个常考点。
