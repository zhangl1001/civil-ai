# Contributing

Zhangl Agent is a local-first AI civil-service exam tutor. Changes should
preserve the boundaries documented in `docs/architecture-constitution.md`:
business facts belong in repositories, model behavior stays provider-neutral,
and native capabilities must expose narrow, testable interfaces.

## Development

```bash
npm install
cd web && npm install
npm run dev
```

## Before a pull request

Run the relevant focused verifier while developing, then run the release gate:

```bash
npm run check:data-maintenance
npm test
```

A pull request should explain the user-visible problem, the ownership boundary
changed, failure and recovery behavior, and the verification performed. New
database behavior must include an upgrade-safe migration and a regression test.

Do not commit model API keys, signing keys, personal learning data, generated
archives, IPA files, or Xcode build output.
