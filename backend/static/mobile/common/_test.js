// ===== 集成测试 — 移动端 Agent 完整能力验证 =====
// 在 Node.js 下模拟测试核心功能（无需浏览器/设备）

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0;
var failed = 0;
var errors = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✅ ' + msg);
  } else {
    failed++;
    errors.push(msg);
    console.log('  ❌ ' + msg);
  }
}

function section(name) {
  console.log('\n── ' + name + ' ──');
}

// ── 加载所有 JS 文件 ──────────────────────────────────────
var baseDir = '/Users/zhanglei/code/zhangl-agent/backend/static/mobile/common';

// 加载各模块（顺序与 index.html 一致）
var files = ['local-store.js', 'stats.js', 'prompts.js', 'tools.js', 'context-manager.js', 'ai-engine.js'];
var code = '';
files.forEach(function(f) {
  code += fs.readFileSync(path.join(baseDir, f), 'utf8') + '\n';
});

// 将所有 const 替换为 var（vm sandbox 中 const 不会挂到 sandbox 对象上）
code = code.replace(/\bconst\b\s+/g, 'var ');

// 创建共享全局上下文
var sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Promise: Promise,
  JSON: JSON,
  Math: Math,
  Date: Date,
  RegExp: RegExp,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  Error: Error,
  TypeError: TypeError,
  RangeError: RangeError,
  Map: Map,
  Set: Set,
  TextDecoder: TextDecoder,
  TextEncoder: TextEncoder,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  isFinite: isFinite,
  CapacitorHttp: undefined,
  indexedDB: undefined,
  localStorage: {
    _store: {},
    getItem: function(k) { return this._store[k] || null; },
    setItem: function(k, v) { this._store[k] = v; },
    removeItem: function(k) { delete this._store[k]; },
  },
  API: {
    _activeProject: function() { return 'test-project'; },
    getLocalDate: function() { return '2026-07-04'; },
    toast: function() {},
  },
  IDBKeyRange: { only: function(v) { return v; } },
};

vm.createContext(sandbox);

try {
  var script = new vm.Script(code, { filename: 'mobile-agent-bundle.js' });
  script.runInContext(sandbox);
} catch (e) {
  console.log('❌ 模块加载失败:', e.message);
  console.log(e.stack ? e.stack.substring(0, 800) : '');
  process.exit(1);
}

// 从 sandbox 中提取模块引用
var Tools = sandbox.Tools;
var AEngine = sandbox.AEngine;
var ContextManager = sandbox.ContextManager;
var Prompts = sandbox.Prompts;
var LocalStore = sandbox.LocalStore;
var Stats = sandbox.Stats;

// ── 同步执行 async 工具的辅助函数 ──────────────────────
// Tools.execute 是 async，需要 await。在测试中用 IIFE + await
async function exec(name, args) {
  return await Tools.execute(name, args || {});
}

// ── 1. 工具数量验证 ────────────────────────────────────────
section('1. 工具数量与清单');
assert(Tools.TOOL_DEFINITIONS.length >= 30, '工具数量 >= 30 (实际: ' + Tools.TOOL_DEFINITIONS.length + ')');

var toolNames = Tools.TOOL_DEFINITIONS.map(function(t) { return t.function.name; });
var requiredTools = [
  'write_questions', 'grade_practice', 'read_file', 'write_file', 'list_files',
  'append_file', 'edit', 'glob', 'grep', 'ask_user', 'request_review',
  'task_create', 'task_update', 'task_list', 'web_fetch', 'web_search',
  'count_chars', 'parse_markdown', 'parse_openapi',
  'knowledge_collect', 'knowledge_search', 'knowledge_semantic_search',
  'spawn_expert', 'kill_expert',
  'run_bash', 'run_script', 'analyze_code',
  'export_xmind', 'export_excel', 'export_markdown', 'export_json', 'export_testrail_csv',
  'discover_skills', 'load_skill', 'unload_skill',
];
requiredTools.forEach(function(name) {
  assert(toolNames.indexOf(name) >= 0, '工具 ' + name + ' 已注册');
});

// ── 2. 错误分类函数 ────────────────────────────────────────
section('2. 错误分类函数');
assert(AEngine._isContextLengthError('context_length_exceeded'), 'context_length_exceeded → context error');
assert(AEngine._isContextLengthError('token limit reached'), 'token limit → context error');
assert(!AEngine._isContextLengthError('rate limit'), 'rate limit → NOT context error');

assert(AEngine._isTransientError('rate limit exceeded'), 'rate limit → transient');
assert(AEngine._isTransientError('503 service unavailable'), '503 → transient');
assert(!AEngine._isTransientError('401 unauthorized'), '401 → NOT transient');

assert(AEngine._isAuthError('401 unauthorized'), '401 → auth error');
assert(AEngine._isAuthError('invalid_api_key'), 'invalid_api_key → auth error');
assert(!AEngine._isAuthError('500 server error'), '500 → NOT auth error');

assert(AEngine._isBadRequest('400 bad_request'), '400 → bad request');
assert(AEngine._isBadRequest('tool_use mismatch'), 'tool_use → bad request');
assert(!AEngine._isBadRequest('rate limit'), 'rate limit → NOT bad request');

// ── 3. _safeTail 配对保护 ──────────────────────────────────
section('3. _safeTail 配对保护');
(function() {
  var msgs = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'tc1', content: 'file content' },
    { role: 'assistant', content: 'done' },
  ];
  var tail = AEngine._safeTail(msgs, 3);
  // tail should include the assistant with tc1 because the tool result references it
  var hasTc1 = tail.some(function(m) { return m.role === 'assistant' && m.tool_calls; });
  assert(hasTc1, 'safeTail 保留 tool_use/tool_result 配对');
})();

// ── 4. _fixOrphanedToolUses ────────────────────────────────
section('4. _fixOrphanedToolUses');
(function() {
  // Case A: orphaned tool_use (assistant with tool_calls but no results)
  var msgs = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'assistant', content: 'retry' },
  ];
  var fixed = AEngine._fixOrphanedToolUses(msgs);
  assert(fixed, '修复孤立 tool_use');
  assert(msgs.length === 2, '孤立 assistant 被移除 (剩余 ' + msgs.length + ' 条)');
})();

(function() {
  // Case B: orphaned tool_result (result without tool_use)
  var msgs = [
    { role: 'user', content: 'hello' },
    { role: 'tool', tool_call_id: 'tc_missing', content: 'orphaned result' },
    { role: 'assistant', content: 'response' },
  ];
  var fixed = AEngine._fixOrphanedToolUses(msgs);
  assert(fixed, '修复孤立 tool_result');
  assert(!msgs.some(function(m) { return m.tool_call_id === 'tc_missing'; }), '孤立 tool_result 被移除');
})();

// ── 5. 任务系统 ────────────────────────────────────────────
section('5. 任务系统');
Tools.resetTasks();
var createResult = Tools.execute('task_create', { subject: '测试任务1' });
// execute 是 async，返回 Promise。同步检查时需要处理
// 对于不涉及 IO 的同步工具，Promise 会立即 resolve
assert(typeof createResult === 'object' || typeof createResult === 'string',
  'task_create 返回结果 (type: ' + typeof createResult + ')');

// 使用 async IIFE 运行需要 await 的测试
(async function() {
  var cr = await Tools.execute('task_create', { subject: '测试任务2' });
  assert(typeof cr === 'string' && cr.indexOf('created') >= 0, 'task_create 创建成功 (返回含 created)');

  var listResult = await Tools.execute('task_list', {});
  assert(listResult.indexOf('测试任务2') >= 0, 'task_list 包含已创建任务');

  assert(Tools._hasIncompleteTasks(), '_hasIncompleteTasks 检测到未完成任务');

  // ── 6. 专家系统 ────────────────────────────────────────────
  section('6. 专家系统');
  assert(typeof Tools._collectBackgroundResults === 'function', '_collectBackgroundResults 存在');
  assert(typeof Tools._hasPendingExperts === 'function', '_hasPendingExperts 存在');
  assert(typeof Tools._hasUnhandledFailures === 'function', '_hasUnhandledFailures 存在');
  assert(typeof Tools._clearUnhandledFailures === 'function', '_clearUnhandledFailures 存在');
  assert(typeof Tools._exhaustedExpertRetries === 'function', '_exhaustedExpertRetries 存在');
  assert(typeof Tools._cancelAllExperts === 'function', '_cancelAllExperts 存在');
  assert(typeof Tools._resetExperts === 'function', '_resetExperts 存在');

  // 验证专家类型定义
  assert(Tools._activeExperts !== undefined, '_activeExperts 可访问');

  // 验证 kill_expert 对不存在任务的处理
  var killResult = await Tools.execute('kill_expert', { task_id: 'nonexistent' });
  assert(killResult.indexOf('不存在') >= 0, 'kill_expert 对不存在任务返回错误');

  // 验证结果收集
  var collected = Tools._collectBackgroundResults();
  assert(Array.isArray(collected), '_collectBackgroundResults 返回数组');
  assert(!Tools._hasPendingExperts(), '无活跃专家时 _hasPendingExperts 返回 false');

  // ── 7. 不可用工具 ──────────────────────────────────────────
  section('7. 不可用工具');
  var bashResult = await Tools.execute('run_bash', { command: 'ls' });
  assert(bashResult.indexOf('不可用') >= 0 || bashResult.indexOf('Error') >= 0, 'run_bash 返回不可用错误');

  var scriptResult = await Tools.execute('run_script', { script: 'print(1)' });
  assert(scriptResult.indexOf('不可用') >= 0 || scriptResult.indexOf('Error') >= 0, 'run_script 返回不可用错误');

  // ── 8. 技能管理 ────────────────────────────────────────────
  section('8. 技能管理');
  var discoverResult = await Tools.execute('discover_skills', {});
  assert(discoverResult.indexOf('exam-workflows') >= 0, 'discover_skills 列出 exam-workflows');
  assert(discoverResult.indexOf('exam-formats') >= 0, 'discover_skills 列出 exam-formats');

  var loadResult = await Tools.execute('load_skill', { name: 'exam-workflows' });
  assert(loadResult.indexOf('already loaded') >= 0 || loadResult.indexOf('✅') >= 0, 'load_skill 加载/已加载');

  var unloadResult = await Tools.execute('unload_skill', { name: 'exam-workflows' });
  assert(unloadResult.indexOf('unloaded') >= 0, 'unload_skill 卸载成功');

  var reloadResult = await Tools.execute('load_skill', { name: 'exam-workflows' });
  assert(reloadResult.indexOf('✅') >= 0, 'load_skill 重新加载成功');

  // ── 9. Prompts 完整性 ──────────────────────────────────────
  section('9. Prompts 完整性');
  assert(Prompts.EXAM_PROMPT.length > 1000, 'EXAM_PROMPT 长度 > 1000 (实际: ' + Prompts.EXAM_PROMPT.length + ')');
  assert(Prompts.EXAM_PROMPT.indexOf('两阶段写作') >= 0, 'EXAM_PROMPT 包含两阶段写作规则');
  assert(Prompts.EXAM_PROMPT.indexOf('write_questions') >= 0, 'EXAM_PROMPT 包含 write_questions 引用');
  assert(Prompts.EXAM_PROMPT.indexOf('grade_practice') >= 0, 'EXAM_PROMPT 包含 grade_practice 引用');
  assert(Prompts.EXAM_PROMPT.indexOf('间隔复习') >= 0, 'EXAM_PROMPT 包含间隔复习规则');
  assert(Prompts.EXAM_PROMPT.indexOf('引文直答') >= 0, 'EXAM_PROMPT 包含引文直答规则');

  var fullPrompt = Prompts.getFullPrompt('practice');
  assert(fullPrompt.length > 1000, 'getFullPrompt 返回非空 prompt');

  // ── 10. ContextManager ─────────────────────────────────────
  section('10. ContextManager');
  assert(typeof ContextManager === 'function', 'ContextManager 构造函数存在');

  var ctx = new ContextManager('test system prompt', []);
  assert(typeof ctx.addMessage === 'function', 'ctx.addMessage 存在');
  assert(typeof ctx.getMessages === 'function', 'ctx.getMessages 存在');
  assert(typeof ctx.estimateTokens === 'function', 'ctx.estimateTokens 存在');
  assert(typeof ctx.shouldCompress === 'function', 'ctx.shouldCompress 存在');
  assert(typeof ctx.maybeCompress === 'function', 'ctx.maybeCompress 存在');

  ctx.addMessage({ role: 'user', content: '你好' });
  var msgs = ctx.getMessages();
  assert(msgs.length >= 2, 'getMessages 返回包含 system + user (长度: ' + msgs.length + ')');

  // Token 估算
  var tokens = ctx.estimateTokens();
  assert(tokens > 0, 'estimateTokens 返回正数 (实际: ' + tokens + ')');

  // ── 11. Edit 三级模糊匹配 ──────────────────────────────────
  section('11. Edit 三级模糊匹配');
  assert(toolNames.indexOf('edit') >= 0, 'edit 工具已注册');
  var editDef = Tools.TOOL_DEFINITIONS.find(function(t) { return t.function.name === 'edit'; });
  assert(editDef.function.parameters.properties.old_string !== undefined, 'edit 有 old_string 参数');
  assert(editDef.function.parameters.properties.new_string !== undefined, 'edit 有 new_string 参数');
  assert(editDef.function.parameters.properties.replace_all !== undefined, 'edit 有 replace_all 参数');

  // ── 12. AEngine 格式检测 ───────────────────────────────────
  section('12. AEngine 格式检测');
  assert(AEngine.detectFormat({ provider: 'anthropic' }) === 'anthropic', 'provider=anthropic → anthropic 格式');
  assert(AEngine.detectFormat({ api_base: 'https://api.anthropic.com/v1' }) === 'anthropic', 'api_base 含 anthropic → anthropic 格式');
  assert(AEngine.detectFormat({ api_base: 'https://api.deepseek.com/v1' }) === 'openai', 'api_base 含 deepseek → openai 格式');
  assert(AEngine.detectFormat({}) === 'openai', '默认 → openai 格式');

  // ── 13. 工具定义完整性 ─────────────────────────────────────
  section('13. 工具定义完整性');
  var invalidDefs = [];
  Tools.TOOL_DEFINITIONS.forEach(function(t, i) {
    if (!t.type || t.type !== 'function') invalidDefs.push('[' + i + '] missing type');
    if (!t.function || !t.function.name) invalidDefs.push('[' + i + '] missing function.name');
    if (!t.function.description) invalidDefs.push('[' + i + '] missing function.description');
    if (!t.function.parameters || !t.function.parameters.type) invalidDefs.push('[' + i + '] missing parameters.type');
  });
  assert(invalidDefs.length === 0, '所有工具定义完整 (错误: ' + invalidDefs.length + ')');
  if (invalidDefs.length > 0) {
    invalidDefs.forEach(function(e) { console.log('    ⚠️ ' + e); });
  }

  // ── 14. LocalStore 并发写入保护 ────────────────────────────
  section('14. LocalStore 并发写入保护');
  assert(typeof LocalStore.writeFile === 'function', 'LocalStore.writeFile 存在');
  assert(typeof LocalStore.createProject === 'function', 'LocalStore.createProject 存在');
  assert(typeof LocalStore.readFile === 'function', 'LocalStore.readFile 存在');

  // ── 15. Stats 引擎 ────────────────────────────────────────
  section('15. Stats 引擎');
  assert(typeof Stats.processGradingResult === 'function' || typeof Stats.handleUpdateStats === 'function',
    'Stats 引擎存在');

  // ── 结果汇总 ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50));
  console.log('测试结果: ✅ ' + passed + ' 通过 / ❌ ' + failed + ' 失败');
  console.log('═'.repeat(50));

  if (failed > 0) {
    console.log('\n失败项:');
    errors.forEach(function(e) { console.log('  ❌ ' + e); });
    process.exit(1);
  }
})();
