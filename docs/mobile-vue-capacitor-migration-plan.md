# Mobile Vue + Capacitor Migration Plan

> Historical document notice (2026-07-14): this file is only for locating migrated Vue/Capacitor features and old implementation history. All new decisions start from `docs/architecture-index.md`. Its legacy compatibility and incremental old-model guidance must not be implemented.

## Decision

Use a local-first, single-device architecture:

- UI: Vue 3 + TypeScript + Pinia + Vue Router
- Runtime shell: Capacitor v8
- Native iOS: Swift plugins only for system capabilities and WebView stability
- Data: local SQLite eventually, IndexedDB acceptable for the first migration layer if wrapped behind the same repository API
- AI: user-provided API key stored in Keychain, no mandatory cloud service
- Sync: optional future feature, not required for the first App Store-ready version

The app should remain a pure local app by default. No backend server is required for core learning, practice, wrongbook, statistics, AI task state, or project data.

## Main Principles

1. Keep the current `backend/static/mobile` app buildable until the Vue version fully replaces it.
2. Do not migrate by rewriting everything at once.
3. Move business logic out of pages and into TypeScript services.
4. Runtime queries must use structured indexes, not markdown scans.
5. Markdown/JSON files are compatibility and export formats, not the primary runtime database.
6. AI generation, grading, and tool execution must go through a local task queue.
7. Platform-specific code must stay behind adapters so Android can be added later.

## Target Structure

```text
web/
  src/
    app/                 app bootstrap, lifecycle, route guards
    views/               pages
    components/          reusable UI components
    stores/              Pinia state stores
    services/            business services
    db/                  database adapter, schema, migrations
    ai/                  AI engine, providers, prompts, tools
    tasks/               local task queue and task state
    domain/              typed domain models
    platform/            Capacitor/native adapters
    legacy/              old markdown/json import and compatibility
ios/                     Capacitor iOS shell + Swift plugins
android/                 future Capacitor Android shell
backend/static/mobile/   legacy app retained during migration
```

## Phase 0: Stabilize Vue Project

Goal: make `web/` a real buildable app without replacing the legacy iOS package yet.

- Align `web/package.json` Capacitor packages with root Capacitor v8.
- Add `@` alias in `web/vite.config.ts`.
- Change Vue Router from `createWebHistory()` to `createWebHashHistory()`.
- Remove hardcoded `http://localhost:8000/api`.
- Remove mock-only assumptions from main pages or clearly fence them behind dev fixtures.
- Ensure `cd web && npm run build` passes.
- Add scripts:
  - `web:build`
  - `ios:sync:web`
  - `ios:archive:web`
  - keep `ios:sync:legacy` / `ios:archive:legacy` during migration.

Exit criteria:

- Vue app builds to `web/dist`.
- iOS can package either legacy or Vue build.
- No breakage to existing IPA workflow.

## Phase 1: Local Data Foundation

Goal: introduce local backend-like architecture inside the app.

Create:

```text
web/src/db/
  schema.ts
  database.ts
  migrations.ts

web/src/services/
  ProjectRepository.ts
  FileRepository.ts
  SettingsService.ts
  LegacyImportService.ts

web/src/domain/
  project.ts
  question.ts
  practice.ts
  wrongbook.ts
  task.ts
  ai.ts
```

Recommended tables:

- `projects`
- `settings`
- `files`
- `questions`
- `practice_sessions`
- `answers`
- `wrong_items`
- `ability_profiles`
- `learning_events`
- `ai_sessions`
- `ai_messages`
- `ai_tasks`
- `task_logs`

Rules:

- Pages never scan markdown directly.
- Pages call services only.
- Services call repository/database adapters.
- `localStorage` is only for lightweight preferences and migration flags.

Exit criteria:

- Existing project data can be imported into structured local storage.
- Home/practice/wrongbook/calendar can read from service APIs.

## Phase 2: Local Task System

Goal: migrate the AI/task bar foundation before migrating complex pages.

Create:

```text
web/src/tasks/
  TaskQueue.ts
  TaskStore.ts
  TaskRunner.ts
  TaskLocks.ts
  taskTypes.ts
```

Task statuses:

```text
queued | running | retrying | paused | done | failed | cancelled
```

Each task must have:

- `task_id`
- `type`
- `project`
- `input_hash`
- `lock_key`
- `status`
- `progress`
- `progress_text`
- `created_at`
- `updated_at`
- `result_ref`
- `error`

Required behavior:

- Prevent duplicate dispatch with `lock_key`.
- Persist task state locally.
- Resume or reconcile on app foreground.
- Support cancellation.
- Support retry after provider rate limit.
- Keep concise visible task log for the UI.

Exit criteria:

- Task strip is driven by structured task state.
- Generation, grading, essay, digest, mock, and redo tasks all appear consistently.

## Phase 3: AI Layer

Goal: migrate AI engine and tools to typed modules.

Create:

```text
web/src/ai/
  AIEngine.ts
  AIProvider.ts
  OpenAIProvider.ts
  AnthropicProvider.ts
  ToolRegistry.ts
  ContextBuilder.ts
  PromptService.ts
  StreamController.ts
```

Rules:

- User API keys are stored through platform secure storage, Keychain on iOS.
- AI requests always bind to a task.
- Tool writes go through repositories.
- Generation updates `questions`, `learning_events`, and compatibility files.
- Grading updates `answers`, `wrong_items`, `ability_profiles`, and task result references.
- Provider failures must not corrupt local data.

Exit criteria:

- AI chat streams reliably.
- Tool execution rows and task strip are powered by the same task data.
- App foreground/background transitions do not lose state.

## Phase 4: Migrate Shell, Home, Task Strip, AI Entry

Goal: prove the Vue app can replace the shell safely.

Migrate:

- Bottom tabs
- Home
- Project selector
- Task strip
- AI floating entry
- AI chat sheet shell
- Theme, font size, safe-area, keyboard behavior

Exit criteria:

- iOS foreground/background switching has no black background loss.
- Home opens quickly.
- No mock data in production path.
- Legacy data is visible through new services.

## Phase 5: Migrate Practice

Migrate:

- Practice center
- Practice card
- Question display
- Answer sheet
- Recent practice, limited to latest 7 records
- Practice session persistence

Performance requirements:

- Render only the current question where possible.
- Use structured `question_count`.
- Write practice answers transactionally.
- Update wrongbook index after grading.

Exit criteria:

- Practice flow matches or exceeds legacy behavior.
- No markdown scan on normal practice center load.

## Phase 6: Migrate Wrongbook, Calendar, Profile

Migrate:

- Wrongbook
- Calendar
- Ability profile
- Quality dashboard/statistics entry points

Rules:

- Wrongbook reads `wrong_items`.
- Calendar reads `learning_events`.
- Profile reads `ability_profiles` and aggregate stats.
- Markdown is read only when opening detail content.

Performance targets:

- Wrongbook first render under 300 ms for normal local data volume.
- Calendar month switch does not scan files.
- Profile avoids repeated stats file reads.

## Phase 7: Migrate Essay and Mock Exam

Essay:

- Topic/question generation
- Draft autosave
- AI grading
- Score dimensions
- History

Mock exam:

- Subject switch, generation options, and task dispatch are now in `ExamFlowService`.
- Native `/vue/exam` reads recent structured mock sessions and statistics from IndexedDB.
- AI mock generation now uses a dedicated `mockRunner`: 行测模考 writes generated objective questions into `questions` and carries the generated task id through `PracticeFlowService.sourceRef` so the practice page can load that exact paper through the IndexedDB `projectSource` index; 申论模考 writes generated material/requirement into the settings-backed essay state.
- Timer, pause/resume reconciliation, report detail, and delete-latest remain to be completed.
- Wrongbook integration is already covered after mock practice submit because practice save writes answers, wrong items, learning events, and ability profile.

Exit criteria:

- App switching does not break timers or drafts.
- AI grading writes structured results and compatibility files.

## Phase 8: Switch iOS Default Build

Only switch default iOS packaging after Vue covers the core production flows.

Temporary scripts:

```json
{
  "web:build": "cd web && npm run build",
  "ios:sync:web": "npm run web:build && bash scripts/sync-vue-ios-public.sh",
  "ios:sync:legacy": "bash scripts/sync-ios-public.sh",
  "ios:archive:web": "npm run ios:sync:web && bash scripts/archive-ios-web.sh",
  "ios:archive:legacy": "npm run ios:sync:legacy && bash scripts/archive-ios.sh"
}
```

Exit criteria:

- Vue IPA passes smoke tests.
- Legacy build remains available for rollback until one full release cycle is stable.

## Phase 9: Android Preparation

Keep platform code behind adapters:

```text
web/src/platform/
  FilesystemAdapter.ts
  SecureStoreAdapter.ts
  DatabaseAdapter.ts
  NotificationAdapter.ts
  AppLifecycleAdapter.ts
```

Android later:

```bash
npx cap add android
npx cap sync android
```

Expected Android-specific work:

- File permissions
- Notification permissions
- Navigation bar/status bar styling
- SQLite plugin setup
- Signing and store metadata

## App Store Notes

Vue + Capacitor can be App Store-ready if the app is complete and not a thin web shell.

Before submission:

- Remove all mock/placeholder production paths.
- No hardcoded localhost endpoints.
- Provide privacy policy.
- Explain AI data handling and third-party provider use.
- If selling subscriptions, AI credits, or premium digital features, review Apple IAP requirements.
- Do not use OTA to bypass review by changing core app behavior.
- Ensure offline/local-first functionality works without account login.

## Immediate Next Step

Current implementation status:

### 2026-07-13 Progress Snapshot

Recent task/AI runtime work is complete and build-verified with `cd web && npm run build`.

- Task execution is now real controlled concurrency rather than a purely serial queue. `TaskQueue` defaults to 3 concurrent tasks through `DEFAULT_MAX_CONCURRENT_TASKS = 3`.
- Task concurrency is configurable through the AI settings sheet. The saved value is loaded during task bootstrap, defaults to 3, and is clamped to 1-5.
- Task runners are still stateless async functions registered by task type. Concurrent execution calls the same runner function with independent `task`, `context`, `AbortController`, and local variables; no runner object pool is required.
- Duplicate dispatch protection remains active through `lock_key`, so same-source generation/review tasks are still reused instead of duplicated.
- Task execution is guarded before run: only `queued` and `retrying` tasks can be picked up; already cancelled/done/running tasks are ignored.
- AI provider limit handling is implemented. OpenAI-compatible and Anthropic providers wrap HTTP 429 as `AIRateLimitError` and read `Retry-After` when available.
- AI provider transient failures are classified. HTTP 408, 5xx, and network failures are wrapped as retryable `AITransientError`; auth/config/client errors remain hard failures.
- TaskQueue now degrades on provider rate limit or transient provider failure: affected tasks switch to `retrying`, use exponential backoff with jitter, retry up to 3 times, and temporarily reduce global task concurrency to 1 during cooldown.
- Global task toast is implemented through `TaskToast.vue` and mounted in `App.vue`. Task join/start/retry/pause/done/fail/cancel state changes show a short top toast, and clicking it routes to the task target.
- AI command routing has been standardized. Chat only receives tool descriptions/parameters, not full generation prompts. High-confidence explicit commands execute; uncertain/missing-parameter commands are stored as pending and require user confirmation.
- AI tool slot filling is implemented. Missing module/topic/count parameters now ask a focused follow-up first, then move to confirm/cancel before dispatching the task.
- AI business tool definitions now use a structured parameter schema with required fields, enum hints, defaults, and numeric bounds. The router uses the schema for required-field validation.
- AI generation prompts have been split into structured prompt builders in `QuestionPrompts.ts`; objective, mock, and essay generation use typed prompt builders and low-temperature calls.
- Objective and essay generation now run validation and one JSON repair attempt before writing local data. Invalid generated structures fail the task rather than corrupting the question database.
- Calculation-heavy objective questions now have stricter validation. Data analysis and quantitative reasoning questions must include enough numeric conditions, numeric options, and a visible calculation path in the explanation; repair prompts include the same requirement.
- Wrong book review flow has been extended with editable error reasons, compact review scheduling, due/high-frequency filtering support, and flashcard review actions.
- Essay lecture data has been moved out of the page into `EssayLectureService`. Default, existing, and AI-generated essay questions are normalized to carry structured lecture data before display.
- Current build output is Vue-only. The latest changes have not been synced into `ios/App/App/public`; run `npm run ios:sync:web` only when preparing an Xcode/iOS test package.

Files most relevant to the latest runtime changes:

- `web/src/tasks/TaskQueue.ts`
- `web/src/ai/AIProvider.ts`
- `web/src/services/AICommandRouter.ts`
- `web/src/services/AIBusinessTools.ts`
- `web/src/ai/QuestionPrompts.ts`
- `web/src/ai/QuestionValidation.ts`
- `web/src/tasks/AIRunners.ts`
- `web/src/components/TaskToast.vue`
- `web/src/App.vue`

Next optimization queue:

1. Persist rate-limit/transient-failure cooldown state if needed. Current cooldown is in memory; after app restart, running tasks are recovered as retrying but provider cooldown timing is not preserved.
2. Add per-task retry policy metadata so long generation tasks, chat tasks, and local-only tasks can use different retry counts and delays.
3. Add explicit task execution tests for concurrency, duplicate locks, cancellation during retry delay, provider retry downgrade, and task toast deduplication.
4. Move companion chat streaming into the same task runtime only if multi-session concurrent chat is required. Current visible chat still uses a single active stream to avoid crossed live replies.
5. Add optional deterministic answer checks for calculation-heavy modules where the generated structure exposes enough arithmetic detail.
6. Before iOS packaging, run `npm run ios:sync:web`; before release, verify with Xcode on a real device because task toast, floating chat, keyboard, and safe-area behavior need true WebView validation.

### Profile-Driven Data Architecture Plan

The app must treat a project as one complete exam preparation cycle, not just a file folder. A default project may exist for technical bootstrapping, but product flows must distinguish an unfinished onboarding project from an active preparation cycle.

Data-layer boundaries:

1. Exam cycle layer
   - Stores the user goal, baseline, and preparation-cycle identity.
   - Tables: `projects`, `exam_profiles`.
   - AI must not overwrite user-provided facts here.

2. Behavior fact layer
   - Stores what the user actually did.
   - Tables: `practice_sessions`, `answers`, `wrong_items`, `learning_events`, `interview_sessions`, `digest_items`.
   - Records must carry `projectId`, and generated/AI operations should carry `sourceTaskId` or `sourceRef`.

3. Aggregated stats layer
   - Stores deterministic aggregates for fast page rendering and AI context.
   - Table: `profile_stats_snapshots`.
   - It should be generated by code, carry `algorithmVersion`, and avoid repeated full scans on hot pages.

4. Deterministic diagnosis layer
   - Stores explainable code-generated diagnosis, not AI opinion.
   - Table: `ability_diagnoses`.
   - Diagnosis must include `reasonCodes`, `confidence`, and links to the source stats snapshot.

5. AI insight layer
   - Stores AI-generated explanations, encouragement, and planning language.
   - Table: `profile_insights`.
   - AI insights must reference `diagnosisId` and expire or be regenerated as the user changes.

First implementation slice:

- Extend `Project` with `status: onboarding | active | archived` and `activeProfileId`.
- Add `exam_profiles` as the structured source for onboarding/building the user's preparation profile.
- `getActiveProject()` may create a default project, but it must be `onboarding`, not a fully active preparation cycle.
- Add `ExamProfileRepository` for typed profile read/write/activation.
- Keep old projects compatible by treating missing `status` as `active` until the user explicitly archives or completes profile repair.

Implementation status:

- Done: `Project` now supports `status` and `activeProfileId`.
- Done: `ExamProfile` domain model exists with target/current scores, time budget, baseline, preferences, and lifecycle status.
- Done: database schema is upgraded to v5 with `exam_profiles` and indexes `projectId`, `status`, and `projectStatus`.
- Done: `ExamProfileRepository` supports listing, draft save, activation, active-profile lookup, and active-profile existence checks.
- Done: automatic default project creation now produces an `onboarding` project; old projects without a status are normalized as `active`.
- Done: homepage onboarding card and profile form are implemented in `HomeView.vue`.
- Done: onboarding completion activates the `ExamProfile`, updates the project to `active`, binds `activeProfileId`, and creates the base exam plan.
- Done: target-driven task guard is implemented through `ProfileGuardService` and is enforced in `GenerationTaskService` for practice, mock, redo, essay grading, and interview review tasks.
- Done: AI business tools receive a friendly profile-required reply instead of throwing raw task errors.
- Done: first-pass deterministic `AbilityStatsService` aggregates practice sessions, ability profiles, wrong items, and learning events.
- Done: first-pass deterministic `AbilityDiagnosisService` computes phase, score gaps, module priority, confidence, reason codes, and training recommendations.
- Done: `profile_stats_snapshots`, `ability_diagnoses`, and `profile_insights` stores are added in database v6 with project/profile/diagnosis indexes.
- Done: `ProfileAnalysisRepository` persists and reads latest stats snapshots, deterministic diagnoses, and AI insights.
- Done: practice submission and essay feedback now refresh stats/diagnosis asynchronously after successful fact writes.
- Done: Home reads the latest persisted diagnosis when available and shows a compact ability diagnosis strip.
- Done: Quality dashboard reads the latest persisted diagnosis when available and shows phase, confidence, module priorities, and reason-code tags.
- Done: `ProfileInsightService` can generate AI insight Markdown from the deterministic diagnosis and save it without mutating raw facts.
- Done: `PlanService.generateTodayPlan()` now uses deterministic diagnosis recommendations for phase, focus modules, daily question target, review ratio, and module reasons.
- Done: Plan page shows the diagnosis summary that explains why the daily plan is arranged that way.
- Done: Quality dashboard has an AI coach insight entry that generates Markdown from the deterministic diagnosis and persists it in `profile_insights`.
- Done: Profile page now has a profile editing entry for exam target, current/target scores, study time, weak modules, and self assessment; saving refreshes diagnosis and plan metadata.
- Done: Profile dimensions now include target position, application requirements, interview score baseline/target, weekday/weekend time budget, full-time flag, weak question types, strengths, blockers, training intensity, task style, encouragement style, and review preference.
- Done: Homepage onboarding and Profile editing both save the expanded dimensions into `exam_profiles`.
- Done: Ability diagnosis recommendations now use training intensity, full-time status, weekday/weekend time budget, and review preference when calculating daily question target and review ratio.
- Done: AI tool slot filling asks for missing module/topic/count before confirm/cancel dispatch.

Remaining slices:

- Add a polished multi-step onboarding wizard if the single-sheet form feels too dense on real iPhone.
- Add deterministic use of historical exam records/rank/岗位竞争比 if those fields are later collected.
- Add true migration/repair UI for old projects that are missing active `exam_profiles`.

- Important correction: the current Vue package now uses native Vue routes for
  the main product entry and migrated business pages. The default Vue/App Store
  build no longer bundles `web/public/legacy`; legacy fallback assets/routes are
  enabled only when `ZHANGL_VUE_BUNDLE_LEGACY=1` and
  `VITE_ENABLE_LEGACY_FALLBACK=1` are explicitly set, or when building the
  dedicated legacy IPA.
- Phase 0 is done: `web` builds, Capacitor versions are aligned, router uses hash mode, and Vue/iOS sync scripts exist.
- Phase 1 foundation is in place: typed domain models, IndexedDB adapter, local repositories, and legacy import service exist.
- Phase 2 foundation is in place: local task store, duplicate-dispatch lock, recover-on-foreground behavior, cancellation, task dock UI, generation task service, and development demo runner exist.
- Phase 4 shell work is implemented: bottom navigation, home quick actions, task strip, AI chat sheet shell, tool execution process rows, generation entry task dispatch, safe-area styling, and mobile page layouts are in the Vue shell.
- Phase 5 is implemented: practice questions read from `questions` through `QuestionRepository`, generated papers can be pinned by source task id, practice sessions and answers are persisted to IndexedDB, learning events are written, and the practice page shows only the latest 7 recent sessions.
- Phase 6 is implemented: wrongbook writes wrong answers to `wrong_items` during practice save and reads `wrong_items + questions` through `WrongBookRepository` instead of page-local mock data.
- Home/profile stats now read local structured data: home aggregates `learning_events`, `practice_sessions`, and `ability_profiles`; profile aggregates local practice, wrongbook, and active-day stats. Practice save updates `ability_profiles` incrementally.
- Phase 7 is implemented: essay question, draft, feedback, generated mock prompts, and recent grading history are persisted locally through `EssayRepository`; essay grading writes `learning_events` and routes through the generation task queue.
- Platform lifecycle foundation is in place: `AppLifecycleAdapter` normalizes focus, visibility, native resume, app-active, pageshow, and Capacitor app state events; task recovery and WebView repaint guard now use this unified lifecycle path.
- Secure AI config foundation is in place: `SecureStoreAdapter` uses the existing iOS Keychain plugin when available and falls back to local development storage; `AIConfigService` migrates legacy localStorage config and Profile exposes a basic AI config editor.
- Real AI runner foundation is in place: task payloads are persisted, `AIEngine` loads secure config, OpenAI-compatible and Anthropic providers can run non-stream completions, and chat/essay grading/practice generation/digest/study tasks run through typed local runners. Study tasks use a dedicated `studyRunner` so考点精讲不会污染每日积累保存路径.
- Foundation/project service migration is implemented: `ProjectRepository` no longer pre-creates legacy JSON/Markdown runtime files for new Vue projects; typed default knowledge and syllabus data stay in TypeScript constants rather than `知识体系.json` or `syllabus/*.json`; `PlanService` ports the legacy target model, phase calculation, syllabus target loading, and today-task generation logic, with the exam plan stored primarily in `settings` and `备考计划.json` retained only as a compatibility copy when project setup input exists; `LegacyImportService` imports old `zhangl-examtutor` projects/files into the new structured file repository.
- Shared Vue layout foundation is implemented: global safe-area tokens and common page/header/footer/button classes are in `main.css`; native Vue pages use safe-area-aware top spacing so navigation does not render into the iOS status area.
- Task UI/runtime cleanup is implemented: `TaskPresenter` centralizes task summary/status/cancel/sort rules for both `TaskDock` and `AIChatSheet`; paused tasks are resumed as retrying on app foreground before the queue drains.
- Home shell migration is implemented: `HomeFeatureService` ports the legacy ability-center enable/disable rules and route targets; `HomeDashboardRepository` reads structured sessions/events plus the settings-backed plan for countdown and typed feature groups; native Home renders feature groups from service data and routes today-task clicks into native Vue flows instead of treating every task as AI generation.
- Calendar migration is implemented: `CalendarService` reads structured `learning_events`, `practice_sessions`, and `questions` source counts instead of scanning practice markdown or `题目元数据.json`; `/vue/calendar` provides a native Vue calendar/detail view and `/calendar` redirects to it.
- Plan page migration is implemented: `PlanDashboardService` composes `PlanService`, ability profiles, countdown, today tasks, and 7-day history; `/vue/plan` provides a native Vue plan page with local daily-plan generation and native Vue task navigation. Daily plan generation reads structured `ability_profiles` and `practice_sessions` with the typed default knowledge tree instead of scanning `能力画像.json`, `练习统计.json`, or `syllabus/*.json`.
- Practice flow migration is implemented: `PracticeFlowService` centralizes legacy entry context (`mp-target-module`, `mp-target-kp`, `mp-practice-date`, `mp-practice-mode`) and generation payloads; native Practice starts from that context instead of hardcoded `mock-id`/module values, can pin generated practice/mock papers through `mp-source-ref`, auto-refreshes when the bound generation task finishes, saves sessions with the selected mode, and keeps recent practice limited to 7 records.
- Wrongbook review flow is implemented: `WrongBookRepository` exposes stable module/status/reason/scope/sort filters and `startReview()` writes review context through `PracticeFlowService`; native Wrongbook routes redo practice through `/vue/practice`, supports flashcard review, batch selection, status updates, due-review/high-frequency filtering, and structured generation tasks instead of page-local hardcoded task payloads.
- Essay flow migration is implemented: `EssayFlowService` centralizes `es-date` and `essay-topic` context and grading payloads; native Essay no longer uses `mock-essay-id` or writes placeholder feedback, real AI grading writes dated/topic-specific essay state through `EssayRepository`, generated questions carry `lecture/material/requirement`, and AI feedback/history render through the shared sanitized Markdown component.
- Exam flow migration is implemented: `ExamFlowService` centralizes 行测/申论模考上下文、题量方案、侧重点、重复任务派发和入口跳转；native Exam uses structured `practice_sessions` for recent history/statistics, groups recent history by month, and routes 行测 to `/vue/practice`, 申论 to `/vue/essay`; `mockRunner` separates 行测套卷 generation from 申论材料 generation, and 行测模考 records the generated task id as the practice source.
- Digest flow migration is implemented: `DigestService` centralizes 热点/知识点 tab state, today content, history, task dispatch, and generated markdown persistence; `digestRunner` saves generated daily content, writes `learning_events`, and generates monthly AI reports from structured `digest_items`; `/vue/digest` provides the native daily accumulation page.
- Digest data layer has been corrected to match the local database design: `digest_items` is the primary structured runtime table, while `files` markdown remains only a compatibility/export fallback. Daily digest writes both `digest_items` and compatibility markdown; daily/monthly history reads `digest_items` through typed IndexedDB range queries.
- Monthly digest migration is implemented: `MonthlyDigestService` aggregates structured `digest_items` by month into category cards; `/vue/monthly-digest` provides the native month selector, local summary view, AI 月报 task dispatch, and 时政练习 entry.
- Interview migration is implemented: `interview_sessions` is the primary structured runtime table; `InterviewRepository` owns question picking, local scoring, session persistence, history, stats, and AI review dispatch; `/vue/interview` provides the native setup, timed answer, result, and review flow. Voice answer input is wired through `SpeechRecognitionAdapter` and the iOS `SpeechRecognitionPlugin`, with transcript and speech metrics stored on each interview answer. AI deep review is task-bound, cancellable/retryable, writes Markdown feedback back to the session, and task/bell clicks route to `/vue/interview`. In-progress interview drafts are saved locally on edits/backgrounding and restored after app resume or relaunch.
- Quality dashboard migration is implemented: `QualityDashboardService` reads `practice_sessions`, `wrong_items`, `ability_profiles`, and `learning_events` through structured indexes; `/vue/quality-dashboard` provides the native quality score, module ability, trend, review quality, and weak-module practice entry.
- Knowledge graph migration is implemented: `KnowledgeGraphService` reads `ability_profiles` and `wrong_items` through structured indexes and combines them with the typed default knowledge tree; `/vue/knowledge-graph` provides the native module/knowledge point map and weak-point practice entry.
- Error report migration is implemented: `ErrorReportService` reads `wrong_items` and `questions` through structured indexes; `/vue/error-report` provides the native error category distribution, module breakdown, recommendations, wrongbook jump, and weak-error practice entry.
- Sprint migration is implemented: `SprintService` reads `ability_profiles`, `wrong_items`, and `questions` through structured indexes; `/vue/sprint` provides the native countdown, intensity switch, today mission, weak-point ranking, mock/wrongbook/error-report shortcuts, and weak-point practice entry.
- Study migration is implemented: `StudyService` reads `ability_profiles`, `wrong_items`, and `questions` through structured indexes and combines them with the typed default knowledge tree; `/vue/study` provides the native search, weak-point learning, knowledge tree, and dedicated `study` AI task dispatch entry. Home/plan/calendar practice entries now route to native Vue practice instead of legacy `practice-card`.
- Vue smoke and IPA packaging are verified: `smoke:vue` / `smoke:ios` check the migrated Vue runtime, pure Vue builds exclude legacy fallback assets by default, `smoke:ios:legacy` remains available for the old HTML bundle, `verify-ios-ipa.js` supports both Vue and legacy packages, and `ios:archive:web` exports a verified Vue IPA.

Next implementation steps:

1. Keep the default production/App Store package as pure Vue.
2. Keep legacy IPA and `--with-legacy-fallback` Vue builds only for rollback and
   parity testing.
3. Migrate service contracts first, then pages. Do not rewrite page structure
   before the underlying service has parity.
4. Keep `./ios/package-ipa.sh legacy` available until one full release cycle
   after the Vue route set is stable.

## Full Business Function Migration Plan

### Migration Rule

The old app structure is the product baseline. Vue migration must preserve:

- the same bottom tabs: home, practice, exam, wrongbook, profile
- the same subpage flows: calendar, plan, practice-card, essay, digest,
  monthly-digest, interview, knowledge-graph, quality-dashboard, sprint,
  error-report, study
- the same AI/task behavior: background task strip, tool process rows,
  duplicate task locks, cancellation, retry, result navigation
- the same local-first behavior: no required server, user API key, local data

UI can be improved, but information architecture and business behavior cannot
be reduced during migration.

### Current Compatibility Layer

Legacy assets can be copied into the Vue public directory for rollback testing:

```text
web/public/legacy/
```

The default Vue route `/` loads native `HomeView`; product paths such as
`/practice`, `/exam`, `/wrongbook`, `/profile`, and migrated tool pages redirect
to their native Vue implementations. The default Vue/App Store build removes
`web/public/legacy` and does not register `/legacy/:page`; set
`ZHANGL_VUE_BUNDLE_LEGACY=1 VITE_ENABLE_LEGACY_FALLBACK=1` or run
`./ios/package-ipa.sh vue --with-legacy-fallback` only when a rollback/parity
bundle is needed.

### Service-First Target Modules

Before replacing pages, split the old `common.js` and `common/*.js` behavior
into typed services:

```text
web/src/services/
  ProjectService.ts             project create/list/switch/delete/import
  PlanService.ts                exam date, phases, daily plan, today task
  PracticeService.ts            practice center, recent sessions, session flow
  QuestionService.ts            question bank, metadata, generated questions
  GradingService.ts             objective grading, essay grading, mock grading
  WrongBookService.ts           wrong item index, review queue, redo flow
  CalendarService.ts            daily completion, activity, date detail
  AbilityService.ts             ability profile, module/knowledge stats
  DigestService.ts              daily accumulation, monthly digest
  ExamService.ts                mock exam generation/history/statistics
  EssayService.ts               topic, draft, timer, submit, feedback, history
  InterviewService.ts           interview question pool, answer scoring, history
  ReportService.ts              error report, quality dashboard, sprint report
  AIConversationService.ts      chat sessions, messages, tool rows
  LocalFileCompatService.ts     legacy file read/write/export compatibility
```

Rules:

- Pages call services only.
- Services read/write repositories and task queue.
- Legacy markdown/json files are compatibility/export formats, not hot-path
  runtime storage.
- Every AI write is task-bound and idempotent.

### Repository And Index Migration

The hot path should use structured stores:

```text
projects
settings
files
questions
question_metadata
practice_sessions
answers
wrong_items
ability_profiles
knowledge_points
learning_events
plans
daily_tasks
essay_records
mock_exams
digest_records
interview_sessions
ai_sessions
ai_messages
ai_tasks
task_logs
```

Compatibility writes should remain until all legacy pages are removed:

- generated practice questions also export to the old practice file location
- wrongbook updates also export the old wrongbook markdown/json format
- essay grading also writes the old essay history location
- digest/monthly digest also write old digest files
- plan/project settings remain readable by old pages

### Business Module Order

#### 1. Foundation And Project

Scope:

- project create/list/switch/delete
- active project persistence
- exam date, exam name, target question count
- legacy data import and compatibility export
- theme, font size, safe-area, keyboard behavior

Vue pages/components:

- project selector
- new project sheet
- settings/profile project management

Parity checklist:

- old project data appears in Vue without manual conversion
- switching project updates all tabs
- deleting project cannot delete the active project without confirmation
- Xcode run, Vue IPA, and legacy IPA can all read the same project data

#### 2. Task And AI Runtime

Scope:

- task queue
- duplicate lock
- cancel/retry
- foreground recovery
- task dock
- AI chat sessions
- tool execution rows
- provider config in Keychain

Parity checklist:

- generation tasks appear immediately, not only after completion
- running tasks pulse in task dock and AI process row
- duplicate generation is blocked by `lock_key`
- app background/foreground does not lose task state
- task row shows tool + brief content + status, not only "step done"

#### 3. Home Shell

Scope:

- bottom tab shell
- home dashboard
- countdown
- today tasks
- quick actions
- ability overview
- ability improvement center entries
- task bell/calendar entry

Parity checklist:

- every old home entry opens the same destination
- daily accumulation/digest tasks show as generation tasks
- ability center preserves old enable/disable conditions
- no route dead ends
- first render does not depend on markdown scanning

#### 4. Practice Center And Practice Card

Scope:

- practice center
- module selection
- recent practice, latest 7 records only
- practice-card full answering flow
- single/multiple question rendering
- timer
- submit/grading
- answer explanation
- wrongbook write
- ability profile update
- regenerate/delete/history

Parity checklist:

- direct practice from home module opens the correct module
- recent practice shows latest 7 records
- answer state survives app switch
- grading writes `answers`, `wrong_items`, `ability_profiles`,
  `learning_events`
- no markdown scan on practice center load

#### 5. Wrongbook And Error Report

Scope:

- wrongbook filters
- due review queue
- redo practice
- wrong item status
- error report
- weak practice from report

Parity checklist:

- wrongbook reads structured `wrong_items`
- old wrongbook data is imported once and deduplicated
- redo updates the original wrong item
- error report can locate cause/module/knowledge point
- opening wrongbook under normal data volume renders under 300 ms

#### 6. Calendar And Study Plan

Scope:

- calendar month view
- date detail
- plan page
- today task completion
- phase/progress calculation
- study page

Parity checklist:

- calendar date detail uses `learning_events` and metadata counts
- clicking a date does not parse practice markdown for counts
- plan/task completion reflects practice, essay, digest, mock activity
- study page entries navigate to the same flows as legacy

#### 7. Essay

Scope:

- daily essay topic
- material/question display
- type picker
- draft autosave
- timer
- generation
- submit
- AI grading
- feedback tabs
- history/delete/regenerate

Parity checklist:

- back navigation works from essay
- draft survives background/foreground and app relaunch
- timer reconciles elapsed time correctly
- grading writes structured essay record and compatibility file
- feedback has score, dimensions, comments, and revision advice

#### 8. Exam

Scope:

- 行测/申论 subject switch
- generate paper
- history through structured mock sessions
- statistics through structured mock sessions
- delete latest exam
- open mock practice
- mock timer/submit/report

Parity checklist:

- generating exam creates visible task immediately: implemented in `/vue/exam`
- generated exam opens correct flow: implemented, 行测 -> `/vue/practice`, 申论 -> `/vue/essay`
- history grouped by date/month matches legacy behavior: native month grouping is implemented in `/vue/exam`
- mock results write learning events, answers, wrongbook, ability profile

#### 9. Digest And Monthly Digest

Scope:

- daily accumulation
- digest tabs
- generation/task state
- digest history through structured file repository
- monthly digest generation
- AI chat about digest
- practice from digest

Parity checklist:

- daily digest tasks use task queue and locks: implemented in `/vue/digest`
- monthly digest tasks use task queue and locks: implemented for AI-generated monthly reports; local monthly aggregation is native and indexed
- generated daily content is saved in structured records and compatibility files: implemented, saved to `digest_items` plus `每日热点/YYYY-MM-DD.md` / `每日知识点/YYYY-MM-DD.md`
- digest entries appear in task dock with correct category/title
- history can load old generated files

#### 10. Knowledge Graph, Quality Dashboard, Sprint

Scope:

- knowledge graph list/canvas view
- knowledge point detail
- drill practice
- quality dashboard
- sprint plan/report/actions

Parity checklist:

- graph uses structured ability and knowledge data
- weak knowledge point practice opens correct practice-card flow
- quality dashboard has the same statistics as legacy
- sprint is enabled/disabled by the same exam-date and ability conditions

#### 11. Interview

Scope:

- question type selector
- difficulty
- timer
- answer input
- voice input and transcript metrics
- local scoring
- AI deep review
- history

Parity checklist:

- question selection and scoring match legacy formulas: implemented in `InterviewRepository`
- history persists locally: implemented in `interview_sessions`
- voice transcript and metrics persist locally: implemented through `answers[].transcript` and `answers[].speechMetrics`
- AI review is task-bound, cancellable/retryable, persisted, and routable from task/bell entries
- no data is lost when switching apps during interview: local draft autosave and restore are implemented in `/vue/interview`

#### 12. Profile And Settings

Scope:

- statistics
- AI provider config
- secure key storage
- project management
- data export/import
- local notifications
- sync settings if enabled later

Parity checklist:

- stats match legacy totals
- API key is stored in Keychain on iOS
- clearing config does not clear study data
- export/import round trip preserves core data

### Route Switch Policy

For each page:

1. Keep production route on the native Vue page.
2. Build native Vue page under `/vue/<page>`.
3. Add service-level tests or smoke assertions.
4. Run manual device parity test.
5. Keep legacy fallback available only through explicit rollback builds.

Do not switch all routes at once.

### Manual Device Smoke Checklist

Before any IPA is considered usable:

- launch app cold
- switch all five bottom tabs
- open every home ability-center entry
- create/switch project
- generate practice task and cancel it
- complete one practice and see wrongbook/profile/calendar update
- open essay, type draft, background app, return, submit grading
- generate daily digest and monthly digest
- open exam history and start a mock
- open AI chat, run one tool task, background app, return
- lock phone, unlock, verify background color is not black
- force-close and reopen, verify state is consistent

### Release Gate

The Vue package can replace legacy production only when:

- all modules above have passed parity checklist
- no production path depends on placeholder/mock data
- all hot pages use structured stores instead of markdown scanning
- iPhone foreground/background black-background issue is verified fixed
- IPA verifier confirms expected resource mode
- one rollback IPA can still be built with `./ios/package-ipa.sh legacy`
