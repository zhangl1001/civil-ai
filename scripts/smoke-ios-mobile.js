#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "backend/static/mobile");
const iosDir = path.join(root, "ios/App/App/public");

const requiredFiles = [
  "index.html",
  "home.html",
  "practice.html",
  "practice-card.html",
  "essay.html",
  "exam.html",
  "wrongbook.html",
  "profile.html",
  "common.js",
  "common/local-store.js",
  "common/stats.js",
  "common/prompts.js",
  "common/tools.js",
  "common/context-manager.js",
  "common/ai-engine.js",
];

function fail(message) {
  console.error(`smoke-ios-mobile: ${message}`);
  process.exit(1);
}

function listFiles(dir) {
  const result = [];
  function walk(current, prefix = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = path.join(prefix, entry.name);
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else result.push(rel.split(path.sep).join("/"));
    }
  }
  walk(dir);
  return result.sort();
}

for (const dir of [sourceDir, iosDir]) {
  if (!fs.existsSync(dir)) fail(`missing directory: ${path.relative(root, dir)}`);
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(dir, file))) {
      fail(`missing ${file} in ${path.relative(root, dir)}`);
    }
  }
}

const sourceFiles = listFiles(sourceDir).filter((file) => !file.startsWith("cordova"));
const iosFiles = listFiles(iosDir).filter((file) => !file.startsWith("cordova"));
const sourceSet = new Set(sourceFiles);
const iosSet = new Set(iosFiles);

const missingInIos = sourceFiles.filter((file) => !iosSet.has(file));
const extraInIos = iosFiles.filter((file) => !sourceSet.has(file));
if (missingInIos.length || extraInIos.length) {
  if (missingInIos.length) console.error("Missing in iOS public:", missingInIos.join(", "));
  if (extraInIos.length) console.error("Extra in iOS public:", extraInIos.join(", "));
  fail("iOS public is not synced with backend/static/mobile");
}

for (const file of sourceFiles) {
  const src = fs.readFileSync(path.join(sourceDir, file));
  const dst = fs.readFileSync(path.join(iosDir, file));
  if (!src.equals(dst)) fail(`content differs: ${file}`);
}

const jsFiles = sourceFiles.filter((file) => file.endsWith(".js") && !["lucide.js", "marked.js", "mermaid.min.js"].includes(file));
for (const file of jsFiles) {
  const full = path.join(sourceDir, file);
  const result = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    fail(`JavaScript syntax check failed: ${file}`);
  }
}

const index = fs.readFileSync(path.join(sourceDir, "index.html"), "utf8");
if (!index.includes("Content-Security-Policy")) fail("index.html is missing a Content Security Policy");
if (!index.includes("maximum-scale=1.0") || !index.includes("user-scalable=no")) {
  fail("index.html is missing the iOS focus-zoom viewport guard");
}
for (const script of [
  "common/local-store.js",
  "common/stats.js",
  "common/prompts.js",
  "common/tools.js",
  "common/context-manager.js",
  "common/ai-engine.js",
  "common.js",
]) {
  if (!index.includes(script)) fail(`index.html does not load ${script}`);
}

const localStore = fs.readFileSync(path.join(sourceDir, "common/local-store.js"), "utf8");
for (const marker of [
  "const DB_VERSION = 3",
  "const SCHEMA_VERSION = 3",
  "createObjectStore('meta'",
  "getSchemaInfo",
  "normalizeImportData",
  "备份版本过高",
]) {
  if (!localStore.includes(marker)) fail(`LocalStore schema guard missing: ${marker}`);
}

const common = fs.readFileSync(path.join(sourceDir, "common.js"), "utf8");
for (const marker of ["API.pageError", "API.showInlineError"]) {
  if (!common.includes(marker)) fail(`common runtime guard missing: ${marker}`);
}
const commonCss = fs.readFileSync(path.join(sourceDir, "common.css"), "utf8");
for (const marker of ['font-size: 16px !important', '-webkit-text-size-adjust: 100%']) {
  if (!commonCss.includes(marker)) fail(`iOS input zoom guard missing: ${marker}`);
}
for (const marker of ["API.Repository", "ProjectRepository", "PlanProgressReducer", "API.Index", "PageRuntime", "PageRuntime.on", "_enhanceAccessibility", "isAllowedApiBase", "mockExamPath", "importRemoteProject", "resolveMigration", "projectSummary", "cache: 'force-cache'"]) {
  if (!common.includes(marker)) fail(`repository/business reducer missing: ${marker}`);
}
if (common.includes("name + '.html?_=' + Date.now()") || common.includes("Preload all tab roots")) {
  fail("shell loading strategy still bypasses static asset cache");
}
if (common.includes("(0,eval)")) fail("page runtime still uses global eval");
for (const marker of ["PageRuntime.unmount", "PageRuntime.addCleanup", "PageRuntime.retainScript", "scriptRefs", "API._runScripts = async", "inline.dataset.pageRuntime"]) {
  if (!common.includes(marker)) fail(`page lifecycle guard missing: ${marker}`);
}
if (index.includes("mermaid.min.js")) fail("Mermaid is still eagerly loaded by index.html");
for (const marker of ["API.copyText", "API._copyTextFallback", "API.confirmDanger", "API.UI", "API.IOSViewport"]) {
  if (!common.includes(marker)) fail(`common iOS/data safety guard missing: ${marker}`);
}
for (const marker of ["API.StyleGuard", "cssHealthy", "reloadCommonCss", "app-active", "ensureCriticalStyle", "style-guard-critical", "style-guard-sentinel"]) {
  if (!common.includes(marker)) fail(`iOS resume style guard missing: ${marker}`);
}
for (const marker of ["API._sanitize", "foreignObject", "javascript:", "data:image\\/"]) {
  if (!common.includes(marker)) fail(`AI HTML sanitizer guard missing: ${marker}`);
}
for (const marker of ["API.SecureConfig", "API.LearningNotifications", "consumePendingRoute", "isNative", "Keychain"]) {
  if (!common.includes(marker)) fail(`secure AI config guard missing: ${marker}`);
}
for (const marker of ["API.Business", "buildTodayTasks", "loadSyllabusTargets", "questionTrustFromText", "scoreTrust", "reviewPriority", "createTargetModel"]) {
  if (!common.includes(marker)) fail(`business loop guard missing: ${marker}`);
}
for (const marker of ["questionMeta", "scoreRecord", "learningEvent", "reviewItem", "questionQuality", "queue_v2"]) {
  if (!common.includes(marker)) fail(`business v2 common guard missing: ${marker}`);
}
for (const marker of ["API.AITaskQueue", "status: 'queued'", "API.AIThrottle", "API.AIExecutorPool", "claimBackground", "aic-bg-concurrency", "status: 'retrying'", "lockKey", "canEnqueue", "appendLog", "aic-task-strip", "aic-task-entry", "aic-task-popover", "aic-task-update", "_aiToggleTaskStrip", "data-aic-task-id", "Task 0/0", "taskRefs", "_sessionAttachTask", "_sessionAppendTaskSummary", "_aiRenderTaskCards", "replyTarget", "API.Schema", "getSyncDiagnostics", "listSyncLog"]) {
  if (!common.includes(marker)) fail(`P1/P2/P3 runtime guard missing: ${marker}`);
}
const aiEngine = fs.readFileSync(path.join(sourceDir, "common/ai-engine.js"), "utf8");
for (const marker of ["_isRateLimitError", "_retryAfterMs", "retry-after=", "skipToolReset"]) {
  if (!aiEngine.includes(marker)) fail(`AI performance/rate-limit guard missing: ${marker}`);
}
const tools = fs.readFileSync(path.join(sourceDir, "common/tools.js"), "utf8");
for (const marker of ["题目元数据.json", "评分记录.json", "学习事件.json", "学习事务.json", "复习项目.json", "_recordQuestionMetadata", "_recordScore", "_recordLearningEvent", "_runGradingTransaction", "_updateUnifiedReviewItems", "_validateGradesAgainstFile", "source_type", "confidence"]) {
  if (!tools.includes(marker)) fail(`business v2 tool guard missing: ${marker}`);
}
if (tools.includes("LocalStore.")) fail("tools.js bypasses ProjectRepository");
const localStoreBusiness = fs.readFileSync(path.join(sourceDir, "common/local-store.js"), "utf8");
for (const marker of ["题目元数据.json", "评分记录.json", "学习事件.json", "学习事务.json", "复习项目.json", "申论画像.json", "面试画像.json"]) {
  if (!localStoreBusiness.includes(marker)) fail(`business v2 default file missing: ${marker}`);
}
for (const marker of ["maxFiles = 5000", "maxBytes = 20 * 1024 * 1024", "normalizePath"]) {
  if (!localStoreBusiness.includes(marker)) fail(`import boundary guard missing: ${marker}`);
}

const pageChecks = [
  { file: "home.html", init: "API.initPage('home')", markers: ["renderTodayPlan", "API.Business.buildTodayTasks", "diagnosis", "API.confirmDanger('删除工程'"] },
  { file: "practice.html", init: "API.initPage('practice')", markers: ["loadHistory", "API.showInlineError", "API.pageError('practice init'"] },
  { file: "essay.html", init: "API.initPage('practice')", markers: ["_restoreEsEmpty", "API.pageError('essay aic done'", "评分可信度要求", "API.PageRuntime.mountController('push:essay'", "data-es-action"] },
  { file: "interview.html", init: "API.initPage('interview')", markers: ["startInterview", "API.writeFile('面试画像.json'", "评分可信度要求"] },
  { file: "profile.html", init: "API.initPage('profile')", markers: ["showDataMgmt", "showExportSheet", "dm-business", "API.Profile =", "API.Profile.openSync()", "data-profile-action", "mountController(API.PageRuntime.currentTag || 'profile'", "API.confirmDanger('清除工程数据'", "files_imported"] },
  { file: "calendar.html", init: "API.initPage('calendar')", markers: ["API.Index.practice", "API.Index.mocks", "await render();", "练习记录暂时加载失败"] },
  { file: "plan.html", init: "API.initPage('plan')", markers: ["API.Business.buildTodayTasks", "business_model", "diagnosis"] },
  { file: "practice-card.html", init: "API.initPage('practice')", markers: ["q-source-tag", "TARGET_KP", "目标大纲考点", "出题质量硬性要求", "评分可信度要求", "API.PageRuntime.mountController('push:practice-card'", "data-pc-action"] },
  { file: "wrongbook.html", init: "API.initPage('wrongbook')", markers: ["reviewPriority", "wb-priority", "reviewPriority.label", "WB_PAGE_SIZE", "loadMoreWrongItems", "data-wb-action", "API.PageRuntime.mountController('wrongbook'"] },
  { file: "study.html", init: "API.initPage('study')", markers: ["大纲未学", "样本不足", "掌握度"] },
];
for (const check of pageChecks) {
  const html = fs.readFileSync(path.join(sourceDir, check.file), "utf8");
  if (!html.includes("common.js")) fail(`${check.file} does not load common.js`);
  if (!html.includes(check.init)) fail(`${check.file} missing ${check.init}`);
  for (const marker of check.markers) {
    if (!html.includes(marker)) fail(`${check.file} missing page smoke marker: ${marker}`);
  }
}
for (const controllerPage of ["essay.html", "practice-card.html"]) {
  const html = fs.readFileSync(path.join(sourceDir, controllerPage), "utf8");
  for (const forbidden of ["onclick=", ".onclick", "oninput="]) {
    if (html.includes(forbidden)) fail(`${controllerPage} still has inline/controller-bypassing handler: ${forbidden}`);
  }
}
const wrongbookMainInline = fs.readFileSync(path.join(sourceDir, "wrongbook.html"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.includes("onclick=") && !line.includes("window._fc"));
if (wrongbookMainInline.length) {
  fail(`wrongbook main flow still has inline handler: ${wrongbookMainInline[0].trim()}`);
}
const interview = fs.readFileSync(path.join(sourceDir, "interview.html"), "utf8");
if (interview.includes("LocalStore.writeFile('面试画像.json'")) {
  fail("interview.html uses LocalStore.writeFile without active project");
}
const exam = fs.readFileSync(path.join(sourceDir, "exam.html"), "utf8");
for (const marker of ["API.mockExamPath('行测'", "API.mockExamPath('申论'", "练习/模拟考试/' + subject + '/'"]) {
  if (!exam.includes(marker)) fail(`exam subject isolation missing: ${marker}`);
}
if (!exam.includes("API.Index.mocks") || !exam.includes("getExamFiles")) {
  fail("exam does not query the structured mock index");
}
for (const marker of ["onExamAiDone", "onExamAiStopped", "PageRuntime.addCleanup"]) {
  if (!exam.includes(marker)) fail(`exam interruption recovery guard missing: ${marker}`);
}
const practiceCard = fs.readFileSync(path.join(sourceDir, "practice-card.html"), "utf8");
for (const marker of ["API.isGenerating('practice', MOD, DATE)", "doneModule !== MOD", "aic-failed", "submittedKey()", "_pcHandleAiStopped"]) {
  if (!practiceCard.includes(marker)) fail(`practice interruption/cross-page recovery guard missing: ${marker}`);
}
for (const marker of ["window.addEventListener('online'", "scheduleSync(project)", "LocalStore.enqueueSync", "resolveMigration"]) {
  if (!common.includes(marker)) fail(`offline reconnect/migration guard missing: ${marker}`);
}
const practice = fs.readFileSync(path.join(sourceDir, "practice.html"), "utf8");
for (const marker of ["dateRows", "API.Index.practice", "renderHistoryRows", "API.escapeJs(r.module)"]) {
  if (!practice.includes(marker)) fail(`practice history module isolation missing: ${marker}`);
}
const profile = fs.readFileSync(path.join(sourceDir, "profile.html"), "utf8");
for (const marker of ["showMigrationChoice", "使用服务端副本", "合并并同步"]) {
  if (!profile.includes(marker)) fail(`profile migration choice missing: ${marker}`);
}
if (!profile.includes("API.isAllowedApiBase")) fail("profile API endpoint validation missing");
if (!profile.includes("enableLearningNotifications")) fail("profile learning notification control missing");
const infoPlist = fs.readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
if (infoPlist.includes("NSAllowsArbitraryLoads")) fail("iOS ATS still permits arbitrary HTTP loads");
const keychainPlugin = fs.readFileSync(path.join(root, "ios/App/App/KeychainPlugin.swift"), "utf8");
if (!keychainPlugin.includes("SecItemAdd") || !keychainPlugin.includes("CAPBridgedPlugin")) fail("iOS Keychain plugin is incomplete");
const mainController = fs.readFileSync(path.join(root, "ios/App/App/MainViewController.swift"), "utf8");
if (!mainController.includes("registerPluginType(KeychainPlugin.self)")) fail("Keychain plugin is not registered with Capacitor");
if (!mainController.includes("UIApplication.didBecomeActiveNotification") || !mainController.includes('eventName: "app-active"')) fail("iOS active resume event is not bridged to WebView");
const notificationPlugin = fs.readFileSync(path.join(root, "ios/App/App/LearningNotificationPlugin.swift"), "utf8");
if (!notificationPlugin.includes("UNNotificationRequest") || !notificationPlugin.includes("consumePendingRoute") || !notificationPlugin.includes("getStatus") || !notificationPlugin.includes("clearAll")) fail("iOS learning notification plugin is incomplete");
if (!mainController.includes("registerPluginType(LearningNotificationPlugin.self)")) fail("learning notification plugin is not registered with Capacitor");

const archiveScript = fs.readFileSync(path.join(root, "scripts/archive-ios.sh"), "utf8");
for (const marker of ["verify-ios-ipa.js", "rm -rf \"$ARCHIVE_PATH\"", "! -name 'App.ipa'"]) {
  if (!archiveScript.includes(marker)) fail(`release output governance missing: ${marker}`);
}

console.log(`iOS mobile smoke passed: ${sourceFiles.length} synced files, ${jsFiles.length} JS checks`);
