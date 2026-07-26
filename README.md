# Zhangl Agent

面向个人备考周期的本地优先 AI 公考私教。

## Runtime

- Vue 3 + TypeScript
- Capacitor iOS
- SQLite on iOS
- IndexedDB as the Web development adapter
- One Provider Gateway for Anthropic and OpenAI-compatible APIs
- One AgentRun runtime for generation, grading, planning and tool execution

The application does not require a project-owned cloud backend. Model requests are sent
directly from the configured local client to the selected provider.

## Development

```bash
cd web
npm install
npm run dev
```

## Verification

```bash
npm test
```

## iOS

```bash
npm run ios:sync
open ios/App/App.xcodeproj
```

Xcode always packages the current Vue bundle. The removed Python, Tauri and legacy HTML
runtimes are not part of the repository or build process.
