---
name: task-mgmt
description: 创建和管理任务，跟踪进度和依赖关系
license: MIT
compatibility: zhangl-agent
allowed-tools: Read, Write
metadata:
  category: core
tools: [task_create, task_update, task_list]
auto_load: true
---

# Task Management

创建任务、更新状态、查看进度。

## 工具

| 工具 | 作用 |
|------|------|
| task_create | 创建新任务，可设置依赖关系 |
| task_update | 更新任务状态 |
| task_list | 查看所有任务及其进度 |
