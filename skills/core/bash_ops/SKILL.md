---
name: bash-ops
description: 执行 Shell 命令，用于探索环境或作为其他工具失败的 fallback
license: MIT
compatibility: zhangl-agent
allowed-tools: Bash
metadata:
  category: core
tools: [run_bash]
auto_load: true
---

# Bash Operations

执行 Shell 命令进行环境探索。

## 工具

| 工具 | 作用 |
|------|------|
| run_bash | 执行只读 shell 命令（ls, find, grep, git log 等） |
