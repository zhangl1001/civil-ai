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
npm run check:data-maintenance
npm test
```

The data-maintenance verifier exercises both the native SQLite deletion order
and the IndexedDB fallback, including official-question immutability and
foreign-key integrity.

## iOS

```bash
npm run ios:sync
open ios/App/App.xcodeproj
```

Xcode always packages the current Vue bundle. The removed Python, Tauri and legacy HTML
runtimes are not part of the repository or build process.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and verification rules.

## License

ISC. See [LICENSE](LICENSE).
