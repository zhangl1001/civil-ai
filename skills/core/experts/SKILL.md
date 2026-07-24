---
name: experts
description: 委派任务给专家子 Agent，用于并行处理多领域任务
license: MIT
compatibility: zhangl-agent
allowed-tools: Read, Write
metadata:
  category: core
tools: [spawn_expert, kill_expert]
auto_load: true
---

# 专家系统

需要多领域并行工作时，使用 `spawn_expert` 委派给专家子 Agent。

## 专家类型

| 类型 | 职责 |
|------|------|
| `data-analysis-expert` | 资料分析出题与批改 |
| `essay-expert` | 申论批改与素材搜索 |
| `practice-expert` | 行测各模块出题 |

## 使用原则

- 简单任务直接做，不值得启动专家
- 大任务先写 task_plan.md 计划，再并行 spawn 专家
- 指令中必须包含项目路径和文件路径

## 示例

```
spawn_expert(type=practice-expert, task="读取 projects/公考练习/能力画像.json，为资料分析的增长率计算出 5 道练习题")
```
