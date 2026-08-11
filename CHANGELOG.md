# Changelog

Notable user-facing and maintainer-facing changes are documented here. The project follows semantic versioning while it remains in active development.

## [Unreleased]

### Planned

- Continue physical-device validation for iOS lifecycle recovery and long-running generation tasks.

## [1.2.0] - 2026-08-11

### Added

- Adaptive daily learning plans that allocate learning, practice, review, and accumulation work from the candidate's exam cycle and current evidence.
- Bounded generation-variation context for daily accumulation, lectures, essay prompts, monthly reviews, and objective questions.
- Public roadmap, expanded contribution guide, structured Issue templates, and a browser-ready release bundle.

### Changed

- Daily knowledge generation now receives real priority capability nodes instead of only workload counts.
- Generated content uses recent local outlines and a per-run teaching angle to reduce repeated topics without expanding model context indefinitely.
- Exact or near-duplicate generated content receives one controlled retry; grading and error diagnosis remain deterministic.

### Fixed

- Repeated knowledge content across consecutive generation runs.
- Data reset ordering and wrong-book action placement included in the adaptive-plan baseline.

### Upgrade notes

No destructive migration is required. See [`docs/upgrade-v1.2.0.md`](docs/upgrade-v1.2.0.md).

## [1.1.1] - 2026-08-10

### Added

- Public open-source governance, privacy, security, and content-boundary documentation.

### Changed

- Hardened agent write recovery, cancellation, tool validation, provider retries, native transport, and iOS resource limits.

## [1.1.0] - 2026-08-09

### Added

- Provider-neutral agent baseline, true-question workflow foundation, structured content generation, and local-first SQLite data layer.

## [1.0.0] - 2026-08-08

### Added

- Initial Vue, Capacitor, and local tutor foundation.

[Unreleased]: https://github.com/zhangl1001/civil-ai/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/zhangl1001/civil-ai/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/zhangl1001/civil-ai/compare/v1.1.0-baseline...v1.1.1
[1.1.0]: https://github.com/zhangl1001/civil-ai/compare/v1.0.0-foundation...v1.1.0-baseline
[1.0.0]: https://github.com/zhangl1001/civil-ai/releases/tag/v1.0.0-foundation
