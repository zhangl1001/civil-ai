---
name: file-ops
description: 文件读写、目录浏览
license: MIT
compatibility: zhangl-agent
allowed-tools: Read, Write, Edit
metadata:
  category: core
tools: [read_file, write_file, list_files]
auto_load: true
---

# File Operations

读写文件、浏览目录。

## 工具

| 工具 | 作用 |
|------|------|
| read_file | 读取文件内容（支持文本和图片） |
| write_file | 写入文件，自动创建目录 |
| list_files | 列出目录内容 |
