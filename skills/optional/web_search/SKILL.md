---
name: web-search
description: 搜索网页和抓取网页内容，用于查找最新信息、文档或技术资料
tools: [web_search, fetch_page]
auto_load: false
---

# Web Search

搜索网页和获取页面内容。

## 何时使用
- 用户要求搜索最新信息、新闻、文档
- 需要验证某个技术问题的最新解决方案

## 使用方式
1. 先调用 web_search(query, num_results) 搜索
2. 从结果中找到相关 URL
3. 调用 fetch_page(url, max_chars) 获取详细内容

## 注意事项
- web_search 返回的是标题+URL 摘要，不含全文
- fetch_page 会截断过长内容（默认 5000 字符）
- 部分网站可能无法访问（返回错误时换其他来源）
