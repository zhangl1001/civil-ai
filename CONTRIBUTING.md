# Contributing to Civil AI

Thank you for improving Civil AI. Contributions may include bug reports, documentation, tests, provider adapters, accessibility improvements, and focused product changes.

## Before opening a change

1. Search existing Issues and Pull Requests first.
2. Use an Issue template for bugs, feature proposals, and documentation gaps.
3. Discuss large features, schema changes, new providers, and architecture changes before implementation.
4. Never submit API keys, personal learning data, signing material, non-public examination material, or content you cannot redistribute.

## Development setup

```bash
git clone https://github.com/zhangl1001/civil-ai.git
cd civil-ai
npm ci
npm --prefix web ci
npm --prefix web run dev
```

For iOS development:

```bash
npm run ios:sync
open ios/App/App.xcodeproj
```

Use your own Apple Developer Team and Bundle Identifier. Do not commit changes that only contain your local signing identity.

## Architecture rules

- Business rules belong in `web/src/modules/*`; shared technical capabilities belong in `web/src/capabilities/*`.
- Domain and application code depend on contracts, not concrete SQLite, IndexedDB, provider, or native-plugin implementations.
- Structured business data belongs in repositories. Agent conversation and transient tool presentation must not become business facts.
- Model output is untrusted input. Validate render-critical structure and ownership at deterministic boundaries.
- Agent autonomy is guided through tool and skill descriptions. Do not replace intent understanding with language-specific regular-expression routing.
- Transactions must be short and limited to consistency-critical writes. Network and model calls never run inside a database transaction.
- Reuse design-system, Markdown, pagination, modal, and task-state components instead of creating page-local variants.

The normative documents are:

- [`docs/architecture-constitution.md`](docs/architecture-constitution.md)
- [`docs/modular-architecture-standard.md`](docs/modular-architecture-standard.md)
- [`docs/coding-quality-standard.md`](docs/coding-quality-standard.md)
- [`docs/frontend-design-system-architecture.md`](docs/frontend-design-system-architecture.md)

## Branches and commits

- Branch from the latest `main`.
- Keep a branch focused on one Issue or one coherent maintenance goal.
- Prefer Conventional Commit subjects such as `fix(agent): respect cancellation`.
- Reference the Issue in the Pull Request and use `Fixes #123` only when the PR fully resolves it.
- Do not mix generated artifacts, editor settings, signing identities, or unrelated refactors into the change.

## Verification

Run the complete gate before requesting review:

```bash
npm test
```

During development, run the smallest relevant checks first. Examples:

```bash
npm run check:architecture
npm run check:generation-workflow
npm run check:agent-runtime
npm --prefix web run typecheck
```

For user-facing changes, include screenshots or a short recording and state which mobile viewport or iOS device was tested. If a test could not be run, explain why in the PR.

## Pull Request checklist

- Explain the user problem and why the selected boundary owns the fix.
- Describe behavior changes, compatibility risks, migrations, and rollback considerations.
- Add or update focused verification for changed behavior.
- Confirm that no secrets, personal data, copyrighted question banks, or signing material are included.
- Keep reviewable scope; split follow-up work into separate Issues.

## Review and release

Maintainers review correctness, architecture boundaries, user impact, security, accessibility, and test coverage. A merged change is included in a release only after the release gate passes and the public changelog is updated.

By contributing, you confirm that you have the right to provide the contribution under the project's MIT License and agree to follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
