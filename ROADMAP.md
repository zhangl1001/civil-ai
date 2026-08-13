# Public Roadmap

This roadmap communicates product direction and contribution opportunities. It is not a promise of release dates. Priorities may change after user feedback, device testing, security review, or provider changes.

## Project direction

Civil AI aims to provide a local-first adaptive tutoring foundation that can explain what a learner should do next and support that decision with durable learning evidence. The civil-service exam application is the current end-to-end reference domain. Its target loop is:

`candidate profile -> capability baseline -> daily plan -> learning and practice -> grading -> diagnosis -> targeted remediation -> spaced review -> measurable capability change`

## Now: reliable personal learning loop

- Stabilize structured generation, enrichment, grading, and error-diagnosis latency.
- Improve daily plans so learning, practice, review, and current-affairs accumulation share one coherent workload budget.
- Expand real-question import with explicit provenance, rights boundaries, and device-safe document handling.
- Complete iOS lifecycle, cancellation, SQLite recovery, and background-task validation on physical devices.
- Publish repeatable release, upgrade, and rollback procedures.

## Next: evidence-driven tutoring

- Improve baseline calibration across aptitude, essay, and interview dimensions.
- Make mastery confidence, forgetting risk, transfer ability, and time pressure visible to the candidate.
- Let the tutor adapt teaching depth and question volume to remaining exam time and observed fatigue.
- Add richer lecture-to-practice linkage and verify that generated exercises cover the intended knowledge point.
- Expand accessibility, reduced-motion behavior, and device-size visual regression coverage.

## Later: foundation hardening and reuse

- Stabilize and document the agent-runtime, provider-gateway, content-block, learner-evidence, and local-database boundaries for reuse.
- Document third-party provider adapter contracts and conformance tests.
- Add a small domain-adapter example that proves the tutoring foundation can host a second learning domain without importing civil-service policies.
- Add an Android shell after the iOS lifecycle and data contracts are stable.
- Support privacy-preserving optional sync without making a cloud service mandatory.

## Contribution opportunities

Good starting areas include:

- documentation and reproducible bug reports;
- accessibility and mobile layout fixes;
- provider adapter conformance tests;
- SQLite migration and recovery tests;
- content rendering fixtures for tables, formulas, SVG, and shared passages;
- performance measurements for generation, grading, and large local datasets.

Look for [`good first issue`](https://github.com/zhangl1001/civil-ai/labels/good%20first%20issue) and [`help wanted`](https://github.com/zhangl1001/civil-ai/labels/help%20wanted) labels. Propose new scope with the repository Issue templates rather than treating this roadmap as an implementation specification.
