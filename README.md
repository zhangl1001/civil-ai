# Civil AI

面向个人备考周期的本地优先 AI 公考私教，也是一个可复用的端侧 Agent Runtime 实验项目。

> 项目仍处于积极开发阶段。题目、模型输出和学习建议仅用于辅助学习，不构成考试机构的官方意见。

## 特性

- Vue 3 + TypeScript 的移动端 Web UI
- Capacitor iOS 容器，iOS 使用 SQLite，Web 开发环境使用 IndexedDB
- 支持 Anthropic 与 OpenAI-compatible Provider Gateway
- 统一的 AgentRun Runtime，覆盖生成、批改、规划、工具调用、暂停与恢复
- 本地优先：项目不依赖自有云后端；模型请求由本地客户端直接发往用户配置的服务商
- 面向长周期备考的计划、练习、错题、面试、申论与学习证据闭环

## 架构

核心设计与边界见：

- [`docs/architecture-index.md`](docs/architecture-index.md)
- [`docs/architecture-constitution.md`](docs/architecture-constitution.md)
- [`docs/adr-001-provider-neutral-agent-runtime.md`](docs/adr-001-provider-neutral-agent-runtime.md)
- [`docs/adr-002-pi-agent-core-loop-engine.md`](docs/adr-002-pi-agent-core-loop-engine.md)

## 开发环境

- Node.js 20.19+ 或 22.12+
- npm 10+
- iOS 构建需要 macOS、Xcode 16+ 和你自己的 Apple Developer Team

```bash
git clone https://github.com/zhangl1001/civil-ai.git
cd civil-ai
npm install
cd web && npm install
npm run dev
```

模型 API Key 只应在应用设置或本地环境中配置。不要把密钥写入源码、Issue、日志或提交记录。

## 验证

在仓库根目录运行：

```bash
npm test
```

也可以运行更细的检查，例如：

```bash
npm run check:architecture
npm run check:agent-runtime
npm run check:web-research
```

## iOS

```bash
npm run ios:sync
open ios/App/App.xcodeproj
```

首次构建时，请在 Xcode 的 Signing & Capabilities 中选择自己的 Team，并设置唯一的 Bundle Identifier。Xcode 始终打包当前 Vue 构建产物。

OTA 打包必须显式提供公开的 HTTPS 地址：

```bash
OTA_IPA_URL=https://downloads.example.org/App.ipa npm run ios:archive
```

## 隐私与安全

- API Key 保存在用户设备侧，不应进入仓库。
- Web Research 会阻止 localhost、内网地址和带账号信息的 URL。
- 导入的学习资料和会话数据默认保存在本地存储中。
- 安全问题请不要创建公开 Issue，处理方式见 [`SECURITY.md`](SECURITY.md)。

## 参与贡献

欢迎提交 Issue 与 Pull Request。开始前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 和 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。项目维护者见 [`MAINTAINERS.md`](MAINTAINERS.md)。

## 许可证

本项目基于 [ISC License](LICENSE) 开源。
