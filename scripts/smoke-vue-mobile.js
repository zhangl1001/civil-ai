#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`smoke-vue-mobile: ${message}`);
  process.exit(1);
}

function read(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) fail(`missing ${rel}`);
  return fs.readFileSync(full, "utf8");
}

const required = [
  "web/src/platform/AppLifecycleAdapter.ts",
  "web/src/platform/StatusBarAdapter.ts",
  "web/src/platform/WebViewRepaintGuard.ts",
  "web/src/platform/SecureStoreAdapter.ts",
  "web/src/platform/SpeechRecognitionAdapter.ts",
  "web/src/platform/LearningNotificationAdapter.ts",
  "web/src/services/AIConfigService.ts",
  "web/src/ai/AIEngine.ts",
  "web/src/ai/AIProvider.ts",
  "web/src/tasks/AIRunners.ts",
  "web/src/tasks/TaskPresenter.ts",
  "web/src/services/QuestionRepository.ts",
  "web/src/services/PracticeSessionRepository.ts",
  "web/src/services/PracticeFlowService.ts",
  "web/src/services/WrongBookRepository.ts",
  "web/src/services/HomeDashboardRepository.ts",
  "web/src/services/HomeFeatureService.ts",
  "web/src/services/CalendarService.ts",
  "web/src/services/PlanDashboardService.ts",
  "web/src/domain/home.ts",
  "web/src/domain/calendar.ts",
  "web/src/stores/calendar.ts",
  "web/src/stores/plan.ts",
  "web/src/views/CalendarView.vue",
  "web/src/views/PlanView.vue",
  "web/src/services/ProfileStatsRepository.ts",
  "web/src/services/EssayRepository.ts",
  "web/src/services/EssayFlowService.ts",
  "web/src/services/ExamFlowService.ts",
  "web/src/services/DigestService.ts",
  "web/src/services/DigestRepository.ts",
  "web/src/services/MonthlyDigestService.ts",
  "web/src/services/InterviewRepository.ts",
  "web/src/services/QualityDashboardService.ts",
  "web/src/services/KnowledgeGraphService.ts",
  "web/src/services/ErrorReportService.ts",
  "web/src/services/SprintService.ts",
  "web/src/services/StudyService.ts",
  "web/src/services/PlanService.ts",
  "web/src/services/KnowledgeDefaults.ts",
  "web/src/domain/plan.ts",
  "web/src/domain/digest.ts",
  "web/src/domain/interview.ts",
  "web/src/components/AIChatSheet.vue",
  "web/src/components/TaskDock.vue",
  "web/src/views/ExamView.vue",
  "web/src/views/DigestView.vue",
  "web/src/views/MonthlyDigestView.vue",
  "web/src/views/InterviewView.vue",
  "web/src/views/QualityDashboardView.vue",
  "web/src/views/KnowledgeGraphView.vue",
  "web/src/views/ErrorReportView.vue",
  "web/src/views/SprintView.vue",
  "web/src/views/StudyView.vue",
  "web/dist/index.html"
];

for (const file of required) read(file);

const webPackage = read("web/package.json");
for (const marker of ["prepare-vue-public-assets.sh", "build:with-legacy"]) {
  if (!webPackage.includes(marker)) fail(`web package legacy boundary missing ${marker}`);
}
const packageIpa = read("ios/package-ipa.sh");
for (const marker of ["RESTORE_LEGACY=\"0\"", "--with-legacy-fallback", "--restore-legacy", "ZHANGL_VUE_BUNDLE_LEGACY=1 VITE_ENABLE_LEGACY_FALLBACK=1"]) {
  if (!packageIpa.includes(marker)) fail(`package IPA script Vue/legacy boundary missing ${marker}`);
}
const ipaVerifier = read("scripts/verify-ios-ipa.js");
for (const marker of ["Vue IPA unexpectedly contains legacy fallback assets", "legacy/index.html"]) {
  if (!ipaVerifier.includes(marker)) fail(`IPA verifier legacy boundary missing ${marker}`);
}
if (fs.existsSync(path.join(root, "web/dist/legacy"))) fail("pure Vue dist should not bundle legacy fallback assets");
if (fs.existsSync(path.join(root, "web/public/legacy"))) fail("pure Vue public should not retain legacy fallback assets after default build");

const homeStore = read("web/src/stores/home.ts");
if (homeStore.includes("@/services/repository")) fail("home store still imports legacy API repository");
if (!homeStore.includes("homeDashboardRepository")) fail("home store does not use local dashboard repository");
if (!homeStore.includes("featureGroups")) fail("home store does not expose feature groups");
if (fs.existsSync(path.join(root, "web/src/services/repository.ts"))) {
  fail("legacy placeholder API repository should not exist in Vue services");
}
if (fs.existsSync(path.join(root, "web/src/services/api.ts"))) {
  fail("legacy remote API helper should not exist in local-first Vue services");
}

const homeDashboard = read("web/src/services/HomeDashboardRepository.ts");
if (homeDashboard.includes("fileRepository") || homeDashboard.includes("练习统计.json")) {
  fail("home dashboard should use structured practice sessions instead of compatibility stats");
}

const homeFeatures = read("web/src/services/HomeFeatureService.ts");
for (const marker of ["buildGroups", "error-report", "knowledge-graph", "quality-dashboard", "monthly-digest", "interview"]) {
  if (!homeFeatures.includes(marker)) fail(`home feature service missing: ${marker}`);
}
if (!homeFeatures.includes("/vue/monthly-digest")) fail("monthly digest home entry should use native Vue route");
if (!homeFeatures.includes("/vue/interview")) fail("interview home entry should use native Vue route");
if (!homeFeatures.includes("/vue/quality-dashboard")) fail("quality dashboard home entry should use native Vue route");
if (!homeFeatures.includes("/vue/knowledge-graph")) fail("knowledge graph home entry should use native Vue route");
if (!homeFeatures.includes("/vue/error-report")) fail("error report home entry should use native Vue route");
if (!homeFeatures.includes("/vue/sprint")) fail("sprint home entry should use native Vue route");

const homeView = read("web/src/views/HomeView.vue");
for (const marker of ["/vue/practice", "/vue/study", "/vue/exam", "/vue/wrongbook", "practiceFlowService.writeStartContext"]) {
  if (!homeView.includes(marker)) fail(`home view route missing: ${marker}`);
}
if (homeView.includes("localStorage.setItem('mp-")) fail("home view should write practice context through PracticeFlowService");

const calendarService = read("web/src/services/CalendarService.ts");
for (const marker of ["learningEventRepository.listByProject", "practiceSessionRepository.listByProject", "questionRepository.countBySource", "questionCountFromQuestions"]) {
  if (!calendarService.includes(marker)) fail(`calendar service structured path missing: ${marker}`);
}
if (calendarService.includes("fetchText") || calendarService.includes("fileRepository") || calendarService.includes("题目元数据.json") || calendarService.includes(".md'") || calendarService.includes('.md"') || calendarService.includes("STORES.")) {
  fail("calendar service should not scan compatibility files in runtime path");
}
const calendarView = read("web/src/views/CalendarView.vue");
for (const marker of ["useCalendarStore", "loadMonth", "selectDate", "openPractice", "practiceFlowService.writeStartContext"]) {
  if (!calendarView.includes(marker)) fail(`calendar view migration missing: ${marker}`);
}
if (calendarView.includes("localStorage.setItem('mp-")) fail("calendar view should write practice context through PracticeFlowService");

const planDashboard = read("web/src/services/PlanDashboardService.ts");
for (const marker of ["planService.getPlan", "planService.generateTodayPlan", "AbilityProfile", "todayTasks"]) {
  if (!planDashboard.includes(marker)) fail(`plan dashboard service missing: ${marker}`);
}

const planView = read("web/src/views/PlanView.vue");
for (const marker of ["usePlanStore", "store.generate", "openTask", "AI 优化", "router.push('/vue/practice/session')"]) {
  if (!planView.includes(marker)) fail(`plan view missing: ${marker}`);
}
for (const marker of ["practiceFlowService.writeStartContext", "essayFlowService.writeContext"]) {
  if (!planView.includes(marker)) fail(`plan view flow service missing: ${marker}`);
}
if (planView.includes("localStorage.setItem('mp-") || planView.includes("localStorage.setItem('es-date'")) {
  fail("plan view should write flow context through services");
}

const taskBootstrap = read("web/src/tasks/TaskBootstrap.ts");
for (const marker of ["chatRunner", "essayGradeRunner", "generatePracticeRunner", "digestRunner", "studyRunner", "mockRunner", "taskQueue.register('study'", "taskQueue.register('mock', mockRunner)"]) {
  if (!taskBootstrap.includes(marker)) fail(`real AI runner not registered: ${marker}`);
}
if (taskBootstrap.includes("taskQueue.register('mock', generatePracticeRunner)")) fail("mock should use dedicated mock runner");
if (taskBootstrap.includes("taskQueue.register('chat', demoRunner)")) fail("chat still uses demo runner");
if (!taskBootstrap.includes("resumePaused")) fail("task bootstrap does not resume paused tasks");

const taskStore = read("web/src/tasks/TaskStore.ts");
for (const marker of ["recoverInterrupted", "resumePaused", "status: 'retrying'", "任务恢复执行"]) {
  if (!taskStore.includes(marker)) fail(`task store recovery missing: ${marker}`);
}

const taskPresenter = read("web/src/tasks/TaskPresenter.ts");
for (const marker of ["toTaskViewModel", "visibleTaskRows", "taskStatusText", "canCancelTask"]) {
  if (!taskPresenter.includes(marker)) fail(`task presenter missing: ${marker}`);
}

const aiEngine = read("web/src/ai/AIEngine.ts");
for (const marker of ["aiConfigService.load", "未配置 AI API Key", "OpenAICompatibleProvider", "AnthropicProvider"]) {
  if (!aiEngine.includes(marker)) fail(`AIEngine guard missing: ${marker}`);
}

const aiProvider = read("web/src/ai/AIProvider.ts");
for (const marker of ["/chat/completions", "/messages", "Authorization", "x-api-key"]) {
  if (!aiProvider.includes(marker)) fail(`AI provider missing: ${marker}`);
}

const aiRunners = read("web/src/tasks/AIRunners.ts");
for (const marker of ["parsePracticeOutput", "parseEssayFeedback", "parseEssayQuestion", "questionRepository.saveGenerated", "essayRepository.saveFeedback", "essayRepository.saveQuestion", "aiChatRepository.addMessage", "digestService.saveGenerated", "digestRepository.listForMonth", "monthly-digest", "月度复盘已生成", "studyRunner", "mockRunner", "toolName: 'study'", "考点精讲已生成", "申论模考题已写入"]) {
  if (!aiRunners.includes(marker)) fail(`AI runner missing: ${marker}`);
}

const secureStore = read("web/src/platform/SecureStoreAdapter.ts");
for (const marker of ["Keychain", "secure-fallback", "isNative"]) {
  if (!secureStore.includes(marker)) fail(`secure store missing: ${marker}`);
}

const notificationAdapter = read("web/src/platform/LearningNotificationAdapter.ts");
for (const marker of ["LearningNotifications", "requestPermission", "schedule", "learning-morning", "learning-evening"]) {
  if (!notificationAdapter.includes(marker)) fail(`learning notification adapter missing: ${marker}`);
}

const lifecycle = read("web/src/platform/AppLifecycleAdapter.ts");
for (const marker of ["native-resume", "app-active", "appStateChange", "zhangl-app-active"]) {
  if (!lifecycle.includes(marker)) fail(`lifecycle adapter missing: ${marker}`);
}

const practiceRepo = read("web/src/services/PracticeSessionRepository.ts");
for (const marker of ["STORES.wrongItems", "STORES.abilityProfiles", "STORES.learningEvents"]) {
  if (!practiceRepo.includes(marker)) {
    fail(`practice structured write missing: ${marker}`);
  }
}

const databaseSource = read("web/src/db/database.ts");
for (const marker of ["ensureIndex", "projectSource", "['projectId', 'sourceFile']", "SQLiteDbAdapter", "Capacitor.isNativePlatform", "transaction(operations"]) {
  if (!databaseSource.includes(marker)) fail(`database generated-source index missing: ${marker}`);
}
if (databaseSource.includes("get<T>(storeName: StoreName, key: IDBValidKey") || databaseSource.includes("queryByIndex<T>(storeName: StoreName, indexName: string, key: IDBValidKey")) {
  fail("database adapter interface should not expose IndexedDB key types");
}

const databaseSchema = read("web/src/db/schema.ts");
const databaseVersion = Number((databaseSchema.match(/DB_VERSION\s*=\s*(\d+)/) || [])[1]);
if (!Number.isFinite(databaseVersion) || databaseVersion < 4) fail("database schema version should include generated-source index migration");

const practiceFlow = read("web/src/services/PracticeFlowService.ts");
for (const marker of ["readStartContext", "writeStartContext", "mp-target-module", "mp-practice-mode", "enqueueGeneration", "sourceRef", "mp-source-ref", "result.task.id"]) {
  if (!practiceFlow.includes(marker)) fail(`practice flow missing: ${marker}`);
}

const practiceStore = read("web/src/stores/practice.ts");
for (const marker of ["PracticeStartContext", "start(context", "knowledgePoint", "sourceRef: context.sourceRef", "mode: this.mode"]) {
  if (!practiceStore.includes(marker)) fail(`practice store context missing: ${marker}`);
}
const practiceView = read("web/src/views/PracticeView.vue");
if (practiceView.includes("mock-id")) fail("practice view still uses mock-id");
for (const marker of ["TASK_CHANGED_EVENT", "handleTaskChanged", "taskStore.get(taskId)", "reloadPracticeDetail(practiceFlowService.readStartContext())"]) {
  if (!practiceView.includes(marker)) fail(`practice view generated refresh missing: ${marker}`);
}

const questionRepository = read("web/src/services/QuestionRepository.ts");
for (const marker of ["sourceRef?: string", "projectSource", "sourceFile: question.sourceFile", "saveGenerated(projectId: string, questions: PracticeQuestion[], sourceRef"]) {
  if (!questionRepository.includes(marker)) fail(`question repository generated-source flow missing: ${marker}`);
}

const projectRepo = read("web/src/services/ProjectRepository.ts");
for (const marker of ["createExamPlan", "zhangl-active-project"]) {
  if (!projectRepo.includes(marker)) fail(`project migration marker missing: ${marker}`);
}
for (const marker of ["DEFAULT_PROJECT_FILES", "能力画像.json", "练习统计.json", "题目元数据.json", "索引/错题索引.json", "知识体系.json", "syllabus/"]) {
  if (projectRepo.includes(marker)) fail(`project repository should not write typed knowledge defaults as compatibility files: ${marker}`);
}
if (fs.existsSync(path.join(root, "web/src/services/DefaultProjectFiles.ts"))) {
  fail("legacy default project file constants should be removed from Vue services");
}

const planService = read("web/src/services/PlanService.ts");
for (const marker of ["createBusinessModel", "createExamPlan", "loadSyllabusTargets", "buildTodayTasks", "generateTodayPlan", "STORES.abilityProfiles", "STORES.practiceSessions", "DEFAULT_KNOWLEDGE_TREE", "settingsService.set", "planSettingKey"]) {
  if (!planService.includes(marker)) fail(`plan service marker missing: ${marker}`);
}
for (const marker of ["能力画像.json", "练习统计.json", "syllabus/"]) {
  if (planService.includes(marker)) fail(`plan service should not scan compatibility planning data: ${marker}`);
}

const legacyImport = read("web/src/services/LegacyImportService.ts");
for (const marker of ["zhangl-examtutor", "getAll<LegacyFile>", "fileRepository.writeText", "setActiveProject"]) {
  if (!legacyImport.includes(marker)) fail(`legacy import marker missing: ${marker}`);
}

const wrongbook = read("web/src/views/WrongBookView.vue");
if (wrongbook.includes("const wrongItems = ref([")) fail("wrongbook still uses mock list");
if (!wrongbook.includes("useWrongBookStore")) fail("wrongbook does not use structured store");
for (const marker of ["PracticeFlowService", "router.push('/vue/practice/session')", "startReview"]) {
  if (!wrongbook.includes(marker)) fail(`wrongbook review flow missing: ${marker}`);
}

const wrongbookRepo = read("web/src/services/WrongBookRepository.ts");
for (const marker of ["modules()", "startReview", "practiceFlowService.writeStartContext"]) {
  if (!wrongbookRepo.includes(marker)) fail(`wrongbook repository flow missing: ${marker}`);
}

const profile = read("web/src/views/ProfileView.vue");
for (const marker of ["AI 配置", "saveAIConfig", "iOS Keychain", "profileStatsRepository"]) {
  if (!profile.includes(marker)) fail(`profile AI/stats marker missing: ${marker}`);
}

const essayFlow = read("web/src/services/EssayFlowService.ts");
for (const marker of ["readContext", "es-date", "essay-topic", "enqueueGrading"]) {
  if (!essayFlow.includes(marker)) fail(`essay flow missing: ${marker}`);
}

const essayRepository = read("web/src/services/EssayRepository.ts");
for (const marker of ["saveQuestion", "EssayQuestionRecord", "settingsService.set"]) {
  if (!essayRepository.includes(marker)) fail(`essay repository question flow missing: ${marker}`);
}

const essayStore = read("web/src/stores/essay.ts");
if (essayStore.includes("mock-essay-id")) fail("essay store still uses mock essay id");
if (essayStore.includes("占位反馈")) fail("essay store still writes placeholder feedback");
for (const marker of ["EssayContext", "essayFlowService.enqueueGrading", "submitMessage"]) {
  if (!essayStore.includes(marker)) fail(`essay store flow missing: ${marker}`);
}

const essayView = read("web/src/views/EssayView.vue");
if (essayView.includes("mock-essay-id")) fail("essay view still uses mock essay id");
if (!essayView.includes("essayFlowService.readContext")) fail("essay view does not use essay flow context");

const examFlow = read("web/src/services/ExamFlowService.ts");
for (const marker of ["readContext", "writeContext", "dashboard", "startMock", "practiceFlowService.writeStartContext", "sourceRef: result.task.id", "essayFlowService.writeContext"]) {
  if (!examFlow.includes(marker)) fail(`exam flow missing: ${marker}`);
}

const examView = read("web/src/views/ExamView.vue");
if (examView.includes("router.push('/practice')")) fail("exam view still routes to legacy practice");
for (const marker of ["examFlowService.dashboard", "examFlowService.startMock", "subject-toggle", "最近 30 条", "groupHistoryByMonth", "history-groups", "router.push(subject.value === '行测' ? '/vue/practice/session' : '/vue/essay')"]) {
  if (!examView.includes(marker)) fail(`exam view migration missing: ${marker}`);
}

const digestService = read("web/src/services/DigestService.ts");
for (const marker of ["dashboard", "saveGenerated", "enqueueGenerate", "digestRepository.listForDate", "digestRepository.saveFromMarkdown", "STORES.learningEvents"]) {
  if (!digestService.includes(marker)) fail(`digest service missing: ${marker}`);
}

const digestRepository = read("web/src/services/DigestRepository.ts");
for (const marker of ["STORES.digestItems", "projectTypeDate", "rangeForTab", "listForMonth", "importCompatibilityDate", "fileRepository.readText"]) {
  if (!digestRepository.includes(marker)) fail(`digest repository missing: ${marker}`);
}

const digestView = read("web/src/views/DigestView.vue");
for (const marker of ["digestService.dashboard", "digestService.enqueueGenerate", "mode-tabs", "历史内容"]) {
  if (!digestView.includes(marker)) fail(`digest view migration missing: ${marker}`);
}

const router = read("web/src/router/index.ts");
if (!router.includes("path: '/'") || !router.includes("name: 'Home'") || !router.includes("component: HomeView")) {
  fail("root route should load native Vue home");
}
for (const marker of ["redirect: '/vue/practice'", "redirect: '/vue/exam'", "redirect: '/vue/wrongbook'", "redirect: '/vue/profile'", "redirect: '/vue/study'"]) {
  if (!router.includes(marker)) fail(`product route should redirect to native Vue route: ${marker}`);
}
if (!router.includes("VITE_ENABLE_LEGACY_FALLBACK") || !router.includes("name: 'LegacyFallback'")) {
  fail("legacy fallback route should be gated by build env");
}
if (router.includes("import LegacyFrameView")) fail("legacy fallback should not be statically imported in pure Vue bundle");
if (!router.includes("path: '/vue/digest'")) fail("vue digest route missing");
if (!router.includes("path: '/vue/monthly-digest'")) fail("vue monthly digest route missing");
if (!router.includes("path: '/vue/interview'")) fail("vue interview route missing");
if (!router.includes("path: '/vue/quality-dashboard'")) fail("vue quality dashboard route missing");
if (!router.includes("path: '/vue/knowledge-graph'")) fail("vue knowledge graph route missing");
if (!router.includes("path: '/vue/error-report'")) fail("vue error report route missing");
if (!router.includes("path: '/vue/sprint'")) fail("vue sprint route missing");
if (!router.includes("path: '/vue/study'")) fail("vue study route missing");

const monthlyDigestService = read("web/src/services/MonthlyDigestService.ts");
if (monthlyDigestService.includes("fileRepository")) fail("monthly digest should not scan compatibility files as primary data");
for (const marker of ["dashboard", "recentMonths", "digestRepository.listForMonth", "startPractice", "enqueueReport", "monthlyDigest", "practiceFlowService.writeStartContext"]) {
  if (!monthlyDigestService.includes(marker)) fail(`monthly digest service missing: ${marker}`);
}

const dbSchema = read("web/src/db/schema.ts");
const dbVersion = Number((dbSchema.match(/DB_VERSION\s*=\s*(\d+)/) || [])[1]);
if (!Number.isFinite(dbVersion) || dbVersion < 4) fail("digest schema version should include generated-source index migration");
for (const marker of ["digestItems", "DigestItemRecord", "interviewSessions", "InterviewSessionRecord"]) {
  if (!dbSchema.includes(marker)) fail(`digest schema missing: ${marker}`);
}

const interviewRepo = read("web/src/services/InterviewRepository.ts");
for (const marker of ["STORES.interviewSessions", "pickQuestions", "scoreAnswers", "saveSession", "stats", "speechMetrics", "fluency"]) {
  if (!interviewRepo.includes(marker)) fail(`interview repository missing: ${marker}`);
}
if (interviewRepo.includes("FileRepository") || interviewRepo.includes("fileRepository")) {
  fail("interview repository should use structured database, not compatibility files");
}

const interviewView = read("web/src/views/InterviewView.vue");
for (const marker of ["interviewRepository.pickQuestions", "interviewRepository.saveSession", "speechRecognitionAdapter", "语音作答", "speechMetrics", "作答回顾", "interview-session-draft", "restoreDraft", "saveDraftNow", "visibilitychange"]) {
  if (!interviewView.includes(marker)) fail(`interview view missing: ${marker}`);
}

const speechAdapter = read("web/src/platform/SpeechRecognitionAdapter.ts");
for (const marker of ["SpeechRecognition", "requestSpeechPermissions", "start", "stop", "wordsPerMinute", "fillerCount"]) {
  if (!speechAdapter.includes(marker)) fail(`speech adapter missing: ${marker}`);
}

const speechPlugin = read("ios/App/App/SpeechRecognitionPlugin.swift");
for (const marker of ["SFSpeechRecognizer", "AVAudioEngine", "requestSpeechPermissions", "recognitionTask", "transcript"]) {
  if (!speechPlugin.includes(marker)) fail(`iOS speech plugin missing: ${marker}`);
}

const mainViewController = read("ios/App/App/MainViewController.swift");
if (!mainViewController.includes("SpeechRecognitionPlugin.self")) fail("speech plugin is not registered");

const xcodeProject = read("ios/App/App.xcodeproj/project.pbxproj");
for (const marker of ["SpeechRecognitionPlugin.swift", "SpeechRecognitionPlugin.swift in Sources"]) {
  if (!xcodeProject.includes(marker)) fail(`speech plugin project reference missing: ${marker}`);
}

const infoPlist = read("ios/App/App/Info.plist");
for (const marker of ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]) {
  if (!infoPlist.includes(marker)) fail(`speech permission missing: ${marker}`);
}
if (infoPlist.includes("NSAllowsArbitraryLoads") || infoPlist.includes("NSAllowsLocalNetworking")) {
  fail("iOS App Store build should not include ATS local/arbitrary network exceptions");
}
if (!infoPlist.includes("ITSAppUsesNonExemptEncryption")) fail("iOS export compliance encryption declaration missing");

const monthlyDigestView = read("web/src/views/MonthlyDigestView.vue");
for (const marker of ["monthlyDigestService.dashboard", "month-selector", "时政练习", "AI月报", "monthlyDigestService.enqueueReport", "router.push('/vue/digest')"]) {
  if (!monthlyDigestView.includes(marker)) fail(`monthly digest view missing: ${marker}`);
}

const qualityService = read("web/src/services/QualityDashboardService.ts");
for (const marker of ["STORES.practiceSessions", "STORES.wrongItems", "STORES.abilityProfiles", "STORES.learningEvents", "startWeakPractice"]) {
  if (!qualityService.includes(marker)) fail(`quality dashboard service missing: ${marker}`);
}
if (qualityService.includes("FileRepository") || qualityService.includes("fileRepository")) {
  fail("quality dashboard should not scan compatibility files");
}

const qualityView = read("web/src/views/QualityDashboardView.vue");
for (const marker of ["qualityDashboardService.dashboard", "质量追踪", "正确率趋势", "按薄弱模块练习"]) {
  if (!qualityView.includes(marker)) fail(`quality dashboard view missing: ${marker}`);
}

const knowledgeService = read("web/src/services/KnowledgeGraphService.ts");
for (const marker of ["STORES.abilityProfiles", "STORES.wrongItems", "DEFAULT_KNOWLEDGE_TREE", "startPractice", "practiceFlowService.writeStartContext"]) {
  if (!knowledgeService.includes(marker)) fail(`knowledge graph service missing: ${marker}`);
}
if (knowledgeService.includes("FileRepository") || knowledgeService.includes("fileRepository")) {
  fail("knowledge graph should not scan compatibility files");
}

const knowledgeView = read("web/src/views/KnowledgeGraphView.vue");
for (const marker of ["knowledgeGraphService.dashboard", "知识地图", "训练最弱考点", "selectedPoint"]) {
  if (!knowledgeView.includes(marker)) fail(`knowledge graph view missing: ${marker}`);
}

const errorReportService = read("web/src/services/ErrorReportService.ts");
for (const marker of ["STORES.wrongItems", "STORES.questions", "startWeakPractice", "practiceFlowService.writeStartContext", "normalizeCategory"]) {
  if (!errorReportService.includes(marker)) fail(`error report service missing: ${marker}`);
}
if (errorReportService.includes("FileRepository") || errorReportService.includes("fileRepository")) {
  fail("error report should not scan compatibility files");
}

const errorReportView = read("web/src/views/ErrorReportView.vue");
for (const marker of ["errorReportService.report", "错因报告", "按首要错因加练", "distributionRows"]) {
  if (!errorReportView.includes(marker)) fail(`error report view missing: ${marker}`);
}

const sprintService = read("web/src/services/SprintService.ts");
for (const marker of ["STORES.abilityProfiles", "STORES.wrongItems", "STORES.questions", "startWeakPractice", "practiceFlowService.writeStartContext"]) {
  if (!sprintService.includes(marker)) fail(`sprint service missing: ${marker}`);
}
if (sprintService.includes("FileRepository") || sprintService.includes("fileRepository")) {
  fail("sprint should not scan compatibility files");
}

const sprintView = read("web/src/views/SprintView.vue");
for (const marker of ["sprintService.dashboard", "考前冲刺", "薄弱知识点排名", "弱项突击"]) {
  if (!sprintView.includes(marker)) fail(`sprint view missing: ${marker}`);
}

const studyService = read("web/src/services/StudyService.ts");
for (const marker of ["STORES.abilityProfiles", "STORES.wrongItems", "STORES.questions", "DEFAULT_KNOWLEDGE_TREE", "generationTaskService.enqueue"]) {
  if (!studyService.includes(marker)) fail(`study service missing: ${marker}`);
}
if (studyService.includes("intent: 'digest'")) fail("study service should use study intent, not digest");
if (!studyService.includes("intent: 'study'")) fail("study service should dispatch study intent");
if (studyService.includes("FileRepository") || studyService.includes("fileRepository")) {
  fail("study should not scan compatibility files");
}

const studyView = read("web/src/views/StudyView.vue");
for (const marker of ["studyService.dashboard", "chat.open", "考点精讲", "薄弱考点", "知识体系"]) {
  if (!studyView.includes(marker)) fail(`study view missing: ${marker}`);
}

const appCss = read("web/src/assets/styles/main.css");
for (const marker of ["html.native-ios *", "backdrop-filter: none !important", "#app"]) {
  if (!appCss.includes(marker)) fail(`iOS repaint CSS missing: ${marker}`);
}
if (appCss.includes("iosResumeRepaint") || appCss.includes("html::before")) {
  fail("iOS repaint CSS should not force whole-page compositor layers");
}

const capacitorPlatform = read("web/src/platform/capacitor.ts");
for (const marker of ["installNativePlatformClass", "native-ios", "getPlatform"]) {
  if (!capacitorPlatform.includes(marker)) fail(`native iOS platform marker missing: ${marker}`);
}

const distIndex = read("web/dist/index.html");
if (!distIndex.includes("./assets/")) fail("Vue dist does not use relative assets");

console.log("Vue mobile smoke passed");
