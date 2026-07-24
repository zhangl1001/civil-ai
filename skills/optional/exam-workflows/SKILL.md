---
name: exam-workflows
description: All workflow procedures — daily plan, review queue, mastery criteria, adaptive pacing, study plan, weakness analysis, custom questions, targeted drilling, wrong question redo, mock exam, daily content
license: MIT
compatibility: zhangl-agent
allowed-tools: Read, Write, Edit, Bash(web_search:*)
metadata:
  package: zhangl-exam-workflows
  version: 2.0.0
  category: exam
match_keywords: [备考计划, 薄弱分析, 模拟考试, 自定义出题, 专项突破, 错题重做, 每日热点, 每日知识点, 首次使用, 每日计划, 今日练习, 申论, 申论练习]
---

## INDEX — jump directly to the section you need

Formats (question/grading/error types/tables) → see **exam-formats** skill.

| ID | Section | When to read |
|----|---------|--------------|
| B1 | Daily Plan Core | Executing "今日练习" — review + lecture + questions + grading |
| B2 | Review Queue Rules | Step 1 of daily plan |
| B3 | Mastery Criteria | Step 2: checking if topic is mastered |
| B4 | Adaptive Pacing | Step 2: deciding question count and difficulty |
| B5 | Daily Rating | After grading: computing daily score |
| B6 | Study Plan Creation | "制定备考计划" / first use |
| B7 | Weakness Analysis | "薄弱分析" |
| B8 | Custom Question Generation | "自定义出题：{module} {N}题" |
| B9 | Targeted Drilling | "专项突破：{module}" |
| B10 | Wrong Question Redo | "错题重做 模块:{X} 错题:{N}" |
| B11 | Mock Exam | "模拟考试" |
| B12 | Daily Content | "每日热点" / "每日知识点" |

---

## B1 — Daily Plan Core

The daily plan workflow is defined in the **system prompt Section 2**. This section provides the parameters referenced by each step.

- Step 1 (Review) → **B2** for queue rules
- Step 2 (Lecture + Practice) → **B3** for mastery check + **B4** for adaptive pacing + **exam-formats A4** for difficulty/distribution
- Step 3 (Grading) → **exam-formats A2, A3** for format + **B5** for daily rating
- update_stats fields: mode, module, date, total, correct, knowledge_points, time_seconds, time_suggested_seconds, results[]
- Mode values: 日常=practice, 复习=review, 申论=essay, 模考=mock_exam

---

## B2 — Review Queue Rules

First step of daily plan. `next_review <= today` → generate 3-5 review questions.

- Accuracy ≥80% → double interval: 1→3→7→15→30→60→remove from queue
- Accuracy <80% → halve interval (min 1 day)
- Fail 2 consecutive times → remove from queue, revert syllabus to "未学"

---

## B3 — Mastery Criteria

Based on proficiency (accuracy + speed + consistency composite, NOT raw accuracy):

| Phase | Mastered | Needs relearning |
|-------|----------|-----------------|
| Foundation (基础期) | proficiency≥0.70 AND ≥15 Q | proficiency<0.50 AND ≥8 Q |
| Reinforcement (强化期) | proficiency≥0.75 AND ≥20 Q | proficiency<0.55 AND ≥10 Q |
| Sprint (冲刺期) | proficiency≥0.80 AND ≥25 Q | proficiency<0.60 AND ≥12 Q |

Mastered → update syllabus + 能力画像 + review queue (interval=1). Learning → add 5-10 Q. Needs relearning → re-teach, new approach, new questions. Module done → next module. All modules done → manually update 备考计划.json phase.

---

## B4 — Adaptive Pacing

Read `能力画像.json` before each question generation. Phase targets: Foundation ≥0.70, Reinforcement ≥0.75, Sprint ≥0.80.

**Per-topic question count:**
- proficiency < target → count ×1.5, difficulty down one notch
- proficiency at target to target+0.05 → normal
- proficiency ≥ target+0.10 → count ×0.5, difficulty up one notch

**Overall pacing:**
- 3 days below B → reduce count, lower difficulty
- 3 days above A → raise difficulty
- is_plateau=true → plateau phase, MUST change approach (more drills = waste)
- roi.score <0.3 → poor ROI, prioritize high-ROI topics
- Zero improvement for a week → change teaching method, NOT difficulty

---

## B5 — Daily Rating

Computed by update_stats: accuracy (50) + completion (30) + time (20).
Grades: S(≥95) / A(≥85) / B(≥70) / C(≥60) / D(<60).
Sundays: 10-15 mixed comprehensive questions.

---

## B6 — Study Plan Creation

Trigger: "制定备考计划" / first use.

1. Ask: exam type, target province, baseline, daily time, target score, exam date
2. web_search "{province} {year} 公务员考试大纲 行测 题型分布" → confirm question distribution, duration, special types
3. Generate `备考计划.json` + `syllabus/{module}.json` (7-15 topics/module, mandatory ≤50%, special types listed separately)

---

## B7 — Weakness Analysis

Trigger: "薄弱分析".

Read 能力画像 + practice stats (last 30 records). Sample size: <5 insufficient / 5-14 moderate / 15-29 adequate / ≥30 highly sufficient. Mastery judgment → B3.

---

## B8 — Custom Question Generation

Trigger: "自定义出题：{module} {N}题".

① Create/append `练习/{module}/{date}.md`, first line `# {module} | {date}`. ② Select topics (unlearned first, then recent). ③ New file: `## 讲义：{topic}` → `## 练习题`. Append: continue numbering. ④ Difficulty → exam-formats A4. ⑤ Generate {N} questions, answers inline. File MUST have `## 练习题` header.

---

## B9 — Targeted Drilling

Trigger: "专项突破：{module}".

① Read 能力画像, find topics below phase target (B3). ② Read 错题本 last 50 lines. ③ Pick 2-3 weakest topics. ④ Insert `## 加练题` in `练习/{module}/{date}.md`. ⑤ Generate 5 targeted questions, continue numbering.

---

## B10 — Wrong Question Redo

Trigger: "错题重做 模块:{X} 错题:{N}".

① Locate Q{N} in `练习/{module}/*.md`. ② Extract topic + error type. ③ Generate variant: same topic, different data/details, shuffled options. ④ Append under `## 错题重做`, continue numbering.

---

## B11 — Mock Exam

Trigger: "模拟考试（日期：{date}）" or "模拟考试：{modules} 共{N}题...".

① Read `备考计划.json` exam_info for total_questions, total_time_minutes, module proportions.

② Generate questions per module. Use `write_questions` for each module to ensure A1 formatting (answer-block wrapping, proper separators).

③ **CRITICAL: Combine ALL module sections into ONE file** at `练习/模拟考试/{date}.md`. Use `## {模块名}` as section headers between modules. NEVER write separate files per module. The frontend expects exactly this path pattern.

File structure:
```
# 模拟考试 | 2026-06-29

共120题 | 建议用时120分钟

## 资料分析
**1.** ...
**2.** ...

## 判断推理
**7.** ...
**8.** ...

## 言语理解
...
```

④ Format each question per exam-formats A1 (answer-block, `---` separator). Number questions sequentially across all modules (1-120, not restarting per module).

⑤ Grading: standard flow + per-module accuracy report. Call update_stats with mode="mock_exam".

---

## B12 — Daily Content

**Daily current affairs (每日热点):** web_search today's news → write_file `每日热点/{date}.md`.

**Daily knowledge snippets (每日知识点):** bite-sized facts (idioms, general knowledge, law, etc.) → `每日知识点/{date}.md`.

**Avoid repetition:** list_files today's directory, read last 3 days, exclude covered content.

## B13 — 申论每日练习

Trigger: "申论每日练习" or "申论练习" or "申论写作".

1. Read `能力画像.json` to check essay history.
2. Build question: type identification → materials → requirements.
3. **CRITICAL: Follow exam-formats A5 EXACTLY.** write_file to `练习/申论/{date}.md`:

```
## 讲义
...lecture...

<div class="question-block">
## 题目
...materials + requirements...
</div>

<div class="answer-block">
## 答案
...参考范文...
</div>

## 答案区（用户作答）
```

The `<div class="question-block">` and `<div class="answer-block">` wrappers are MANDATORY — same as 行测 uses `<div class="answer-block">` per question. The frontend relies on these divs for tab splitting and answer collapsing. write_file ONCE with the complete content.
