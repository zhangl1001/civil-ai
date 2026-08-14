# Public Roadmap

This roadmap communicates product direction and contribution opportunities. It is not a promise of release dates. Priorities may change after user feedback, device testing, security review, or provider changes.

## Project direction

Civil AI aims to provide a local-first adaptive tutoring foundation that can explain what a learner should do next and support that decision with durable learning evidence. A learning domain supplies its curriculum, capability graph, assessment rules, and teaching policies through explicit adapters. The civil-service exam application is the current end-to-end reference domain.

The foundation's target loop is:

`learner profile -> capability baseline -> adaptive plan -> learning and practice -> assessment -> diagnosis -> targeted remediation -> spaced review -> measurable capability change`

## Now: reliable foundation and reference loop

- Stabilize Agent execution, structured generation, enrichment, assessment, and diagnosis latency.
- Harden cancellation, leases, idempotency, SQLite recovery, and physical-device lifecycle behavior.
- Define conformance checks for provider adapters, learning-domain metadata, content blocks, and repository ports.
- Keep the civil-service reference loop reliable across planning, learning, practice, review, essay, and interview workflows.
- Publish repeatable setup, release, upgrade, rollback, and security-response procedures.

## Next: evidence-driven domain adaptation

- Formalize learning-domain adapters for curricula, rubrics, assessment roles, and teaching strategies.
- Improve baseline calibration, mastery confidence, forgetting risk, transfer evidence, and time-pressure modeling.
- Let domain policies adapt teaching depth and workload to learner goals, remaining time, and observed fatigue.
- Add richer lecture-to-practice linkage and verify that generated exercises cover the intended capability.
- Expand accessibility, reduced-motion behavior, and device-size visual regression coverage.

## Later: validate portability beyond the reference domain

- Stabilize and document the Agent-runtime, provider-gateway, content-block, learner-evidence, and local-database boundaries for reuse.
- Document third-party provider adapter contracts and conformance tests.
- Add a small second learning-domain adapter that does not import civil-service policies.
- Add an Android shell after the iOS lifecycle and data contracts are stable.
- Support privacy-preserving optional sync without making a cloud service mandatory.

## Contribution opportunities

Good starting areas include:

- documentation and reproducible bug reports;
- accessibility and mobile layout fixes;
- provider adapter conformance tests;
- learning-domain adapter examples and contract tests;
- SQLite migration and recovery tests;
- content rendering fixtures for tables, formulas, SVG, and shared passages;
- performance measurements for generation, grading, and large local datasets.

Look for [`good first issue`](https://github.com/zhangl1001/civil-ai/labels/good%20first%20issue) and [`help wanted`](https://github.com/zhangl1001/civil-ai/labels/help%20wanted) labels. Propose new scope with the repository Issue templates rather than treating this roadmap as an implementation specification.
