// ===== 公考辅导 Mobile - 公共工具 =====
const API = {};
API.ASSET_VERSION = '20260711-style-cache-v3';

// ===== ProjectRepository — 后端主数据 + 本地离线缓存 =====
// 页面和业务工具只能经过这一层读写。LocalStore 只负责缓存与离线队列。
API.Repository = (() => {
  const REMOTE_KEY = 'zhangl-project-api-base';
  const SYNC_STATE_KEY = 'zhangl-sync-state';
  const SYNC_LOG_KEY = 'zhangl-sync-log';
  let syncing = {};

  function baseUrl() { return (localStorage.getItem(REMOTE_KEY) || '').replace(/\/$/, ''); }
  function enabled() { return !!baseUrl(); }
  function encode(value) { return encodeURIComponent(value); }
  function state(project, patch) {
    const all = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}');
    all[project] = Object.assign({ status: 'local', last_sync_at: '', error: '' }, all[project] || {}, patch || {});
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(all));
    log(project, all[project].status, all[project].error || '');
    window.dispatchEvent(new CustomEvent('project-sync-state', { detail: { project: project, state: all[project] } }));
    return all[project];
  }
  function log(project, status, message) {
    const items = JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]');
    const last = items[0];
    if (last && last.project === project && last.status === status && last.message === message && Date.now() - last.ts < 1500) return;
    items.unshift({ project: project, status: status || '', message: message || '', ts: Date.now() });
    localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(items.slice(0, 80)));
  }
  function listLog(project) {
    const items = JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]');
    return project ? items.filter(function(item) { return item.project === project; }) : items;
  }
  async function request(path, options) {
    const response = await fetch(baseUrl() + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
    if (!response.ok) throw new Error('同步服务返回 ' + response.status);
    const type = response.headers.get('content-type') || '';
    return type.indexOf('application/json') >= 0 ? response.json() : response.text();
  }
  async function requestText(path) {
    const response = await fetch(baseUrl() + path);
    if (!response.ok) throw new Error('同步服务返回 ' + response.status);
    return response.text();
  }
  function queue(project, change) {
    return LocalStore.enqueueSync(Object.assign({ project: project }, change));
  }
  async function createProject(name, config) {
    const result = await LocalStore.createProject(name, config);
    await queue(name, { type: 'create_project', config: config || {} });
    state(name, { status: enabled() ? 'pending' : 'local' });
    scheduleSync(name);
    return result;
  }
  async function writeFile(project, path, content) {
    const result = await LocalStore.writeFile(project, path, content);
    await queue(project, { type: 'write', path: path, content: String(content), idempotency_key: 'write-' + project + '-' + path + '-' + result.mtime });
    state(project, { status: enabled() ? 'pending' : 'local' });
    scheduleSync(project);
    return result;
  }
  async function deleteFile(project, path) {
    await LocalStore.deleteFile(project, path);
    await queue(project, { type: 'delete', path: path, idempotency_key: 'delete-' + project + '-' + path + '-' + Date.now() });
    state(project, { status: enabled() ? 'pending' : 'local' });
    scheduleSync(project);
  }
  async function deletePrefix(project, prefix) {
    const paths = await LocalStore.listFiles(project, prefix);
    for (const path of paths) await deleteFile(project, path);
    return paths.length;
  }
  async function sync(project) {
    if (!enabled() || syncing[project]) return false;
    syncing[project] = true;
    state(project, { status: 'syncing', error: '' });
    try {
      const changes = await LocalStore.listSyncQueue(project);
      if (changes.length) {
        const result = await request('/api/projects/' + encode(project) + '/sync', {
          method: 'POST', body: JSON.stringify({ changes: changes })
        });
        await LocalStore.removeSyncQueue((result.applied || changes).map(function(item) { return typeof item === 'string' ? item : item.id; }));
      }
      await pull(project);
      state(project, { status: 'synced', last_sync_at: new Date().toISOString(), error: '' });
      return true;
    } catch (error) {
      state(project, { status: 'pending', error: error.message || '网络不可用' });
      return false;
    } finally {
      syncing[project] = false;
    }
  }
  function scheduleSync(project) {
    if (!enabled() || !navigator.onLine) return;
    setTimeout(function() { sync(project); }, 40);
  }
  async function pull(project) {
    if (!enabled()) return false;
    const manifest = await request('/api/projects/' + encode(project) + '/sync');
    const pending = await LocalStore.listSyncQueue(project);
    const dirty = new Set(pending.filter(function(c) { return c.path; }).map(function(c) { return c.path; }));
    const localPaths = await LocalStore.listFiles(project, '');
    const remoteFiles = manifest.files || [];
    for (const file of remoteFiles) {
      if (dirty.has(file.path)) continue;
      const local = await LocalStore.getFileRecord(project, file.path);
      if (!local || local.server_mtime !== file.mtime) {
        const content = await requestText('/api/projects/' + encode(project) + '/files/' + file.path.split('/').map(encode).join('/'));
        await LocalStore.writeFile(project, file.path, content);
        await LocalStore.markFileSynced(project, file.path, file.mtime);
      }
    }
    const remotePaths = new Set(remoteFiles.map(function(file) { return file.path; }));
    for (const path of localPaths) {
      if (!dirty.has(path) && !remotePaths.has(path)) await LocalStore.deleteFile(project, path);
    }
    return true;
  }
  async function projectSummary(project) {
    const record = await LocalStore.getProject(project);
    const paths = await LocalStore.listFiles(project, '');
    let modifiedAt = record && (record.modified || record.created) || '';
    for (const path of paths) {
      const file = await LocalStore.getFileRecord(project, path);
      if (file && file.mtime && (!modifiedAt || file.mtime > modifiedAt)) modifiedAt = file.mtime;
    }
    return { name: project, file_count: paths.length, modified_at: modifiedAt };
  }
  async function importRemoteProject(project) {
    if (!enabled()) throw new Error('请先配置后端地址');
    if (!await LocalStore.getProject(project)) await LocalStore.createProject(project, {});
    await pull(project);
    state(project, { status: 'synced', last_sync_at: new Date().toISOString(), error: '' });
    window.dispatchEvent(new CustomEvent('project-list-updated'));
    return projectSummary(project);
  }
  async function replaceWithRemote(project) {
    if (!enabled()) throw new Error('请先配置后端地址');
    const paths = await LocalStore.listFiles(project, '');
    for (const path of paths) await LocalStore.deleteFile(project, path);
    const queued = await LocalStore.listSyncQueue(project);
    if (queued.length) await LocalStore.removeSyncQueue(queued.map(function(item) { return item.id; }));
    return importRemoteProject(project);
  }
  async function resolveMigration(project, strategy) {
    if (strategy === 'remote') return replaceWithRemote(project);
    if (strategy === 'later') return false;
    return sync(project);
  }
  async function listProjects() {
    if (enabled() && navigator.onLine) {
      try {
        const remote = await request('/api/projects');
        for (const item of remote || []) {
          if (!await LocalStore.getProject(item.name)) await importRemoteProject(item.name);
        }
        window.dispatchEvent(new CustomEvent('project-list-updated'));
      } catch (error) {
        // Cached projects remain available when the service cannot be reached.
      }
    }
    return LocalStore.listProjects();
  }
  async function inspectMigration() {
    const local = await LocalStore.listProjects();
    if (!enabled()) return { local: local, remote: [], conflicts: [], online: false };
    const remote = await request('/api/projects');
    const remoteNames = new Set(remote.map(function(p) { return p.name; }));
    const conflicts = [];
    for (const item of local.filter(function(p) { return remoteNames.has(p.name); })) {
      const localSummary = await projectSummary(item.name);
      const remoteSummary = remote.find(function(p) { return p.name === item.name; }) || {};
      const pending = await LocalStore.listSyncQueue(item.name);
      conflicts.push({
        name: item.name,
        local_file_count: localSummary.file_count,
        local_modified_at: localSummary.modified_at,
        remote_updated_at: remoteSummary.updated_at || '',
        pending_changes: pending.length,
      });
    }
    return { local: local, remote: remote, conflicts: conflicts, online: true };
  }
  window.addEventListener('online', function() {
    const project = API._activeProject && API._activeProject();
    if (project) sync(project);
  });
  return {
    setRemoteBase: function(url) { localStorage.setItem(REMOTE_KEY, String(url || '').replace(/\/$/, '')); },
    getRemoteBase: baseUrl,
    isRemoteEnabled: enabled,
    getSyncState: function(project) { const all = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}'); return all[project] || { status: 'local' }; },
    listSyncLog: listLog,
    getSyncDiagnostics: async function(project) {
      const queued = await LocalStore.listSyncQueue(project);
      const files = await LocalStore.listFiles(project, '');
      return {
        project: project,
        remote_base: baseUrl(),
        remote_enabled: enabled(),
        online: navigator.onLine,
        state: this.getSyncState(project),
        queued_changes: queued.length,
        file_count: files.length,
        log: listLog(project).slice(0, 20)
      };
    },
    inspectMigration: inspectMigration,
    importRemoteProject: importRemoteProject,
    resolveMigration: resolveMigration,
    getProjectSummary: projectSummary,
    createProject: createProject,
    readFile: LocalStore.readFile,
    getFileRecord: LocalStore.getFileRecord,
    writeFile: writeFile,
    deleteFile: deleteFile,
    listFiles: LocalStore.listFiles,
    listDir: LocalStore.listDir,
    deletePrefix: deletePrefix,
    listProjects: listProjects,
    getProject: LocalStore.getProject,
    deleteProject: LocalStore.deleteProject,
    listSessions: LocalStore.listSessions,
    getSession: LocalStore.getSession,
    saveSession: LocalStore.saveSession,
    deleteSession: LocalStore.deleteSession,
    clearSessions: LocalStore.clearSessions,
    exportProject: LocalStore.exportProject,
    importProject: LocalStore.importProject,
    sync: sync,
    pull: pull,
  };
})();

API.getLocalDate = (d) => {
  const date = d || new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
};

API.applyFontPreference = (label) => {
  const allowed = { '小': 'font-small', '标准': '', '大': 'font-large', '特大': 'font-xlarge' };
  const selected = allowed.hasOwnProperty(label) ? label : (localStorage.getItem(API.KEYS.font) || '标准');
  const cls = allowed[selected] || '';
  if (document.body) {
    document.body.classList.remove('font-small', 'font-large', 'font-xlarge');
    if (cls) document.body.classList.add(cls);
    document.body.style.zoom = '';
  }
  if (document.documentElement) document.documentElement.style.zoom = '';
  localStorage.setItem(API.KEYS.font, selected);
  localStorage.removeItem('zhangl-zoom');
  return selected;
};

API.applyThemePreference = function(theme) {
  var selected = theme || localStorage.getItem(API.KEYS.theme) || 'light';
  var light = selected !== 'dark';
  if (document.documentElement) document.documentElement.classList.toggle('light', light);
  if (document.body) document.body.classList.toggle('light', light);
  return selected;
};

// Resolve the "current practice date" — today, unless a historical date override was set
// (e.g. opening an essay from history sets 'es-date'). Pages should prefer this over
// getLocalDate() when they want to honor a date override (audit: es-date was written but never read).
API.getActiveDate = () => {
  return localStorage.getItem('es-date') || API.getLocalDate();
};

// User-configured APIs are HTTPS by default. Plain HTTP is restricted to
// loopback development servers so the JavaScript validation matches iOS ATS.
API.isAllowedApiBase = function(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].indexOf(url.hostname) >= 0;
  } catch (error) {
    return false;
  }
};

API.projPath = (path) => {
  // Kept for backward compat — some pages still use this to construct paths.
  // No longer calls the server; just returns the relative path.
  return path;
};

// ── Active project helper ──────────────────────────────────────
API._activeProject = () => localStorage.getItem('zhangl-active-project') || '公考练习';

// Aggregate a module's KP-level data into module-level stats.
// 能力画像.json stores modules[module][kpName] = {attempts, correct, accuracy, ...} (KP-level),
// but pages often need module-level totals. This walks the KP children and sums them.
API.moduleStats = function(profile, modName) {
  if (!profile || !profile.modules) return { total: 0, correct: 0, accuracy: 0 };
  var mod = profile.modules[modName];
  if (!mod || typeof mod !== 'object') return { total: 0, correct: 0, accuracy: 0 };
  var total = 0, correct = 0;
  Object.values(mod).forEach(function(kp) {
    if (kp && typeof kp === 'object' && !Array.isArray(kp)) {
      total += kp.attempts || 0;
      correct += kp.correct || 0;
    }
  });
  return { total: total, correct: correct, accuracy: total > 0 ? Math.round(correct / total * 100) : 0 };
};

API.toast = (msg, duration) => {
  const el = document.createElement('div'); el.className = 'toast';
  el.textContent = msg;
  el.style.maxWidth = '90vw';
  el.style.wordBreak = 'break-all';
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.4';
  el.style.cursor = 'pointer';
  el.title = '点击复制';
  el.onclick = () => { API.copyText(msg).then(() => { el.textContent = '✓ 已复制'; setTimeout(() => el.remove(), 800); }).catch(() => {}); };
  document.body.appendChild(el);
  const ms = duration || 2100;
  if (ms > 0) setTimeout(() => el.remove(), ms);
};

API.copyText = function(text) {
  var value = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(value).catch(function() {
      return API._copyTextFallback(value);
    });
  }
  return API._copyTextFallback(value);
};

API._copyTextFallback = function(text) {
  return new Promise(function(resolve, reject) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy command failed'));
    } catch(e) {
      reject(e);
    }
  });
};

// Shared loading — set innerHTML of a container to a unified spinner card
API.showLoading = (container, msg) => {
  if (!container) return;
  container.innerHTML = '<div style="background:var(--surface);border-radius:16px;padding:36px 28px;box-shadow:var(--card-shadow);text-align:center;width:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh">'+
    '<button onclick="API._aiStop()" style="position:absolute;top:10px;right:10px;width:28px;height:28px;border:none;border-radius:50%;background:var(--surface2);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;font-family:inherit;line-height:1">✕</button>'+
    '<div style="width:52px;height:52px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 18px">'+
      '<i data-lucide="loader" style="width:26px;height:26px;color:var(--accent);animation:spin 1s linear infinite"></i>'+
    '</div>'+
    '<div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px">'+(msg||'AI 正在生成...')+'</div>'+
    '<div style="font-size:13px;color:var(--text-secondary)">请耐心等待</div>'+
  '</div>';
  lucide.createIcons();
};

API.pageError = function(scope, err, userMessage) {
  var msg = userMessage || '页面加载失败，请稍后重试';
  try { console.warn('[' + scope + ']', err); } catch(e) {}
  API.toast(msg, 3200);
};

API.showInlineError = function(container, title, detail, retryCode) {
  if (!container) return;
  container.innerHTML = '<div style="background:var(--surface);border-radius:12px;padding:18px 14px;text-align:center;color:var(--text-secondary);font-size:13px;line-height:1.5;box-shadow:var(--card-shadow)">'+
    '<i data-lucide="alert-circle" style="width:24px;height:24px;color:var(--orange);display:block;margin:0 auto 8px"></i>'+
    '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">'+API._esc(title || '加载失败')+'</div>'+
    '<div>'+API._esc(detail || '请稍后重试')+'</div>'+
    (retryCode ? '<button onclick="'+API._esc(retryCode)+'" style="margin-top:12px;height:34px;padding:0 14px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">重试</button>' : '')+
    '</div>';
  lucide.createIcons();
};

API.confirmDanger = function(title, message, expectedText, onConfirm) {
  var expected = String(expectedText || '');
  var o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
  o.innerHTML = '<div style="background:var(--surface);border-radius:14px;padding:24px;width:88%;max-width:340px" onclick="event.stopPropagation()">'+
    '<h3 style="font-size:17px;margin-bottom:10px;color:var(--red)">'+API._esc(title)+'</h3>'+
    '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px">'+API._esc(message)+'</p>'+
    '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">输入「'+API._esc(expected)+'」确认</div>'+
    '<input id="api-danger-input" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box;font-family:inherit" autocomplete="off">'+
    '<div style="display:flex;gap:8px;margin-top:16px">'+
      '<button id="api-danger-cancel" style="flex:1;height:42px;border:none;border-radius:10px;background:var(--surface2);color:var(--text-secondary);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">取消</button>'+
      '<button id="api-danger-ok" disabled style="flex:1;height:42px;border:none;border-radius:10px;background:var(--red);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;opacity:.45">确认</button>'+
    '</div></div>';
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  var input = o.querySelector('#api-danger-input');
  var okBtn = o.querySelector('#api-danger-ok');
  input.addEventListener('input', function() {
    var ok = input.value === expected;
    okBtn.disabled = !ok;
    okBtn.style.opacity = ok ? '1' : '.45';
  });
  o.querySelector('#api-danger-cancel').onclick = function() { o.remove(); };
  okBtn.onclick = function() { if (!okBtn.disabled) { o.remove(); onConfirm && onConfirm(); } };
  setTimeout(function(){ input.focus(); }, 50);
};

// ── Shared UI primitives ─────────────────────────────────────────
// Small DOM helpers for new code paths. Legacy pages can migrate gradually
// without changing their existing inline handlers in one large rewrite.
API.UI = (() => {
  function closeAll(selector) {
    document.querySelectorAll(selector || '.modal-overlay,.sheet-overlay').forEach(function(el) { el.remove(); });
  }
  function modal(options) {
    options = options || {};
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = options.zIndex || 10010;
    var card = document.createElement('div');
    card.className = 'modal-card';
    if (options.maxWidth) card.style.maxWidth = options.maxWidth;
    card.innerHTML = (options.title ? '<h3>' + API._esc(options.title) + '</h3>' : '') + (options.body || '');
    overlay.appendChild(card);
    if (options.dismiss !== false) overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();
    return overlay;
  }
  function sheet(options) {
    options = options || {};
    var overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.style.zIndex = options.zIndex || 10001;
    overlay.innerHTML = '<div class="sheet-card" style="' + (options.maxWidth ? 'max-width:' + options.maxWidth : '') + '">' +
      (options.title ? '<div class="sheet-title">' + API._esc(options.title) + '</div>' : '') +
      (options.body || '') +
      '</div>';
    if (options.dismiss !== false) overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();
    return overlay;
  }
  return { modal: modal, sheet: sheet, closeAll: closeAll };
})();

// Shared project creation modal — used by home + profile
API.showNewProject = function(force) {
  // Remove any existing
  var ex = document.getElementById('np-overlay'); if (ex) ex.remove();
  var o = document.createElement('div'); o.id = 'np-overlay';
  o.className = 'modal-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
  var cancelBtn = '<button style="flex:1;height:40px;border:none;border-radius:10px;background:var(--surface2);color:var(--text-secondary);font-size:14px;cursor:pointer;font-family:inherit" onclick="document.getElementById(\'np-overlay\').remove()">'+(force?'稍后再说':'取消')+'</button>';
  o.innerHTML = '<div style="background:var(--surface);border-radius:14px;padding:24px;width:90%;max-width:360px;max-height:90vh;overflow-y:auto">'+
    (force ? '<div style="text-align:center;margin-bottom:16px"><div style="width:48px;height:48px;border-radius:50%;background:var(--accent-soft);display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px"><i data-lucide="graduation-cap" style="width:24px;height:24px;color:var(--accent)"></i></div><div style="font-size:18px;font-weight:700;color:var(--text)">开始你的备考之旅</div><div style="font-size:13px;color:var(--text-secondary);margin-top:4px">创建备考计划，AI 将为你量身定制学习方案</div></div>' : '<h3 style="font-size:17px;margin-bottom:12px">新建备考计划</h3>')+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;margin-top:8px">计划名称</div><input id="np-name" placeholder="例如：2026国考备考" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box">'+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">考试类型</div><select id="np-type" onchange="document.getElementById(\'np-province-wrap\').style.display=this.value===\'省考\'?\'\':\'none\'" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;background:var(--surface);color:var(--text);font-family:inherit"><option value="国考">国考（副省/地市/行政执法）</option><option value="省考">省考</option><option value="选调">选调生</option><option value="事业编">事业单位</option></select>'+
    '<div id="np-province-wrap" style="display:none"><div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">省份</div><select id="np-province" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;background:var(--surface);color:var(--text);font-family:inherit"><option value="">选择省份</option><option>北京</option><option>上海</option><option>广东</option><option>江苏</option><option>浙江</option><option>山东</option><option>河南</option><option>四川</option><option>湖北</option></select></div>'+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">考试日期</div><input id="np-exam-date" type="date" style="width:100%;max-width:100%;min-width:0;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box;color-scheme:normal" onclick="this.showPicker&&this.showPicker()">'+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">题量偏好</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px" id="np-counts">'+
    ['135','120','100','90','60'].map(function(n,i){return '<button style="flex:1;height:36px;border:none;border-radius:18px;background:'+(i===1?'var(--surface);box-shadow:0 1px 3px rgba(0,0,0,.08)':'var(--surface2)')+';color:'+(i===1?'var(--accent)':'var(--text-secondary)')+';font-size:12px;cursor:pointer;font-family:inherit;font-weight:'+(i===1?'600':'400')+'" class="np-count-btn'+(i===1?' active':'')+'" data-n="'+n+'" onclick="var btns=this.parentElement.querySelectorAll(\'.np-count-btn\');btns.forEach(function(b){b.classList.remove(\'active\');b.style.background=\'var(--surface2)\';b.style.boxShadow=\'none\';b.style.color=\'var(--text-secondary)\';b.style.fontWeight=\'400\'});this.classList.add(\'active\');this.style.background=\'var(--surface)\';this.style.boxShadow=\'0 1px 3px rgba(0,0,0,.08)\';this.style.color=\'var(--accent)\';this.style.fontWeight=\'600\'">'+n+'题</button>'}).join('')+
    '</div>'+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">目标岗位 <span style="color:var(--text-secondary);font-size:11px">（可选）</span></div><input id="np-position" placeholder="例如：税务、海关、公安" style="width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box">'+
    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">备考目标 <span style="color:var(--text-secondary);font-size:11px">（可选）</span></div><textarea id="np-req" placeholder="例如：每天练习2小时，重点突破资料分析..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;font-family:inherit;background:var(--surface);color:var(--text);min-height:60px;box-sizing:border-box"></textarea>'+
    '<div style="display:flex;gap:8px;margin-top:16px">'+cancelBtn+'<button style="flex:1;height:40px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit" onclick="API.createProject(this)">创建计划</button></div></div>';
  if (!force) o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  lucide.createIcons();
};

API.createProject = async function(btn) {
  var p = document.getElementById('np-overlay');
  var name = p.querySelector('#np-name').value.trim();
  var type = p.querySelector('#np-type').value;
  var province = p.querySelector('#np-province')?.value || '';
  var examDate = p.querySelector('#np-exam-date').value;
  var position = p.querySelector('#np-position').value.trim();
  var req = p.querySelector('#np-req').value.trim();
  var countEl = p.querySelector('.np-count-btn.active') || p.querySelector('.np-count-btn[style*="accent"]') || p.querySelectorAll('.np-count-btn')[1];
  var count = countEl ? parseInt(countEl.dataset.n) : 120;
  if (!name) { API.toast('请输入计划名称'); return; }
  // Re-entry guard: disable button during async create
  if (btn) { btn.disabled = true; var orig = btn.textContent; btn.textContent = '创建中...'; }
  try {
    await API.Repository.createProject(name, {
      exam_date: examDate,
      exam_name: province ? (province+type) : type,
      exam_type: type, province: province,
      mock_exam_count: count, position: position, requirements: req,
      business_model: API.Business.createTargetModel({
        exam_date: examDate,
        exam_name: province ? (province+type) : type,
        exam_type: type,
        province: province,
        mock_exam_count: count,
        position: position,
        requirements: req
      })
    });
    API.toast('创建成功');
    document.getElementById('np-overlay').remove();
    localStorage.setItem('zhangl-active-project', name);
    // Force reload home tab to show content instead of empty state
    API._tabLoaded['home'] = false;
    API._loadTabRoot('home');
    // Also reload wrongbook tab in case it was showing empty
    API._tabLoaded['wrongbook'] = false;
    API._loadTabRoot('wrongbook');
  } catch(e) {
    API.toast('创建失败');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
};

// ── localStorage key conventions ──────────────────────────────────
// zhangl-*        System settings (theme, font, AI config)
// mp-*            Practice-card state (module, mode, date, answers)
// p-*             Generation state (generating flag, timer, submitted)
// es-*            Essay state (date, topic, draft)
// aic-*           AI bubble state (session, position)
// zhangl-task-*   Task notification history (per-project)
// zhangl-exam-*   Exam/plan state (exam date)
API.KEYS = {
  activeProject: 'zhangl-active-project',
  examDate: 'zhangl-exam-date',
  theme: 'zhangl-theme',
  font: 'zhangl-font-size',
  aiConfig: 'zhangl-ai-config',
  taskHistory: function() { return 'zhangl-task-' + (localStorage.getItem('zhangl-active-project') || '公考练习'); }
};

// ── Business schema registry ─────────────────────────────────────
// Centralizes version markers for durable project files. Existing pages still
// accept legacy files; new writers can call API.Schema.normalize before save
// and migrations can be added here without scanning every page script.
API.Schema = (() => {
  var definitions = {
    '备考计划.json': { version: 1, root: 'plan' },
    '能力画像.json': { version: 2, root: 'profile' },
    '申论画像.json': { version: 1, root: 'essay_profile' },
    '面试画像.json': { version: 1, root: 'interview_profile' },
    '练习统计.json': { version: 1, root: 'practice_stats' },
    '题目元数据.json': { version: 1, root: 'question_meta' },
    '评分记录.json': { version: 1, root: 'score_records' },
    '学习事件.json': { version: 1, root: 'learning_events' },
    '学习事务.json': { version: 1, root: 'learning_tx' },
    '复习项目.json': { version: 1, root: 'review_items' },
    '复习队列.json': { version: 2, root: 'review_queue' }
  };

  function definition(path) {
    return definitions[path] || null;
  }
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value || {})); } catch(e) { return {}; }
  }
  function normalize(path, data) {
    var def = definition(path);
    if (!def || !data || typeof data !== 'object' || Array.isArray(data)) return data;
    var next = clone(data);
    next.schema = next.schema || {};
    next.schema.name = def.root;
    next.schema.version = Math.max(Number(next.schema.version || 0), def.version);
    next.schema.updated_at = new Date().toISOString();
    return next;
  }
  function version(path, data) {
    if (data && data.schema && data.schema.version) return Number(data.schema.version) || 0;
    var def = definition(path);
    return def ? 0 : -1;
  }
  function needsMigration(path, data) {
    var def = definition(path);
    return !!def && version(path, data) < def.version;
  }
  function migrate(path, data) {
    // Current migrations are metadata-only. Structural migrations should be
    // added here per file path so pages do not grow one-off fallback code.
    return normalize(path, data);
  }
  return { definitions: definitions, definition: definition, normalize: normalize, version: version, needsMigration: needsMigration, migrate: migrate };
})();

// AI credentials live in the iOS Keychain when the native bridge is available.
// Browser builds retain localStorage only as a development fallback.
API.SecureConfig = (() => {
  const storageKey = API.KEYS.aiConfig;
  let cached = {};
  function parse(value) {
    try { return value ? JSON.parse(value) : {}; } catch (error) { return {}; }
  }
  function plugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keychain;
  }
  async function load() {
    const nativePlugin = plugin();
    if (nativePlugin) {
      const result = await nativePlugin.get({ key: storageKey });
      cached = parse(result && result.value);
      if (!Object.keys(cached).length) {
        const legacy = parse(localStorage.getItem(storageKey));
        if (Object.keys(legacy).length) {
          await nativePlugin.set({ key: storageKey, value: JSON.stringify(legacy) });
          cached = legacy;
        }
      }
      localStorage.removeItem(storageKey);
      return cached;
    }
    cached = parse(localStorage.getItem(storageKey));
    return cached;
  }
  async function save(config) {
    cached = config || {};
    const serialized = JSON.stringify(cached);
    const nativePlugin = plugin();
    if (nativePlugin) {
      await nativePlugin.set({ key: storageKey, value: serialized });
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, serialized);
  }
  return { load: load, save: save, current: function() { return cached; }, isNative: function() { return !!plugin(); } };
})();
API.SecureConfig.load().catch(function(error) { console.warn('[secure-config]', error); });

API.LearningNotifications = (() => {
  function plugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LearningNotifications; }
  function nextAt(hour, dateString) {
    const base = dateString ? new Date(dateString + 'T00:00:00') : new Date();
    base.setHours(hour, 0, 0, 0);
    if (!dateString && base <= new Date()) base.setDate(base.getDate() + 1);
    return base.toISOString();
  }
  function route(route) {
    const target = String(route || 'home').replace(/^#/, '');
    if (['home', 'practice', 'exam', 'wrongbook', 'profile'].indexOf(target) >= 0) API.switchTab(target);
    else if (target === 'plan') API.pushPage('plan');
    else API.switchTab('home');
  }
  async function refresh() {
    const nativePlugin = plugin();
    if (!nativePlugin) return false;
    const plan = await API.fetchJSON('备考计划.json') || {};
    const today = API.getLocalDate();
    const todayItems = plan.tasks && plan.tasks[today] && plan.tasks[today].items || [];
    const due = await API.Index.reviewDue({ dueOnly: true, limit: 1 });
    const events = await API.Index.learningEvents({ date: today, limit: 1 });
    const items = [];
    if (todayItems.some(function(item) { return item && !item.done; })) items.push({ id: 'today-plan-' + today, title: '今日学习计划', body: '完成今天的重点训练，稳步推进备考进度。', at: nextAt(9), route: 'plan' });
    if (due.length) items.push({ id: 'review-due-' + today, title: '错题复习到期', body: '有到期错题等待复习，建议先处理高优先级项目。', at: nextAt(19), route: 'wrongbook' });
    if (!events.length) items.push({ id: 'study-streak-' + today, title: '今天还没学习', body: '用一组针对性练习保持学习节奏。', at: nextAt(20), route: 'practice' });
    const mockTask = Object.keys(plan.tasks || {}).sort().slice(0, 14).map(function(date) {
      return { date: date, item: (plan.tasks[date].items || []).find(function(item) { return item && item.type === 'mock' && !item.done; }) };
    }).find(function(entry) { return entry.item && entry.date >= today; });
    if (mockTask) items.push({ id: 'mock-plan-' + mockTask.date, title: '模考计划提醒', body: '预留完整时间完成模拟考试和复盘。', at: nextAt(9, mockTask.date), route: 'exam' });
    await nativePlugin.schedule({ items: items.slice(0, 4) });
    return true;
  }
  async function enable() {
    const nativePlugin = plugin();
    if (!nativePlugin) return false;
    const result = await nativePlugin.requestPermission();
    if (!result || !result.granted) return false;
    await refresh();
    return true;
  }
  async function status() {
    const nativePlugin = plugin();
    if (!nativePlugin || !nativePlugin.getStatus) return { native: false, authorization: 'unavailable', pending: 0 };
    return nativePlugin.getStatus();
  }
  async function clear() {
    const nativePlugin = plugin();
    if (!nativePlugin || !nativePlugin.clearAll) return false;
    await nativePlugin.clearAll();
    return true;
  }
  async function consumePendingRoute() {
    const nativePlugin = plugin();
    if (!nativePlugin) return;
    const result = await nativePlugin.consumePendingRoute();
    if (result && result.route) route(result.route);
  }
  window.addEventListener('study-notification-open', function(event) { route(event && event.detail); });
  return { enable: enable, refresh: refresh, status: status, clear: clear, consumePendingRoute: consumePendingRoute, isNative: function() { return !!plugin(); } };
})();

// Shared constants — single source of truth
API.XC_MODULES = ['资料分析','判断推理','言语理解','数量关系','常识判断'];
API.SL_MODULES = ['归纳概括','综合分析','提出对策','贯彻执行','申发论述'];
API.PROVINCES = ['北京','上海','广东','江苏','浙江','山东','河南','四川','湖北','湖南','河北','福建','安徽','辽宁','陕西','重庆','江西','广西','云南','贵州','山西','吉林','甘肃','内蒙古','新疆','海南','宁夏','青海','西藏','黑龙江'];
API.mockExamId = function(subject, date) { return (subject || '行测') + '-' + date; };
API.mockExamPath = function(subject, date) { return '练习/模拟考试/' + (subject || '行测') + '/' + date + '.md'; };
API.legacyMockExamPath = function(date) { return '练习/模拟考试/' + date + '.md'; };

API.fetchJSON = async (path) => {
  try { const content = await API.Repository.readFile(API._activeProject(), path); if (content === null) return null; return JSON.parse(content); } catch (e) { return null; }
};

API.fetchText = async (path) => {
  try { return await API.Repository.readFile(API._activeProject(), path); } catch (e) { return null; }
};

// Write a file to the active project's local store
API.writeFile = async (path, content) => {
  if (/\.json$/.test(path) && API.Schema && API.Schema.definition(path)) {
    try {
      var parsed = typeof content === 'string' ? JSON.parse(content) : content;
      content = JSON.stringify(API.Schema.migrate(path, parsed));
    } catch(e) {
      // Keep legacy/raw content when a caller intentionally writes non-JSON text.
    }
  }
  return API.Repository.writeFile(API._activeProject(), path, content);
};

// Delete a file from the active project's local store
API.deleteFile = async (path) => {
  return API.Repository.deleteFile(API._activeProject(), path);
};

// List files under a prefix in the active project
// Returns string[] of full paths
API.listFiles = async (prefix) => {
  return API.Repository.listFiles(API._activeProject(), prefix);
};

// List directory entries (one level) under a prefix
// Returns string[] like ["练习/判断推理/", "练习/资料分析/"]
API.listDir = async (prefix) => {
  return API.Repository.listDir(API._activeProject(), prefix);
};

// Delete all files under a prefix
API.deletePrefix = async (prefix) => {
  return API.Repository.deletePrefix(API._activeProject(), prefix);
};

// ===== Structured business indexes =====
// These are projections of durable business files. New data is written by Tools,
// while pages query this layer first and only scan legacy files as a compatibility fallback.
API.Index = (() => {
  async function read(path, fallback) {
    const data = await API.fetchJSON(path);
    return data && typeof data === 'object' ? data : fallback;
  }
  async function practice(options) {
    options = options || {};
    const meta = await read('题目元数据.json', { files: {} });
    const records = Object.keys(meta.files || {}).map(function(path) {
      const item = meta.files[path] || {};
      return {
        id: path,
        path: path,
        module: item.module || '',
        date: item.date || '',
        question_count: (item.question_ids || []).length,
        updated_at: item.updated_at || '',
        is_mock: path.indexOf('练习/模拟考试/') === 0,
      };
    }).filter(function(item) {
      return !options.module || item.module === options.module;
    }).sort(function(a, b) { return (b.date + b.path).localeCompare(a.date + a.path); });
    return options.limit ? records.slice(0, options.limit) : records;
  }
  async function mocks(subject) {
    const records = await practice({});
    return records.filter(function(item) {
      return item.is_mock && (!subject || item.path.indexOf('练习/模拟考试/' + subject + '/') === 0);
    });
  }
  function normalizeDailyRecord(date, data) {
    const record = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : {};
    record.date = date;
    record.path = '每日完成/' + date + '.json';
    return record;
  }
  async function buildDailyCompletionIndex() {
    const records = {};
    try {
      const paths = await API.listFiles('每日完成/');
      for (const path of (paths || [])) {
        const name = String(path || '').split('/').pop();
        if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
        const date = name.replace('.json', '');
        try {
          const data = await API.fetchJSON('每日完成/' + name);
          if (data) records[date] = normalizeDailyRecord(date, data);
        } catch(e) {}
      }
    } catch(e) {}
    const index = { version: 1, updated_at: new Date().toISOString(), built_at: new Date().toISOString(), records: records };
    try {
      await API.Repository.writeFile(API._activeProject(), '索引/每日完成索引.json', JSON.stringify(index, null, 2));
    } catch(e) { console.warn('[daily completion index write]', e); }
    return index;
  }
  async function dailyCompletions(options) {
    options = options || {};
    let index = await read('索引/每日完成索引.json', null);
    if (!index || !index.built_at) index = await buildDailyCompletionIndex();
    let rows = Object.keys((index && index.records) || {}).map(function(date) {
      return normalizeDailyRecord(date, index.records[date]);
    }).filter(function(item) {
      return (!options.date || item.date === options.date) && (!options.month || item.date.indexOf(options.month) === 0);
    }).sort(function(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return options.limit ? rows.slice(0, options.limit) : rows;
  }
  function wrongBookItemId(item) {
    return ['wb', item.module || '', item.date || '', item.qNum || item.q || '', item.file || item.file_path || ''].join('|');
  }
  function normalizeWrongBookItem(item) {
    const src = item || {};
    const normalized = {
      id: src.id || wrongBookItemId(src),
      qNum: src.qNum || src.q || '',
      module: src.module || '',
      subType: src.subType || src.knowledge_point || '',
      date: src.date || '',
      stem: src.stem || src.question || '',
      summary: src.summary || '',
      correctAns: src.correctAns || src.correct_answer || '',
      wrongAns: src.wrongAns || src.your_answer || src.user_answer || '',
      reason: src.reason || src.error_type || src.error_detail || src.error_analysis || '',
      analysis: src.analysis || src.fix || src.correct_approach || '',
      fix: src.fix || src.correct_approach || '',
      tips: src.tips || '',
      fullText: src.fullText || src.full_text || '',
      rawBlock: src.rawBlock || src.raw_block || '',
      seeRef: src.seeRef || null,
      file: src.file || src.file_path || ''
    };
    if (!normalized.summary) normalized.summary = (normalized.stem || normalized.fullText || '').substring(0, 80);
    if (!normalized.seeRef && normalized.file) normalized.seeRef = { file: normalized.file, qNum: normalized.qNum };
    normalized.id = normalized.id || wrongBookItemId(normalized);
    return normalized;
  }
  function parseWrongBookText(text, moduleName) {
    const items = [];
    const sections = String(text || '').split(/\n(?=###\s+Q\d+)/);
    sections.forEach(function(sec) {
      const h = sec.match(/^###\s+(Q\d+)\s*[|｜]\s*(.+?)\s*[|｜]\s*(\d{4}-\d{2}-\d{2})/m);
      if (!h) return;
      const qNum = h[1], subType = h[2].trim(), date = h[3];
      const body = sec.slice(h[0].length);
      const seeMatch = body.match(/@see\s+(\S+\.md)\s*(Q\d+)?/);
      const seeRef = seeMatch ? { file: seeMatch[1], qNum: seeMatch[2] || qNum } : null;
      const pick = function(re) { const m = body.match(re); return m ? m[1].trim() : ''; };
      const stem = pick(/\*\*原题[：:]\*\*\s*([\s\S]*?)(?=\n@see|\n\*\*你的答案|\n\*\*正确答案|$)/);
      const wrongAns = pick(/\*\*你的答案[：:]\*\*\s*(.+?)(?:\n|$)/);
      const correctAns = pick(/\*\*正确答案[：:]\*\*\s*(.+?)(?:\n|$)/);
      const reason = pick(/\*\*错因[：:]\*\*\s*([\s\S]*?)(?=\n\*\*正解|\n\*\*技巧|$)/);
      const fix = pick(/\*\*正解[：:]\*\*\s*([\s\S]*?)(?=\n\*\*技巧|$)/);
      const tips = pick(/\*\*技巧[：:]\*\*\s*([\s\S]*?)$/);
      const cleanText = stem.replace(/^\*\*\d+\.\*\*\s*(?:（[^）]*）\s*)?/, '').trim();
      const item = normalizeWrongBookItem({
        qNum: qNum,
        module: moduleName,
        subType: subType,
        date: date,
        stem: stem,
        summary: cleanText.length > 5 ? cleanText.substring(0, 80) : (seeRef ? '查看原题' : stem.substring(0, 80)),
        correctAns: (correctAns.match(/^[A-D]/) || [correctAns])[0],
        wrongAns: (wrongAns.match(/^[A-D]/) || [wrongAns])[0],
        reason: reason,
        analysis: fix,
        fix: fix,
        tips: tips,
        fullText: body,
        seeRef: seeRef,
        file: seeRef ? seeRef.file : '',
        rawBlock: sec.trim()
      });
      items.push(item);
    });
    return items;
  }
  async function buildWrongBookIndex() {
    let items = [];
    const modules = (API.XC_MODULES || []).concat(['申论']);
    const seen = {};
    for (const mod of modules) {
      try {
        const text = await API.fetchText('错题本/' + mod + '.md');
        if (!text || !text.trim() || text.indexOf('*暂无错题记录*') >= 0) continue;
        parseWrongBookText(text, mod).forEach(function(item) {
          if (!seen[item.id]) { seen[item.id] = true; items.push(item); }
        });
      } catch(e) {}
    }
    if (items.length === 0) {
      try {
        const paths = await API.listFiles('错题本/');
        for (const path of (paths || []).filter(function(p) { return String(p).endsWith('.md'); }).slice(0, 50)) {
          const name = String(path).split('/').pop();
          const modGuess = modules.find(function(m) { return name.indexOf(m) >= 0; }) || name.replace(/\.md$/, '');
          try {
            const text = await API.fetchText('错题本/' + name);
            parseWrongBookText(text, modGuess).forEach(function(item) {
              if (!seen[item.id]) { seen[item.id] = true; items.push(item); }
            });
          } catch(e) {}
        }
      } catch(e) {}
    }
    const index = { version: 1, updated_at: new Date().toISOString(), built_at: new Date().toISOString(), items: items };
    try {
      await API.Repository.writeFile(API._activeProject(), '索引/错题索引.json', JSON.stringify(index, null, 2));
    } catch(e) { console.warn('[wrongbook index write]', e); }
    return index;
  }
  async function wrongBookItems(options) {
    options = options || {};
    let index = await read('索引/错题索引.json', null);
    if (!index || !index.built_at) index = await buildWrongBookIndex();
    let rows = ((index && index.items) || []).map(normalizeWrongBookItem).filter(function(item) {
      return (!options.module || item.module === options.module) && (!options.date || item.date === options.date);
    }).sort(function(a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || String(a.module || '').localeCompare(String(b.module || ''));
    });
    return options.limit ? rows.slice(0, options.limit) : rows;
  }
  async function reviewDue(options) {
    options = options || {};
    const data = await read('复习项目.json', { items: [] });
    const date = options.date || API.getLocalDate();
    const items = (data.items || []).filter(function(item) {
      if (!item || item.status === 'mastered') return false;
      if (options.dueOnly && item.next_review && item.next_review > date) return false;
      return !options.module || item.module === options.module;
    }).sort(function(a, b) {
      return String(a.next_review || '').localeCompare(String(b.next_review || '')) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    return options.limit ? items.slice(0, options.limit) : items;
  }
  async function wrongItems(options) { return reviewDue(options); }
  async function learningEvents(options) {
    options = options || {};
    const data = await read('学习事件.json', { events: [] });
    const events = (data.events || []).filter(function(item) {
      return item && (!options.module || item.module === options.module) && (!options.date || item.date === options.date);
    }).sort(function(a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    return options.limit ? events.slice(0, options.limit) : events;
  }
  return { practice: practice, mocks: mocks, dailyCompletions: dailyCompletions, wrongBookItems: wrongBookItems, wrongItems: wrongItems, reviewDue: reviewDue, learningEvents: learningEvents };
})();

// Unified confirm dialog (replaces unreliable native confirm in WebView)
API.confirm = (title, message, onConfirm, onCancel) => {
  var o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
  o.innerHTML = '<div style="background:var(--surface);border-radius:14px;padding:24px;width:85%;max-width:320px">'+
    '<h3 style="font-size:17px;margin-bottom:10px">'+API._esc(title)+'</h3>'+
    '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:18px">'+API._esc(message)+'</p>'+
    '<div style="display:flex;gap:8px">'+
      '<button id="api-confirm-cancel" style="flex:1;height:42px;border:none;border-radius:10px;background:var(--bg);color:var(--text-secondary);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">取消</button>'+
      '<button id="api-confirm-ok" style="flex:1;height:42px;border:none;border-radius:10px;background:var(--red);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">确认</button>'+
    '</div></div>';
  o.addEventListener('click', function(e) { if (e.target === o) { o.remove(); if (onCancel) onCancel(); } });
  document.body.appendChild(o);
  o.querySelector('#api-confirm-cancel').onclick = function() { o.remove(); if (onCancel) onCancel(); };
  o.querySelector('#api-confirm-ok').onclick = function() { o.remove(); if (onConfirm) onConfirm(); };
};

// Unified date picker (year/month/day selects, avoids iOS date input overflow)
API.datePicker = function(title, curDate, onSave) {
  var y=curDate?parseInt(curDate.substring(0,4)):2027, m=curDate?parseInt(curDate.substring(5,7)):1, d=curDate?parseInt(curDate.substring(8,10)):1;
  var yOpts='';
  for(var i=2026;i<=2028;i++) yOpts+='<option value="'+i+'"'+(i===y?' selected':'')+'>'+i+'年</option>';
  var o=document.createElement('div');
  o.id='api-dp-overlay';
  o.className='modal-overlay';
  o.style.cssText='position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
  o.innerHTML='<div style="background:var(--surface);border-radius:14px;padding:24px;width:85%;max-width:320px" onclick="event.stopPropagation()">'+
    '<h3 style="font-size:17px;margin-bottom:14px">'+API._esc(title||'选择日期')+'</h3>'+
    '<div style="display:flex;gap:6px;margin-bottom:16px">'+
      '<select id="api-dp-y" style="flex:1;height:42px;padding:0 8px;border:1px solid var(--border);border-radius:10px;font-size:15px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box">'+yOpts+'</select>'+
      '<select id="api-dp-m" style="flex:1;height:42px;padding:0 8px;border:1px solid var(--border);border-radius:10px;font-size:15px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box"></select>'+
      '<select id="api-dp-d" style="flex:1;height:42px;padding:0 8px;border:1px solid var(--border);border-radius:10px;font-size:15px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box"></select>'+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
      '<button style="flex:1;height:42px;border:none;border-radius:10px;background:var(--surface2);color:var(--text-secondary);font-size:14px;cursor:pointer;font-family:inherit" onclick="document.getElementById(\'api-dp-overlay\').remove()">取消</button>'+
      '<button id="api-dp-ok" style="flex:1;height:42px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">保存</button>'+
    '</div></div>';
  o.addEventListener('click',function(e){if(e.target===o)o.remove();});
  document.body.appendChild(o);

  // Dynamic day options based on year/month — prevents invalid dates like Feb 30
  function updateDays() {
    var selY = parseInt(o.querySelector('#api-dp-y').value);
    var selM = parseInt(o.querySelector('#api-dp-m').value);
    var daysInMonth = new Date(selY, selM, 0).getDate();
    var daySel = o.querySelector('#api-dp-d');
    var curDay = parseInt(daySel.value) || d;
    var dOpts = '';
    for (var i = 1; i <= daysInMonth; i++) {
      dOpts += '<option value="' + i + '"' + (i === Math.min(curDay, daysInMonth) ? ' selected' : '') + '>' + i + '日</option>';
    }
    daySel.innerHTML = dOpts;
  }
  // Populate month options
  var mSel = o.querySelector('#api-dp-m');
  var mOpts = '';
  for (var i = 1; i <= 12; i++) mOpts += '<option value="' + i + '"' + (i === m ? ' selected' : '') + '>' + i + '月</option>';
  mSel.innerHTML = mOpts;

  // Initial day population
  updateDays();

  // Re-validate days when year or month changes
  o.querySelector('#api-dp-y').addEventListener('change', updateDays);
  o.querySelector('#api-dp-m').addEventListener('change', updateDays);

  o.querySelector('#api-dp-ok').onclick=function(){
    var vy=o.querySelector('#api-dp-y').value;
    var vm=String(o.querySelector('#api-dp-m').value).padStart(2,'0');
    var vd=String(o.querySelector('#api-dp-d').value).padStart(2,'0');
    o.remove();
    if(onSave) onSave(vy+'-'+vm+'-'+vd);
  };
};

API.getSetting = (key, def) => localStorage.getItem('zhangl-' + key) || def;

// ── iOS visual viewport / keyboard adapter ───────────────────────
// WKWebView keeps fixed elements pinned to the layout viewport while the
// keyboard shrinks the visual viewport. Expose stable CSS variables so sheets,
// overlays and scroll containers can avoid the keyboard without page-specific
// hacks.
API.IOSViewport = (() => {
  var initialized = false;
  var keyboardOpen = false;

  function px(value) {
    return Math.max(0, Math.round(value || 0)) + 'px';
  }

  function update() {
    var root = document.documentElement;
    var vv = window.visualViewport;
    var layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
    var visualH = vv ? vv.height : layoutH;
    var offsetTop = vv ? vv.offsetTop : 0;
    var keyboard = Math.max(0, layoutH - visualH - offsetTop);
    root.style.setProperty('--app-height', px(visualH));
    root.style.setProperty('--vv-offset-top', px(offsetTop));
    root.style.setProperty('--keyboard-inset', px(keyboard));
    keyboardOpen = keyboard > 80;
    if (document.body) document.body.classList.toggle('keyboard-open', keyboardOpen);
  }

  function init() {
    if (initialized) { update(); return; }
    initialized = true;
    update();
    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', function() { setTimeout(update, 80); });
    document.addEventListener('focusin', function(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(update, 40);
    });
    document.addEventListener('focusout', function() { setTimeout(update, 80); });
  }

  return { init: init, update: update, isKeyboardOpen: function() { return keyboardOpen; } };
})();

API.StyleGuard = (() => {
  var initialized = false;
  var lastRepairAt = 0;
  var intervalId = 0;
  var repaintTimer = 0;

  function ensureCriticalStyle() {
    var existing = document.getElementById('style-guard-critical');
    if (existing) return existing;
    var style = document.createElement('style');
    style.id = 'style-guard-critical';
    style.textContent =
      ':root{--bg:#1A1D23;--surface:#252830;--surface2:#2D3039;--border:#3A3D45;--border-light:#33363E;--text:#E8E8EC;--text-secondary:#A0A3AE;--accent:#4A9EFF;--accent-soft:rgba(74,158,255,.12);--green:#34C759;--red:#FF453A;--orange:#F0A030;--purple:#7C5CFC;--hover:#33363E;--card-shadow:0 1px 6px rgba(0,0,0,.12);--radius-sm:8px;--radius-md:10px;--radius-lg:14px;--radius-full:20px;--app-height:100vh;--keyboard-inset:0px;--vv-offset-top:0px}' +
      'html.light,body.light{--bg:#F5F6FA;--surface:#FFFFFF;--surface2:#F8F9FB;--border:#E0E0E0;--border-light:#F0F0F0;--text:#333333;--text-secondary:#6B6B7B;--accent:#1A73E8;--accent-soft:rgba(26,115,232,.08);--hover:#F0F2F5;--card-shadow:0 1px 4px rgba(0,0,0,.05)}' +
      '*,*::before,*::after{box-sizing:border-box}html{background:var(--bg);-webkit-text-size-adjust:100%;text-size-adjust:100%}html::before{content:"";position:fixed;inset:0;z-index:-1;background:var(--bg);pointer-events:none;transform:translateZ(0)}body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;position:fixed;top:var(--vv-offset-top);left:0;right:0;height:var(--app-height);display:flex;flex-direction:column;overflow:hidden;margin:0;-webkit-font-smoothing:antialiased}body.ios-resume-repaint{animation:iosResumeRepaint .18s linear 1}@keyframes iosResumeRepaint{0%{opacity:.999;transform:translateZ(0)}100%{opacity:1;transform:translateZ(0)}}' +
      '.page{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px calc(8px + var(--keyboard-inset));display:flex;flex-direction:column;gap:12px}.navbar{display:flex;align-items:center;height:calc(44px + env(safe-area-inset-top));padding:env(safe-area-inset-top) 6px 0 8px;gap:8px;background:rgba(26,29,35,.85);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);flex-shrink:0;position:sticky;top:0;z-index:10}body.light .navbar{background:rgba(245,246,250,.85)}.navbar button{background:none;border:none;color:var(--text);min-width:44px;min-height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center}.navbar .title{flex:1;text-align:center;font-size:16px;font-weight:600;color:var(--text)}.tabs{display:flex;justify-content:space-around;background:rgba(37,40,48,.85);border-top:1px solid var(--border);padding:6px 0 calc(4px + env(safe-area-inset-bottom));flex-shrink:0}body.light .tabs{background:rgba(255,255,255,.85)}.tab-item{display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--text-secondary);font-size:10px}.tab-item.active{color:var(--accent)}.card,.score-card,.list{background:var(--surface);border-radius:14px;box-shadow:var(--card-shadow);color:var(--text)}' +
      '#aic-bubble{position:fixed;z-index:10002;right:16px;bottom:max(calc(72px + env(safe-area-inset-bottom) + var(--keyboard-inset)),88px);width:50px;height:50px;border-radius:25px;background:linear-gradient(135deg,#7C5CFC,#A78BFA);color:#fff;border:none;box-shadow:0 4px 20px rgba(124,92,252,.35);display:flex;align-items:center;justify-content:center;touch-action:none}#aic-backdrop{position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .25s}#aic-backdrop.open{opacity:1;pointer-events:auto}#aic-sheet{position:fixed;z-index:10004;left:0;right:0;bottom:0;top:25%;background:var(--bg);border-radius:16px 16px 0 0;display:flex;flex-direction:column;transform:translateY(120%);transition:transform .3s cubic-bezier(.32,.72,0,1);box-shadow:0 -4px 24px rgba(0,0,0,.12);overflow:hidden;pointer-events:none}#aic-sheet.open{transform:translateY(0);pointer-events:auto}body.keyboard-open #aic-sheet{bottom:var(--keyboard-inset);top:max(8px,env(safe-area-inset-top));border-radius:14px 14px 0 0}body.keyboard-open #aic-bubble{display:none}.modal-overlay,.sheet-overlay{background:rgba(0,0,0,.45)}.modal-card,.sheet-card{background:var(--surface);color:var(--text);border-radius:16px}';
    document.head.appendChild(style);
    return style;
  }

  function commonCssLinks() {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(function(link) {
      return (link.getAttribute('href') || '').indexOf('common.css') >= 0;
    });
  }

  function cssHealthy() {
    var rootStyle = getComputedStyle(document.documentElement);
    var bg = (rootStyle.getPropertyValue('--bg') || '').trim();
    if (!bg) return false;
    var links = commonCssLinks();
    if (!links.length || links.some(function(link) { return link.disabled; })) return false;
    var sentinel = document.getElementById('style-guard-sentinel');
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'style-guard-sentinel';
      sentinel.className = 'style-guard-sentinel';
      document.body.appendChild(sentinel);
    }
    var ss = getComputedStyle(sentinel);
    if (Math.round(parseFloat(ss.width || '0')) !== 13) return false;
    if (Math.round(parseFloat(ss.height || '0')) !== 7) return false;
    if (parseFloat(ss.borderTopLeftRadius || '0') < 4) return false;
    var bubble = document.getElementById('aic-bubble');
    if (bubble) {
      var bs = getComputedStyle(bubble);
      if (parseFloat(bs.borderTopLeftRadius || '0') < 20) return false;
      if (parseFloat(bs.width || '0') < 40) return false;
    }
    return true;
  }

  function reapplyRuntimeState() {
    API.applyThemePreference(localStorage.getItem('zhangl-theme') || 'light');
    API.applyFontPreference(localStorage.getItem(API.KEYS.font) || '标准');
    API.IOSViewport.update();
    if (window.lucide) lucide.createIcons();
  }

  function resolvedBg() {
    var value = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return value || (document.documentElement && document.documentElement.classList.contains('light') ? '#F5F6FA' : '#1A1D23');
  }

  function forceRepaint(reason) {
    if (!document.body || !document.documentElement) return;
    ensureCriticalStyle();
    reapplyRuntimeState();
    var bg = resolvedBg();
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    document.body.classList.remove('ios-resume-repaint');
    void document.body.offsetHeight;
    document.body.classList.add('ios-resume-repaint');
    var active = document.querySelector('.shell-page.active, .subpage-overlay.in, #page, .page');
    if (active) {
      active.style.backgroundColor = bg;
      active.style.webkitTransform = 'translateZ(0)';
      active.style.transform = 'translateZ(0)';
      void active.offsetHeight;
      setTimeout(function() {
        active.style.webkitTransform = '';
        active.style.transform = '';
      }, 160);
    }
    try { window.dispatchEvent(new CustomEvent('aic-style-repaint', { detail: { reason: reason || '' } })); } catch(e) {}
  }

  function repaintBurst(reason) {
    if (repaintTimer) clearInterval(repaintTimer);
    var count = 0;
    forceRepaint(reason);
    repaintTimer = setInterval(function() {
      count += 1;
      forceRepaint(reason || 'burst');
      if (count >= 8) {
        clearInterval(repaintTimer);
        repaintTimer = 0;
      }
    }, 120);
  }

  function reloadCommonCss() {
    var links = commonCssLinks();
    var versionedHref = 'common.css?v=' + encodeURIComponent(API.ASSET_VERSION || '1');
    if (!links.length) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = versionedHref;
      document.head.insertBefore(link, document.head.firstChild);
      return;
    }
    links.forEach(function(link) {
      var href = link.getAttribute('href') || 'common.css';
      var base = href.split('?')[0] || 'common.css';
      link.disabled = false;
      link.setAttribute('href', base + '?v=' + encodeURIComponent(API.ASSET_VERSION || '1'));
    });
  }

  function repair(reason) {
    if (!document.body || !document.documentElement) return;
    ensureCriticalStyle();
    reapplyRuntimeState();
    if (/^(app-active|visible|pageshow|focus|native-resume|foreground)$/i.test(reason || '')) forceRepaint(reason);
    if (cssHealthy()) return;
    var now = Date.now();
    if (now - lastRepairAt < 1500) return;
    lastRepairAt = now;
    reloadCommonCss();
    setTimeout(function() {
      ensureCriticalStyle();
      reapplyRuntimeState();
      if (!cssHealthy()) console.warn('[style-guard] CSS still unhealthy after resume:', reason || '');
    }, 120);
  }

  function init() {
    if (initialized) { repair('init-repeat'); return; }
    initialized = true;
    window.addEventListener('pageshow', function() { setTimeout(function() { repaintBurst('pageshow'); repair('pageshow'); }, 20); });
    window.addEventListener('focus', function() { setTimeout(function() { repaintBurst('focus'); repair('focus'); }, 20); });
    window.addEventListener('app-active', function() { setTimeout(function() { repaintBurst('app-active'); repair('app-active'); }, 20); });
    window.addEventListener('native-resume', function() { setTimeout(function() { repaintBurst('native-resume'); repair('native-resume'); }, 20); });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) setTimeout(function() { repaintBurst('visible'); repair('visible'); }, 30);
    });
	    document.addEventListener('focusin', function(e) {
	      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(function() { repair('focusin'); }, 20);
	    });
	    document.addEventListener('touchend', function() { setTimeout(function() { repair('touchend'); }, 30); }, { passive: true });
	    try {
	      var observer = new MutationObserver(function(list) {
	        if (list.some(function(m) { return m.type === 'childList' || (m.type === 'attributes' && /^(href|rel|disabled)$/i.test(m.attributeName || '')); })) repair('mutation');
	      });
	      observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel', 'disabled'] });
	    } catch(e) {}
	    intervalId = setInterval(function() {
	      if (!document.hidden) repair('interval');
	    }, 3000);
	    repair('init');
	  }

  return { init: init, repair: repair, repaint: repaintBurst, cssHealthy: cssHealthy };
})();

// Review queue status — check how many items are due for spaced repetition
// Simple pull-to-refresh for scrollable containers
API.enablePullRefresh = function(container, onRefresh) {
  // Remove any previous pull-refresh wiring on this container (prevents listener accumulation
  // when called repeatedly during tab reloads — see audit S2)
  if (container._prCleanup) { try { container._prCleanup(); } catch(e){} }
  var pulling = false, startY = 0, pulled = 0;
  var indicator = document.createElement('div');
  indicator.style.cssText = 'position:sticky;top:0;z-index:20;text-align:center;height:0;overflow:hidden;transition:height .25s;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--bg)';
  indicator.innerHTML = '<div style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite"></div><span style="font-size:12px;color:var(--text-secondary)">释放刷新</span>';
  container.insertBefore(indicator, container.firstChild);

  var ts = function(e) {
    if (container.scrollTop > 0) return;
    startY = e.touches[0].clientY; pulling = true;
  };
  var tm = function(e) {
    if (!pulling) return;
    pulled = e.touches[0].clientY - startY;
    if (pulled > 20) {
      indicator.style.height = Math.min(pulled - 20, 48) + 'px';
      indicator.querySelector('span').textContent = pulled > 60 ? '松开刷新' : '下拉刷新';
    }
  };
  var te = function() {
    if (!pulling) return;
    pulling = false;
    if (pulled > 60) {
      indicator.style.height = '48px';
      indicator.querySelector('span').textContent = '刷新中...';
      onRefresh().finally(function() { indicator.style.height = '0'; });
    } else {
      indicator.style.height = '0';
    }
    pulled = 0;
  };

  container.addEventListener('touchstart', ts, {passive: true});
  container.addEventListener('touchmove', tm, {passive: true});
  container.addEventListener('touchend', te);

  // Register cleanup so subsequent enablePullRefresh / page teardown can detach these listeners
  container._prCleanup = function() {
    container.removeEventListener('touchstart', ts);
    container.removeEventListener('touchmove', tm);
    container.removeEventListener('touchend', te);
    if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
    container._prCleanup = null;
  };
};

// ── Generation state management ──
// Generation belongs to one project, module and date.  Keeping this context in
// the key prevents a background task from one project/module leaking into another
// page after the user navigates away and returns.
API._generationProject = function() { return localStorage.getItem('zhangl-active-project') || '公考练习'; };
API._generationKey = function(type, mod, date) {
  return 'gen-v2-' + encodeURIComponent(API._generationProject()) + '-' + encodeURIComponent(type || '') + '-' + encodeURIComponent(mod || '') + '-' + encodeURIComponent(date || '');
};
API._legacyGenerationKey = function(type, mod, date) {
  return 'gen-' + (type || '') + '-' + (mod || '') + '-' + (date || '');
};
API._generationRecord = function(key) {
  var raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return { status: 'running', startedAt: 0, legacy: true }; }
};
API.setGenerating = function(type, mod, date) {
  var key = API._generationKey(type, mod, date);
  var previous = API._generationRecord(key);
  localStorage.setItem(key, JSON.stringify({
    version: 2,
    status: 'running',
    type: type || '',
    module: mod || '',
    date: date || '',
    project: API._generationProject(),
    startedAt: previous && previous.startedAt || Date.now(),
    updatedAt: Date.now()
  }));
};
API.clearGenerating = function(type, mod, date) {
  localStorage.removeItem(API._generationKey(type, mod, date));
  // Clear the old bare key too, so an upgrade cannot revive a stale waiting UI.
  localStorage.removeItem(API._legacyGenerationKey(type, mod, date));
};
API.isGenerating = function(type, mod, date) {
  if (!API._aiStreaming) return false;
  var targetDate = date || '';
  if (mod) {
    return !!(API._generationRecord(API._generationKey(type, mod, targetDate)) || localStorage.getItem(API._legacyGenerationKey(type, mod, targetDate)));
  }
  var prefix = 'gen-v2-' + encodeURIComponent(API._generationProject()) + '-' + encodeURIComponent(type || '') + '-';
  var legacyPrefix = 'gen-' + (type || '') + '-';
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!k) continue;
    if (k.indexOf(prefix) === 0) {
      var record = API._generationRecord(k);
      if (record && record.date === targetDate) return true;
    }
    if (k.indexOf(legacyPrefix) === 0 && k.endsWith('-' + targetDate)) return true;
  }
  return false;
};
API.cleanupGenerating = function(force) {
  // A normal app start has no active stream. Keep recent records only for
  // diagnostics; a manual stop explicitly clears every active waiting state.
  var now = Date.now(), maxAge = 30 * 60 * 1000, keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!k) continue;
    if (k === 'p-generating' || k.indexOf('gen-') === 0) {
      var record = k.indexOf('gen-v2-') === 0 ? API._generationRecord(k) : null;
      if (force || !record || !record.updatedAt || now - record.updatedAt > maxAge) keys.push(k);
    }
  }
  keys.forEach(function(k) { localStorage.removeItem(k); });
};
API._generationScopeForTask = function(task, message) {
  var type = task && task.type || '';
  if (type === 'generate' || type === 'grade' || type === 'redo') return { type: 'practice', module: task.module || '', date: task.date || '' };
  if (type === 'essay' || type === 'essay_grade') return { type: 'essay', module: task.module || '', date: task.date || '' };
  if (type === 'digest') {
    return { type: 'digest', module: /热点/.test(message || '') ? 'news' : 'knowledge', date: task.date || '' };
  }
  return null;
};
API.clearGeneratingForTask = function(task, message) {
  var scope = API._generationScopeForTask(task, message);
  if (!scope) return;
  if (scope.module) API.clearGenerating(scope.type, scope.module, scope.date);
  // Essay sub-types and legacy callers may not use the task parser's module
  // name. Clear the remaining records in the same task type/date as well.
  var prefix = 'gen-v2-' + encodeURIComponent(API._generationProject()) + '-' + encodeURIComponent(scope.type) + '-';
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (!key || key.indexOf(prefix) !== 0) continue;
    var record = API._generationRecord(key);
    if (record && record.date === scope.date) keys.push(key);
  }
  keys.forEach(function(key) { localStorage.removeItem(key); });
};
API.cleanupGenerating();

API.getReviewDue = async function() {
  try {
    var today = API.getLocalDate();
    var count = 0;
    var q = await API.fetchJSON('复习队列.json');
    if (q && q.queue) count += q.queue.filter(function(item) { return !item.next_review || item.next_review <= today; }).length;
    if (q && q.queue_v2) count += q.queue_v2.filter(function(item) { return item.status !== 'mastered' && (!item.next_review || item.next_review <= today); }).length;
    var ri = await API.fetchJSON('复习项目.json');
    if (ri && ri.items) count += ri.items.filter(function(item) { return item.status !== 'mastered' && (!item.next_review || item.next_review <= today); }).length;
    var fc = await API.fetchJSON('闪卡掌握.json');
    if (fc && fc.items) {
      Object.keys(fc.items).forEach(function(k) {
        var e = fc.items[k];
        if (e && (!e.nextReview || e.nextReview <= today)) count++;
      });
    }
    return count;
  } catch(e) { return 0; }
};

// ===== Business loop helpers =====
API.Business = {
  createTargetModel: function(config) {
    config = config || {};
    return {
      version: 1,
      created_at: new Date().toISOString(),
      exam_type: config.exam_type || '',
      exam_name: config.exam_name || '',
      province: config.province || '',
      exam_date: config.exam_date || '',
      position: config.position || '',
      requirements: config.requirements || '',
      question_count: config.mock_exam_count || 120,
      confidence: (config.exam_date && config.exam_type) ? 'medium' : 'low',
      gaps: []
    };
  },

  getPhase: function(plan) {
    if (!plan || !plan.exam_date) return '诊断期';
    var end = new Date(plan.exam_date + 'T00:00:00');
    var remain = Math.ceil((end - new Date()) / 86400000);
    if (!Number.isFinite(remain)) return '诊断期';
    if (remain <= 30) return '冲刺期';
    if (remain <= 90) return '强化期';
    return '基础期';
  },

  moduleSummaries: function(profile) {
    return API.XC_MODULES.map(function(m) {
      var s = API.moduleStats(profile, m);
      return { name: m, total: s.total || 0, correct: s.correct || 0, accuracy: s.accuracy || 0 };
    }).sort(function(a, b) {
      if (a.total !== b.total) return a.total - b.total;
      return a.accuracy - b.accuracy;
    });
  },

  diagnosis: function(plan, profile, stats) {
    var records = stats && stats.records ? stats.records : [];
    var total = records.reduce(function(s, r) { return s + (r.total || 0); }, 0);
    var mods = API.Business.moduleSummaries(profile);
    var covered = mods.filter(function(m) { return m.total > 0; }).length;
    var gaps = [];
    if (!plan || !plan.exam_date) gaps.push('考试日期未确认');
    if (!plan || !plan.business_model) gaps.push('目标模型不完整');
    if (total < 30) gaps.push('诊断样本不足');
    if (covered < 3) gaps.push('模块覆盖不足');
    return {
      sample_total: total,
      covered_modules: covered,
      gaps: gaps,
      ready: gaps.length === 0,
      label: gaps.length ? gaps[0] : '诊断充分'
    };
  },

  loadSyllabusTargets: async function(profile) {
    profile = profile || {};
    var targets = [];
    for (var mi = 0; mi < API.XC_MODULES.length; mi++) {
      var mod = API.XC_MODULES[mi];
      var syllabus = await API.fetchJSON('syllabus/' + mod + '.json');
      if (!syllabus || !Object.keys(syllabus).length) continue;
      Object.keys(syllabus).forEach(function(group) {
        (syllabus[group] || []).forEach(function(item) {
          var name = typeof item === 'string' ? item : item.name;
          if (!name) return;
          var kp = profile.modules && profile.modules[mod] ? profile.modules[mod][name] : null;
          var attempts = kp ? (kp.attempts || 0) : 0;
          var accuracy = kp ? Math.round((kp.accuracy || 0) * 100) : 0;
          var proficiency = kp ? Math.round((kp.proficiency || kp.accuracy || 0) * 100) : 0;
          var status = (typeof item === 'object' && item.status) || (kp && kp.status) || '未学';
          var err = kp && kp.errors ? kp.errors : {};
          var errorTotal = (err['概念性错误'] || 0) + (err['理解性错误'] || 0) + (err['执行性错误'] || 0);
          var priority = 0;
          if (status === '未学') priority += 50;
          if (attempts < 3) priority += 35;
          priority += Math.max(0, 80 - proficiency);
          priority += Math.min(30, errorTotal * 6);
          if (kp && kp.plateau && kp.plateau.is_plateau) priority += 12;
          targets.push({
            module: mod,
            group: group,
            knowledge_point: name,
            status: status,
            attempts: attempts,
            accuracy: accuracy,
            proficiency: proficiency,
            errors: errorTotal,
            priority: priority,
            reason: status === '未学' ? '大纲未学' : attempts < 3 ? '样本不足' : proficiency < 65 ? ('掌握度 ' + proficiency + '%') : errorTotal > 0 ? ('错因 ' + errorTotal + ' 次') : '巩固提升'
          });
        });
      });
    }
    return targets.sort(function(a, b) { return b.priority - a.priority; });
  },

  buildTodayTasks: function(ctx) {
    ctx = ctx || {};
    var plan = ctx.plan || {};
    var profile = ctx.profile || {};
    var stats = ctx.stats || {};
    var reviewDue = ctx.reviewDue || 0;
    var phase = API.Business.getPhase(plan);
    var diagnosis = API.Business.diagnosis(plan, profile, stats);
    var targets = ctx.targets || [];
    var mods = API.Business.moduleSummaries(profile);
    var weak = mods.filter(function(m) { return m.total === 0 || m.accuracy < (phase === '冲刺期' ? 78 : phase === '强化期' ? 72 : 65); });
    var priority = weak.length ? weak : mods;
    var items = [];
    var id = 1;

    if (!diagnosis.ready) {
      var firstTarget = targets[0];
      var first = firstTarget ? { name: firstTarget.module } : (priority[0] || { name: '资料分析' });
	      items.push({
	        id: id++, type: 'diagnosis', module: first.name, text: '完成首次诊断 · ' + first.name,
	        knowledge_point: firstTarget ? firstTarget.knowledge_point : '',
	        target: 10, actual: 0, done: false, source: 'business_v1',
	        reason: firstTarget ? (firstTarget.knowledge_point + ' · ' + firstTarget.reason) : diagnosis.label,
	        sub: '按大纲补齐画像样本',
	        prescription: { purpose: 'diagnosis', question_count: 10, difficulty: 'mixed', new_review_ratio: '8:2', reason: diagnosis.label }
	      });
    }

    if (reviewDue > 0) {
      var reviewMod = priority[0] ? priority[0].name : '';
	      items.push({
	        id: id++, type: 'review', module: reviewMod, text: '复习到期错题',
	        target: Math.min(20, reviewDue), actual: 0, done: false, source: 'business_v1',
	        reason: reviewDue + ' 条复习到期', sub: '先处理遗忘风险',
	        prescription: { purpose: 'review', question_count: Math.min(20, reviewDue), difficulty: '错题同难度+变式', new_review_ratio: '0:10', reason: '到期复习' }
	      });
    }

    var usedMods = {};
    targets.slice(0, phase === '冲刺期' ? 2 : 3).forEach(function(tg) {
      if (usedMods[tg.module] && phase !== '基础期') return;
      usedMods[tg.module] = true;
	      items.push({
	        id: id++, type: 'practice', module: tg.module, text: tg.module + ' · ' + tg.knowledge_point,
	        knowledge_point: tg.knowledge_point,
	        target: tg.attempts < 3 ? 8 : 12, actual: 0, done: false, source: 'business_v2_syllabus',
	        reason: tg.reason, sub: tg.group + ' · 练完回流画像',
	        prescription: {
	          purpose: tg.attempts < 3 ? 'sample_building' : 'weakness_training',
	          question_count: tg.attempts < 3 ? 8 : 12,
	          difficulty: tg.proficiency < 45 ? '基础-标准' : '标准-进阶',
	          new_review_ratio: tg.errors > 0 ? '6:4' : '8:2',
	          reason: tg.reason
	        }
	      });
    });
    if (!items.some(function(t) { return t.type === 'practice'; })) {
      priority.slice(0, phase === '冲刺期' ? 1 : 2).forEach(function(m) {
	        items.push({
	          id: id++, type: 'practice', module: m.name, text: m.name + '专项练习',
	          target: m.total < 10 ? 10 : 15, actual: 0, done: false, source: 'business_v1',
	          reason: m.total === 0 ? '尚无样本' : ('正确率 ' + m.accuracy + '%'), sub: '弱项优先，完成后回流画像',
	          prescription: { purpose: m.total < 10 ? 'sample_building' : 'module_boost', question_count: m.total < 10 ? 10 : 15, difficulty: m.accuracy < 50 ? '基础-标准' : '标准', new_review_ratio: '7:3', reason: m.total === 0 ? '尚无样本' : ('正确率 ' + m.accuracy + '%') }
	        });
      });
    }

	    items.push({
	      id: id++, type: 'essay', module: '申论', text: phase === '冲刺期' ? '申论限时训练' : '申论基础训练',
	      target: 1, actual: 0, done: false, source: 'business_v1',
	      reason: '主观题需要连续样本', sub: 'AI 批改仅作训练参考',
	      prescription: { purpose: 'essay_dimension_training', question_count: 1, difficulty: phase === '冲刺期' ? '限时套题' : '单题精练', new_review_ratio: '新题+复盘', reason: '主观题维度画像' }
	    });

    if (phase === '冲刺期') {
      items.push({
	        id: id++, type: 'mock', module: '', text: '限时模拟考试',
	        target: 1, actual: 0, done: false, source: 'business_v1',
	        reason: '考前 ' + phase, sub: '按真实时间完成并回流错题',
	        prescription: { purpose: 'mock_exam', question_count: 1, difficulty: '全真限时', new_review_ratio: '阶段评估', reason: '考前综合校准' }
	      });
    } else {
      items.push({
        id: id++, type: 'digest', module: '', text: '每日积累',
        target: 1, actual: 0, done: false, source: 'business_v1',
        reason: '常识和申论素材', sub: '补充时政与表达素材'
      });
    }

    return { generated_by: 'business_v1', phase: phase, diagnosis: diagnosis, items: items.slice(0, 5) };
  },

  questionTrustFromText: function(text) {
    var t = String(text || '');
    var label = 'AI生成题';
    var level = 'medium';
    if (/真题|official|来源[：:]/i.test(t)) { label = '来源标注题'; level = 'high'; }
    if (/仿真|真题风格|模拟/i.test(t)) { label = '真题风格模拟'; level = 'medium'; }
    if (!/answer-block|答案|解析|正确答案/.test(t)) level = 'low';
    return { label: label, level: level, note: level === 'low' ? '解析信息不足' : '训练参考' };
  },

  scoreTrust: function(kind) {
    return {
      kind: kind || 'practice',
      level: 'reference',
      label: '训练参考评分',
      requirements: '请输出评分依据、置信度、可复核点；不要声称等同官方阅卷。'
    };
  },

  reviewPriority: function(item, sm2) {
    var queueData = arguments.length > 2 ? arguments[2] : null;
    var qid = item && item.seeRef ? (item.seeRef.file + '#' + (item.seeRef.qNum || item.qNum || '')) : '';
    if (queueData && queueData.queue_v2 && qid) {
      var qe = queueData.queue_v2.find(function(e) { return e.id === qid || (e.file === item.seeRef.file && e.q === (item.seeRef.qNum || item.qNum)); });
      if (qe) {
        if (!qe.next_review || qe.next_review <= API.getLocalDate()) return { label: '到期复习', level: 'high' };
        if ((qe.fail_count || 0) > 0) return { label: '易错回炉', level: 'high' };
        return { label: '已排期', level: 'low' };
      }
    }
    var key = (item.module || '') + '::' + (item.qNum || '');
    var state = sm2 && sm2.items ? sm2.items[key] : null;
    if (!state) return { label: '新错题', level: 'high' };
    if (!state.nextReview || state.nextReview <= API.getLocalDate()) return { label: '到期复习', level: 'high' };
    if ((state.interval || 0) <= 2) return { label: '巩固中', level: 'medium' };
    return { label: '已排期', level: 'low' };
  },

  questionMeta: function(args) {
    args = args || {};
    return {
      id: args.id || ((args.file || '') + '#Q' + (args.q || '')),
      file: args.file || '',
      q: args.q || '',
      module: args.module || '',
      date: args.date || API.getLocalDate(),
      knowledge_point: args.knowledge_point || '',
      difficulty: args.difficulty || '',
      source_type: args.source_type || 'ai_generated',
      source_name: args.source_name || '',
      quality_status: args.quality_status || 'unchecked',
      review_points: args.review_points || [],
      has_answer: args.has_answer !== false,
      trust: args.trust || API.Business.questionTrustFromText(args.text || ''),
      created_at: args.created_at || new Date().toISOString()
    };
  },

  scoreRecord: function(args) {
    args = args || {};
    return {
      id: args.id || ('score-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      idempotency_key: args.idempotency_key || args.id || '',
      mode: args.mode || 'practice',
      file: args.file || '',
      module: args.module || '',
      date: args.date || API.getLocalDate(),
      total: args.total || 0,
      correct: args.correct || 0,
      scores: args.scores || null,
      confidence: args.confidence || 'medium',
      evidence: args.evidence || '',
      review_points: args.review_points || [],
      grader: args.grader || 'ai',
      created_at: new Date().toISOString()
    };
  },

  learningEvent: function(args) {
    args = args || {};
    return {
      id: args.id || ('evt-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      type: args.type || 'practice',
      mode: args.mode || args.type || 'practice',
      date: args.date || API.getLocalDate(),
      module: args.module || '',
      knowledge_point: args.knowledge_point || '',
      source_file: args.source_file || args.file || '',
      total: args.total || 0,
      correct: args.correct || 0,
      accuracy: args.total ? Math.round((args.correct || 0) / args.total * 1000) / 1000 : 0,
      duration_seconds: args.duration_seconds || args.time_seconds || 0,
      scores: args.scores || null,
      confidence: args.confidence || 'medium',
      reason: args.reason || '',
      next_action: args.next_action || '',
      created_at: args.created_at || new Date().toISOString()
    };
  },

  reviewItem: function(args) {
    args = args || {};
    return {
      id: args.id || ((args.file || '') + '#' + (args.q || args.knowledge_point || Date.now())),
      file: args.file || '',
      q: args.q || '',
      module: args.module || '',
      knowledge_point: args.knowledge_point || '',
      date: args.date || API.getLocalDate(),
      error_type: args.error_type || '',
      source: args.source || 'grading',
      status: args.status || 'due',
      priority: args.priority || 'high',
      interval_days: args.interval_days || 1,
      next_review: args.next_review || API.getLocalDate(),
      fail_count: args.fail_count || 0,
      success_count: args.success_count || 0,
      updated_at: args.updated_at || new Date().toISOString()
    };
  },

  questionQuality: function(q) {
    q = q || {};
    var issues = [];
    var text = String((q.stem || q.question || '') + '\n' + (q.solution || q.explanation || q.analysis || '') + '\n' + ((q.options || []).join('\n')));
    var options = q.options || [];
    if (!q.knowledge_point && !q.kp_label) issues.push('缺少考点');
    if (!q.difficulty) issues.push('缺少难度');
    if (!q.answer && !q.correct) issues.push('缺少答案');
    if (!q.solution && !q.explanation && !q.analysis) issues.push('缺少解析');
    if (options.length && options.length !== 4) issues.push('选项数量不是4个');
    if (/图形|图推|空间重构/.test(text)) {
      var hasVisual = /<svg\b|<img\b|```svg|!\[/.test(text);
      if (!hasVisual) issues.push('图形题缺少图形素材');
    }
    return {
      status: issues.length ? 'needs_review' : 'unchecked',
      review_points: issues,
      confidence: issues.length ? 'low' : 'medium'
    };
  }
};

// Learning events are the sole input for plan completion. This keeps 首页、计划页
// and grading tools consistent even when a page has been exited before grading ends.
API.PlanProgressReducer = (() => {
  function taskType(event) {
    if (event.mode === 'mock_exam' || event.mode === 'mock') return 'mock';
    if (event.mode === 'essay' || event.type === 'essay') return 'essay';
    if (event.mode === 'diagnostic' || event.type === 'diagnosis') return 'diagnosis';
    if (event.mode === 'review' || event.type === 'review') return 'review';
    if (event.type === 'digest' || event.mode === 'digest') return 'digest';
    return 'practice';
  }
  function matches(task, event, type) {
    if (!task || task.done || task.type !== type) return false;
    if (!task.module || type === 'mock' || type === 'review' || type === 'digest') return true;
    return task.module === event.module;
  }
  async function consume(event) {
    if (!event || !event.id) return false;
    const plan = await API.fetchJSON('备考计划.json');
    const date = event.date || API.getLocalDate();
    if (!plan || !plan.tasks || !plan.tasks[date] || !Array.isArray(plan.tasks[date].items)) return false;
    plan._processed_learning_events = plan._processed_learning_events || [];
    if (plan._processed_learning_events.indexOf(event.id) >= 0) return false;
    const type = taskType(event);
    let changed = false;
    plan.tasks[date].items.forEach(function(task) {
      if (!matches(task, event, type)) return;
      const before = task.actual || 0;
      const delta = ['practice', 'review'].indexOf(type) >= 0 ? Math.max(1, event.total || 0) : 1;
      task.actual = task.target > 0 ? Math.min(task.target, before + delta) : before + delta;
      if (event.total && task.actual > 0) {
        task.accuracy = Math.round((((task.accuracy || 0) * before) + ((event.accuracy || 0) * delta)) / task.actual);
      }
      task.done = task.target > 0 ? task.actual >= task.target : task.actual > 0;
      changed = true;
    });
    plan._processed_learning_events.push(event.id);
    if (plan._processed_learning_events.length > 2000) plan._processed_learning_events = plan._processed_learning_events.slice(-2000);
    if (changed) {
      await API.writeFile('备考计划.json', JSON.stringify(plan));
      window.dispatchEvent(new CustomEvent('plan-progress-updated', { detail: { date: date, event: event } }));
    }
    return changed;
  }
  return { consume: consume };
})();
API.setSetting = (key, val) => localStorage.setItem('zhangl-' + key, val);

// ===== Navigation Shell (index.html) =====
// Architecture:
//   Tab roots: 5 static divs, loaded once, cached forever, CSS show/hide
//   Sub-page stack: overlay divs pushed on top of current tab, covering tabs bar
//   Tab switch clears sub-page stack. Back button pops stack.
//   ALL navigation stays in one WebView — zero reloads.

API._tabLoaded = {};
API._tabActive = 'home';
API._pageStack = [];     // [{name, el, styleId}] — sub-pages pushed on top
API._pageCache = {};     // {name: {content, styles}} — cached sub-page HTML

// === Init shell ===
API.initShell = function(startTab) {
  API.IOSViewport.init();
  API.StyleGuard.init();
  API.applyThemePreference(localStorage.getItem('zhangl-theme') || 'light');
  API.applyFontPreference(localStorage.getItem(API.KEYS.font) || '标准');
  document.querySelector('.tabs').innerHTML = API.renderTabs(startTab);
  lucide.createIcons();
  API._taskUpdateBadge();
  if (!document.getElementById('aic-bubble')) API._aiInject();
  API.LearningNotifications.consumePendingRoute().catch(function(error) { console.warn('[learning-notifications]', error); });
  API.switchTab(startTab);
};

// === Load tab root content ===
API._loadTabRoot = async function(name) {
  if (API._tabLoaded[name]) return;
  var container = document.getElementById('sc-' + name);
  if (!container) return;
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:160px"><div style="width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;opacity:.5"></div></div>';
  try {
	    var resp = await fetch(name + '.html?v=' + encodeURIComponent(API.ASSET_VERSION || '1'), { cache: 'no-store' });
    if (!resp.ok) { console.warn('[loadTabRoot] fetch failed', name, resp.status); return; }
    var html = await resp.text();
    var parsed = API._parsePage(html);
    var sid = 'tab-style-'+name;
    var se = document.getElementById(sid);
    if (!se) { se = document.createElement('style'); se.id = sid; document.head.appendChild(se); }
    se.disabled = false;
    se.textContent = parsed.styles;
    container.innerHTML = parsed.content;
    // Enable pull-to-refresh on this tab (enablePullRefresh self-cleans old listeners)
    API.enablePullRefresh(container, function() {
      return new Promise(function(resolve) {
        API._tabLoaded[name] = false;
        API._loadTabRoot(name).then(resolve);
      });
    });
    await API._runScripts(parsed.scripts, 'tab:'+name);
    lucide.createIcons();
    API._enhanceAccessibility(container);
    API._tabLoaded[name] = true;
  } catch(e) { console.warn('[loadTabRoot]', name, e); }
};

// Parse an HTML page string into {content, styles, scripts}
// Shared by _loadTabRoot and pushPage to avoid duplication (audit S5)
API._parsePage = function(html) {
  var sr = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  var scripts = [], m;
  while ((m = sr.exec(html)) !== null) {
    var sm = m[1].match(/src=["']([^"']+)["']/);
    if (sm) {
      if (sm[1].indexOf('common.js')===-1 && sm[1].indexOf('lucide')===-1) scripts.push({src:sm[1]});
    } else if (m[2].trim()) scripts.push({code:m[2].trim()});
  }
  var p = new DOMParser(); var d = p.parseFromString(html, 'text/html');
  var page = d.querySelector('.page'); var content = page ? page.innerHTML : '';
  var styles = Array.from(d.querySelectorAll('style')).map(function(s){return s.textContent;}).join('\n');
  return {content: content, styles: styles, scripts: scripts};
};

// Page scripts are mounted as labelled script nodes rather than eval. Existing
// mobile pages use inline handlers, so classic-script globals remain available
// until those pages are migrated to explicit event bindings.
API.PageRuntime = { currentTag: '', mounted: {}, exports: {}, cleanups: {}, scriptRefs: {} };
API.PageRuntime.addCleanup = function(pageTag, fn) {
  if (typeof fn !== 'function') return;
  (API.PageRuntime.cleanups[pageTag] || (API.PageRuntime.cleanups[pageTag] = [])).push(fn);
};
API.PageRuntime.on = function(pageTag, target, type, handler, options) {
  if (!target || !type || typeof handler !== 'function') return;
  target.addEventListener(type, handler, options);
  API.PageRuntime.addCleanup(pageTag, function() { target.removeEventListener(type, handler, options); });
};
API.PageRuntime.mountController = function(pageTag, root, controller) {
  if (!root || !controller) return controller;
  var cleanups = [];
  var addCleanup = function(fn) {
    if (typeof fn === 'function') cleanups.push(fn);
  };
  API.PageRuntime.controllers = API.PageRuntime.controllers || {};
  API.PageRuntime.controllers[pageTag] = controller;
  if (typeof controller.mount === 'function') controller.mount(root, addCleanup);
  API.PageRuntime.addCleanup(pageTag, function() {
    cleanups.forEach(function(fn) { try { fn(); } catch(e) { console.warn('[controller cleanup]', pageTag, e); } });
    if (typeof controller.destroy === 'function') controller.destroy();
    if (API.PageRuntime.controllers) delete API.PageRuntime.controllers[pageTag];
  });
  return controller;
};
API.PageRuntime.unmount = function(pageTag) {
  (API.PageRuntime.cleanups[pageTag] || []).forEach(function(fn) {
    try { fn(); } catch(e) { console.warn('[page-runtime cleanup]', pageTag, e); }
  });
  (API.PageRuntime.exports[pageTag] || []).forEach(function(name) {
    try { delete window[name]; } catch(e) { window[name] = undefined; }
  });
  delete API.PageRuntime.exports[pageTag];
  delete API.PageRuntime.cleanups[pageTag];
  delete API.PageRuntime.mounted[pageTag];
};
API.PageRuntime.retainScript = function(pageTag, src) {
  if (!/^(marked\.js|mermaid\.min\.js)$/.test(src || '')) return;
  API.PageRuntime.scriptRefs[src] = (API.PageRuntime.scriptRefs[src] || 0) + 1;
  API.PageRuntime.addCleanup(pageTag, function() {
    var count = Math.max(0, (API.PageRuntime.scriptRefs[src] || 1) - 1);
    API.PageRuntime.scriptRefs[src] = count;
    if (count) return;
    var node = Array.prototype.slice.call(document.querySelectorAll('script[data-page-runtime-src]')).find(function(el) { return el.getAttribute('data-page-runtime-src') === src; });
    if (node) node.remove();
    // Mermaid marks source nodes as processed. A fresh page must be allowed to render again.
    if (src === 'mermaid.min.js') document.querySelectorAll('.mermaid[data-processed]').forEach(function(el) { el.removeAttribute('data-processed'); });
  });
};
API._runScripts = async function(scripts, pageTag) {
  API.PageRuntime.unmount(pageTag);
  API.PageRuntime.currentTag = pageTag;
  for (var i = 0; i < scripts.length; i++) {
    var s = scripts[i];
    if (s.src) {
      API.PageRuntime.retainScript(pageTag, s.src);
      // Keep the source in a value, not in the attribute name. Filenames such
      // as mermaid.min.js contain dots and querySelector treats them as CSS
      // syntax when embedded in an attribute name.
      var key = 'data-page-runtime-src';
      var existing = Array.prototype.slice.call(document.querySelectorAll('script[' + key + ']')).find(function(el) { return el.getAttribute(key) === s.src; });
      if (existing) {
        if (existing.dataset.loaded !== '1') await new Promise(function(resolve) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 15000); });
        continue;
      }
      await new Promise(function(resolve) {
        var el = document.createElement('script');
        el.src = s.src; el.setAttribute(key, s.src); el.async = false;
        el.onload = function() { el.dataset.loaded = '1'; resolve(); };
        el.onerror = function() { console.warn('[runScripts] external script failed', s.src); resolve(); };
        setTimeout(function() { if (el.dataset.loaded !== '1') { console.warn('[runScripts] external script timeout', s.src); resolve(); } }, 15000);
        document.head.appendChild(el);
      });
    } else {
      try {
        var inline = document.createElement('script');
        inline.type = 'text/javascript'; inline.dataset.pageRuntime = pageTag;
        inline.text = s.code + '\n//# sourceURL=mobile-' + pageTag.replace(/[^a-z0-9:_-]/gi, '-') + '.js';
        document.head.appendChild(inline); inline.remove();
      } catch(e) { console.warn('[runScripts]['+pageTag+']', e); }
    }
  }
  API.PageRuntime.exports[pageTag] = [];
  API.PageRuntime.mounted[pageTag] = true;
  API.PageRuntime.currentTag = '';
};

API._enhanceAccessibility = function(root) {
  (root || document).querySelectorAll('button').forEach(function(button) {
    if (button.getAttribute('aria-label')) return;
    var icon = button.querySelector('[data-lucide]');
    button.setAttribute('aria-label', button.getAttribute('title') || button.textContent.trim() || (icon && icon.getAttribute('data-lucide')) || '操作');
  });
};

// === Switch tab (clears sub-page stack) ===
API.switchTab = function(name) {
  if (API._tabActive === name && API._pageStack.length === 0 && API._tabLoaded[name]) return;
  // Clear any sub-page overlays
  API.popToRoot();
  var previous = API._tabActive;
  if (previous !== name && API._tabLoaded[previous]) {
    API.PageRuntime.unmount('tab:'+previous);
    API._tabLoaded[previous] = false;
    var previousStyle = document.getElementById('tab-style-'+previous);
    if (previousStyle) previousStyle.disabled = true;
  }
  API._tabActive = name;
  if (!API._tabLoaded[name]) API._loadTabRoot(name);
  document.querySelectorAll('.shell-page').forEach(function(el) { el.classList.toggle('active', el.id === 'sp-' + name); });
  document.querySelector('.tabs').innerHTML = API.renderTabs(name);
  lucide.createIcons();
  API._taskUpdateBadge();
};

// === Push sub-page (overlay on top of everything, supports multi-level nesting) ===
API._pushInFlight = false; // re-entry guard
API.pushPage = async function(name) {
  // If already at top of stack, ignore
  if (API._pageStack.length && API._pageStack[API._pageStack.length-1].name === name) return;
  // Re-entry guard: prevent double-push during async fetch (audit S2)
  if (API._pushInFlight) return;
  API._pushInFlight = true;

  // Static pages are bundled with the app version, so cache them after first use.
  var parsed = API._pageCache[name];
  if (!parsed) {
    try {
	      var resp = await fetch(name + '.html?v=' + encodeURIComponent(API.ASSET_VERSION || '1'), { cache: 'no-store' });
      if (!resp.ok) { API._pushInFlight = false; API.toast('页面加载失败'); return; }
      var html = await resp.text();
      parsed = API._parsePage(html);
      API._pageCache[name] = parsed;
    } catch(e) { API._pushInFlight = false; console.warn('[pushPage]', name, e); API.toast('页面加载失败'); return; }
  }

  var depth = API._pageStack.length;

  // First sub-page: hide shell content + bottom tabs
  if (!depth) {
    var activeShell = document.querySelector('.shell-page.active');
    if (activeShell) { activeShell.style.display = 'none'; API._hiddenShell = activeShell; }
    var tabs = document.querySelector('.tabs');
    if (tabs) { tabs.style.display = 'none'; API._hiddenTabs = tabs; }
    // Body padding removed — overlay bottom:0 covers full screen including safe area
  }

  // Create overlay covering full screen
  var overlay = document.createElement('div');
  overlay.className = 'subpage-overlay';
  overlay.dataset.pageName = name;
  overlay.style.zIndex = 10000 + depth;
  overlay.innerHTML = '<div class="page subpage-content">' + parsed.content + '</div>';
  document.body.appendChild(overlay);

  // Inject styles (always use fresh)
  var sid = 'sub-style-' + name;
  var oldStyle = document.getElementById(sid);
  if (oldStyle) oldStyle.remove();
  var se = document.createElement('style'); se.id = sid;
  document.head.appendChild(se); se.textContent = parsed.styles;

  // Slide in from right
  requestAnimationFrame(function() { overlay.classList.add('in'); });

  // Execute page scripts — _lastPushEl exposes this overlay to the page's inline script
  API._lastPushEl = overlay;
  try {
    await API._runScripts(parsed.scripts, 'push:'+name);
    API._enhanceAccessibility(overlay);
    API._pageStack.push({name:name, el:overlay, cleanup: API._collectCleanup(overlay)});
  } catch(e) {
    console.warn('[pushPage] mount failed', name, e);
    API.PageRuntime.unmount('push:'+name);
    var failedStyle = document.getElementById('sub-style-' + name);
    if (failedStyle) failedStyle.remove();
    overlay.remove();
    if (!depth) {
      if (API._hiddenShell) { API._hiddenShell.style.display = ''; API._hiddenShell = null; }
      if (API._hiddenTabs) { API._hiddenTabs.style.display = ''; API._hiddenTabs = null; }
    }
    API.toast('页面加载失败，请重试');
  } finally {
    API._lastPushEl = null;
    API._pushInFlight = false;
  }
  lucide.createIcons();
  API._taskInject();
  // Pull-to-refresh disabled on sub-pages — it interferes with scroll (page gets stuck,
  // user must scroll down first before scrolling up). Tab pages still have it.
};

// Collect page-level cleanup hooks: document-level listeners registered by the sub-page
// via API._onPageExit, plus any pull-refresh wiring on the overlay. Called by popPage/popToRoot
// so that leaving a page detaches its aic-done/aic-stopped/visibilitychange listeners (audit S2).
API._pageExitHooks = {}; // name -> [fn]
API._onPageExit = function(name, fn) {
  if (!API._pageExitHooks[name]) API._pageExitHooks[name] = [];
  API._pageExitHooks[name].push(fn);
};
API._collectCleanup = function(overlay) {
  return function() {
    var name = overlay.dataset.pageName;
    // Run registered exit hooks for this page name
    var hooks = API._pageExitHooks[name];
    if (hooks) { hooks.forEach(function(f){ try{f();}catch(e){console.warn('[exit]',name,e);} }); API._pageExitHooks[name] = []; }
    // Detach pull-refresh listeners attached to this overlay
    if (overlay._prCleanup) { try { overlay._prCleanup(); } catch(e){} }
  };
};

// === Pop top sub-page ===
API.popPage = function() {
  if (!API._pageStack.length) return;
  var top = API._pageStack.pop();
  top.el.classList.remove('in');
  // Run page exit hooks + detach pull-refresh (audit S2)
  if (top.cleanup) top.cleanup();
  API.PageRuntime.unmount('push:'+top.name);
  // Disable this page's injected style so it doesn't pollute tab pages
  var sid = 'sub-style-' + top.name;
  var se = document.getElementById(sid);
  if (se) se.disabled = true;
  setTimeout(function() { top.el.remove(); }, 250);
  // Restore shell + tabs + body overflow when back to root
  if (!API._pageStack.length) {
    if (API._hiddenShell) { API._hiddenShell.style.display = ''; API._hiddenShell = null; }
    if (API._hiddenTabs) { API._hiddenTabs.style.display = ''; API._hiddenTabs = null; }
  }
};

API._enableStyle = function(name) {
  var se = document.getElementById('sub-style-' + name);
  if (se) se.disabled = false;
};

// === Pop all sub-pages back to tab root ===
API.popToRoot = function() {
  while (API._pageStack.length) {
    var top = API._pageStack.pop();
    if (top.cleanup) top.cleanup();
    API.PageRuntime.unmount('push:'+top.name);
    top.el.remove();
    var se = document.getElementById('sub-style-' + top.name);
    if (se) se.disabled = true;
  }
  if (API._hiddenShell) { API._hiddenShell.style.display = ''; API._hiddenShell = null; }
  if (API._hiddenTabs) { API._hiddenTabs.style.display = ''; API._hiddenTabs = null; }
};

// === Back button (pops one level, or goes home if at root) ===
API.goBack = function() {
  if (API._pageStack.length) { API.popPage(); }
  else { API.switchTab('home'); }
};

// ── Task Notification (global bell) ──────────────────────────────
API.TaskStore = (() => {
  var MAX_ITEMS = 100;
  var MAX_ACTIVE = 20;
  var MAX_LOG_ENTRIES = 200;
  var MAX_LOG_CHARS = 20000;
  var DONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var CANCELLED_TTL_MS = 2 * 24 * 60 * 60 * 1000;
  var STALE_RUNNING_MS = 60 * 60 * 1000;
  var NOTIFY_THROTTLE_MS = 200;
  var notifyState = {};
  var ACTIVE_STATUSES = { queued: true, running: true, retrying: true, paused: true };
  var TERMINAL_STATUSES = { done: true, error: true, failed: true, stopped: true, cancelled: true, interrupted: true };

  function key() {
    var proj = localStorage.getItem('zhangl-active-project') || '公考练习';
    return 'zhangl-task-' + proj;
  }
  function load() {
    try {
      var items = JSON.parse(localStorage.getItem(key()) || '[]');
      return Array.isArray(items) ? items : [];
    } catch(e) {
      return [];
    }
  }
  function terminalTtl(status) {
    if (status === 'done') return DONE_TTL_MS;
    if (status === 'stopped' || status === 'cancelled' || status === 'interrupted') return CANCELLED_TTL_MS;
    return FAILED_TTL_MS;
  }
  function isActive(task) {
    return !!(task && ACTIVE_STATUSES[task.status]);
  }
  function compactLog(log) {
    log = Array.isArray(log) ? log.slice(-MAX_LOG_ENTRIES) : [];
    var total = 0;
    for (var i = log.length - 1; i >= 0; i--) {
      total += String(log[i].content || '').length;
      if (total > MAX_LOG_CHARS) return log.slice(i + 1);
    }
    return log;
  }
  function prune(tasks) {
    var now = Date.now();
    var active = [];
    var history = [];
    (tasks || []).forEach(function(t) {
      if (!t || !t.id) return;
      t.log = compactLog(t.log);
      if (t.status === 'running' && now - (t.timestamp || t.startedAt || t.createdAt || 0) > STALE_RUNNING_MS) {
        t.status = 'interrupted';
        t.error = t.error || '任务中断';
        t.finishedAt = t.finishedAt || now;
      }
      if (isActive(t)) active.push(t);
      else {
        var updated = t.finishedAt || t.updated_at || t.timestamp || t.createdAt || 0;
        if (!TERMINAL_STATUSES[t.status] || now - updated <= terminalTtl(t.status)) history.push(t);
      }
    });
    active.sort(function(a,b) { return (b.updated_at || b.timestamp || b.createdAt || 0) - (a.updated_at || a.timestamp || a.createdAt || 0); });
    history.sort(function(a,b) { return (b.finishedAt || b.updated_at || b.timestamp || 0) - (a.finishedAt || a.updated_at || a.timestamp || 0); });
    return active.concat(history).slice(0, MAX_ITEMS);
  }
  function save(tasks) {
    localStorage.setItem(key(), JSON.stringify(prune(tasks)));
  }
  function notify(task, force) {
    if (!task) return;
    var now = Date.now();
    var sig = [task.status || '', task.progressText || '', task.error || '', task.title || '', task.detail || ''].join('|');
    var prev = notifyState[task.id] || {};
    if (!force && prev.sig === sig && now - (prev.at || 0) < NOTIFY_THROTTLE_MS) return;
    notifyState[task.id] = { sig: sig, at: now };
    if (typeof API._taskDispatchUpdate === 'function') API._taskDispatchUpdate(task);
    else {
      try { document.dispatchEvent(new CustomEvent('aic-task-update', { detail: { taskId: task.id, sessionId: task.sessionId || '', status: task.status } })); } catch(e) {}
    }
  }
  function activeCount() {
    return load().filter(isActive).length;
  }
  function findActiveByLock(lockKey) {
    if (!lockKey) return null;
    return load().find(function(t) { return isActive(t) && t.lockKey === lockKey; }) || null;
  }
  function canEnqueue(task) {
    if (activeCount() >= MAX_ACTIVE) return { ok: false, reason: '后台任务较多，请等部分任务完成后再继续' };
    var locked = findActiveByLock(task && task.lockKey);
    if (locked) return { ok: false, reason: '同一文件已有任务在处理中', task: locked };
    return { ok: true };
  }
  function add(task) {
    var tasks = load();
    var now = Date.now();
    var dup = tasks.find(function(t) {
      return t.type === task.type && t.module === task.module && isActive(t) && (now - t.timestamp) < 30000;
    });
    if (dup) return Object.assign(task, { id: dup.id, reused: true });
    task.createdAt = task.createdAt || now;
    task.updated_at = task.updated_at || now;
    task.log = compactLog(task.log);
    tasks.unshift(task);
    save(tasks);
    notify(task, true);
    return task;
  }
  function update(id, patch) {
    var tasks = load();
    var found = tasks.find(function(t) { return t.id === id; });
    if (!found) return null;
    var oldSig = [found.status || '', found.progressText || '', found.error || '', found.title || '', found.detail || ''].join('|');
    Object.assign(found, patch, { updated_at: Date.now() });
    if (patch && (patch.status === 'done' || patch.status === 'error' || patch.status === 'failed' || patch.status === 'stopped' || patch.status === 'cancelled' || patch.status === 'interrupted')) {
      found.finishedAt = found.finishedAt || Date.now();
    }
    found.log = compactLog(found.log);
    save(tasks);
    var newSig = [found.status || '', found.progressText || '', found.error || '', found.title || '', found.detail || ''].join('|');
    notify(found, oldSig !== newSig);
    API._sessionSyncTask(found);
    return found;
  }
  function appendLog(id, entry) {
    var tasks = load();
    var found = tasks.find(function(t) { return t.id === id; });
    if (!found) return null;
    found.log = compactLog((found.log || []).concat([Object.assign({ ts: Date.now(), type: 'progress' }, entry || {})]));
    found.progressText = entry && entry.content ? String(entry.content).slice(0, 120) : found.progressText;
    found.updated_at = Date.now();
    save(tasks);
    notify(found, false);
    API._sessionSyncTask(found);
    return found;
  }
  function count(predicate) {
    return load().filter(predicate).length;
  }
  function markAllRead() {
    var tasks = load();
    tasks.forEach(function(t) { if (t.status !== 'running') t.read = true; });
    save(tasks);
  }
  function clear() {
    localStorage.removeItem(key());
  }
  function cleanup(isAiStreaming) {
    var tasks = load();
    var changed = false;
    tasks.forEach(function(t) {
      if (t.status === 'running' && (!isAiStreaming || Date.now() - t.timestamp > STALE_RUNNING_MS)) {
        t.status = 'stopped';
        t.error = t.error || '任务中断';
        changed = true;
      }
    });
    if (changed) save(tasks);
    else save(tasks);
  }
  return {
    key: key,
    load: load,
    save: save,
    add: add,
    update: update,
    appendLog: appendLog,
    prune: function() { save(load()); },
    canEnqueue: canEnqueue,
    findActiveByLock: findActiveByLock,
    runningCount: function() { return count(function(t) { return t.status === 'running' || t.status === 'queued' || t.status === 'retrying' || t.status === 'paused'; }); },
    unreadCount: function() { return count(function(t) { return t.status !== 'running' && !t.read; }); },
    markAllRead: markAllRead,
    clear: clear,
    cleanup: cleanup
  };
})();
API._taskKey = API.TaskStore.key;
API._taskLoad = API.TaskStore.load;
API._taskSave = API.TaskStore.save;
API._taskAdd = API.TaskStore.add;
API._taskUpdate = API.TaskStore.update;
API._taskAppendLog = API.TaskStore.appendLog;
API._taskRunningCount = API.TaskStore.runningCount;
API._taskUnreadCount = API.TaskStore.unreadCount;
API._taskCleanup = function() { API.TaskStore.cleanup(API._aiStreaming); };

API._taskUpdateBadge = function() {
  API._taskCleanup();
  var running = API._taskRunningCount();
  var unread = API._taskUnreadCount();
  document.querySelectorAll('[data-task-bell]').forEach(function(bell) {
    var badge = bell.querySelector('.task-badge');
    if (!badge) return;
    bell.classList.remove('running');
    badge.classList.remove('show', 'pulse');
    badge.textContent = '';
    if (running > 0 && unread > 0) {
      bell.classList.add('running');
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.add('show');
    } else if (running > 0) {
      bell.classList.add('running');
      badge.classList.add('show', 'pulse');
    } else if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.add('show');
    }
  });
};
API._taskMarkAllRead = function() {
  API.TaskStore.markAllRead();
  API._taskUpdateBadge();
};
API._taskClear = function() {
  API.TaskStore.clear();
  API._taskUpdateBadge();
};

API.AIThrottle = (() => {
  var KEY = 'aic-throttle-v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e) { return {}; }
  }
  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state || {}));
  }
  function retryAfterMs(error) {
    var msg = (error && error.message) ? error.message : String(error || '');
    if (typeof AEngine !== 'undefined' && AEngine._retryAfterMs) {
      var parsed = AEngine._retryAfterMs(msg);
      if (parsed) return parsed;
    }
    var st = load();
    var failures = Math.max(1, st.failures || 1);
    return Math.min(60000, Math.pow(2, Math.min(failures, 5)) * 5000);
  }
  function isRateLimited(error) {
    var msg = (error && error.message) ? error.message : String(error || '');
    if (typeof AEngine !== 'undefined' && AEngine._isRateLimitError) return AEngine._isRateLimitError(msg);
    return /429|rate.?limit|too many requests|quota/i.test(msg);
  }
  function noteRateLimit(error) {
    var st = load();
    var wait = retryAfterMs(error);
    st.failures = (st.failures || 0) + 1;
    st.limitUntil = Date.now() + wait;
    st.maxGenerationConcurrency = 1;
    st.updatedAt = Date.now();
    st.lastError = ((error && error.message) || String(error || '')).slice(0, 200);
    save(st);
    return st;
  }
  function noteSuccess() {
    var st = load();
    if (!st.failures && !st.limitUntil) return;
    st.failures = 0;
    st.limitUntil = 0;
    st.updatedAt = Date.now();
    save(st);
  }
  function blockedMs() {
    var until = load().limitUntil || 0;
    return Math.max(0, until - Date.now());
  }
  return { load: load, isRateLimited: isRateLimited, noteRateLimit: noteRateLimit, noteSuccess: noteSuccess, blockedMs: blockedMs };
})();

API.AITaskQueue = (() => {
  var KEY = 'aic-task-queue-v1';
  var MAX_ITEMS = 20;
  var MAX_GENERATION_QUEUE = 10;
  var BACKGROUND_TYPES = { generate: true, essay: true, digest: true, mock: true, redo: true };

  function load() {
    try {
      var items = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(items) ? items : [];
    } catch(e) {
      return [];
    }
  }
  function save(items) {
    localStorage.setItem(KEY, JSON.stringify((items || []).slice(0, MAX_ITEMS)));
  }
  function generationQueuedCount(items) {
    return (items || load()).filter(function(item) {
      var task = API.TaskStore.load().find(function(t) { return t.id === item.id; });
      return task && BACKGROUND_TYPES[task.type];
    }).length;
  }
  function remove(id) {
    save(load().filter(function(item) { return item.id !== id; }));
  }
  function retry(id, message, opts, delayMs) {
    remove(id);
    var items = load();
    items.unshift({ id: id, message: String(message || ''), opts: opts || {}, created_at: Date.now(), not_before: Date.now() + Math.max(0, delayMs || 0), retry: true });
    save(items);
    API.TaskStore.update(id, { status: 'retrying', retryAt: Date.now() + Math.max(0, delayMs || 0), read: false });
    drainSoon();
  }
  function claimBackground(allowedTypes) {
    allowedTypes = allowedTypes || { generate: true };
    if (API.AIThrottle.blockedMs() > 0) return null;
    var items = load();
    if (!items.length) return null;
    var now = Date.now();
    var tasks = API.TaskStore.load();
    var idx = items.findIndex(function(item) {
      if (item.not_before && item.not_before > now) return false;
      var task = tasks.find(function(t) { return t.id === item.id; });
      return task && allowedTypes[task.type] && task.status !== 'running';
    });
    if (idx < 0) return null;
    var next = items.splice(idx, 1)[0];
    save(items);
    return next;
  }
  function enqueue(message, opts) {
    var taskInfo = API._taskDetect(message || '');
    var id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var lockKey = API._taskLockKey(taskInfo);
    var guard = API.TaskStore.canEnqueue({ type: taskInfo.type, lockKey: lockKey });
    if (!guard.ok) {
      API.toast(guard.reason);
      return null;
    }
    if (BACKGROUND_TYPES[taskInfo.type] && generationQueuedCount() >= MAX_GENERATION_QUEUE) {
      API.toast('生成队列已满，请稍后再试');
      return null;
    }
    API.TaskStore.add({
      id: id,
      type: taskInfo.type,
      module: taskInfo.module,
      title: taskInfo.title,
      status: 'queued',
      detail: taskInfo.detail,
      date: taskInfo.date,
      filePath: taskInfo.filePath,
      lockKey: lockKey,
      sessionId: opts && opts.sessionId ? opts.sessionId : (API._aiSessionId || ''),
      threadId: opts && opts.threadId ? opts.threadId : (opts && opts.sessionId ? opts.sessionId : (API._aiSessionId || '')),
      replyTarget: 'task-card',
      error: '',
      timestamp: Date.now(),
      read: false
    });
    var items = load();
    items.push({ id: id, message: String(message || ''), opts: opts || {}, created_at: Date.now() });
    save(items);
    API._taskUpdateBadge();
    API.toast('已加入任务队列');
    drainSoon();
    return id;
  }
  function drainSoon() {
    if (API.AIExecutorPool) API.AIExecutorPool.drainSoon();
    setTimeout(drain, 80);
  }
  function drain() {
    if (API.AIExecutorPool) API.AIExecutorPool.drain();
    if (API._aiStreaming) return false;
    var blocked = API.AIThrottle.blockedMs();
    if (blocked > 0) {
      setTimeout(drain, Math.min(blocked + 120, 60000));
      return false;
    }
    var items = load();
    if (!items.length) return false;
    var now = Date.now();
    var tasks = API.TaskStore.load();
    var idx = items.findIndex(function(item) {
      if (item.not_before && item.not_before > now) return false;
      var task = tasks.find(function(t) { return t.id === item.id; });
      if (API.AIExecutorPool && API.AIExecutorPool.configuredMax() > 0 && task && BACKGROUND_TYPES[task.type]) return false;
      return true;
    });
    if (idx < 0) {
      var wait = Math.min.apply(null, items.map(function(item) { return Math.max(80, (item.not_before || now) - now); }));
      setTimeout(drain, Math.min(wait + 120, 60000));
      return false;
    }
    var next = items.splice(idx, 1)[0];
    save(items);
    API.TaskStore.update(next.id, { status: 'running', timestamp: Date.now(), read: false });
    API.TaskStore.appendLog(next.id, { type: 'progress', content: next.retry ? '限流后重试任务' : '任务开始执行' });
    API._taskUpdateBadge();
    if (!API._aiOpen) API._aiOpenSheet();
    var input = document.getElementById('aic-input');
    if (!input) return false;
    input.value = next.message || '';
    var start = function() { setTimeout(function() { API._aiSend({ taskId: next.id, sessionId: next.opts && next.opts.sessionId, threadId: next.opts && next.opts.threadId }); }, 60); };
    if (next.opts && next.opts.freshSession) API._aiNewSession().then(start).catch(start);
    else start();
    return true;
  }
  return { enqueue: enqueue, retry: retry, drain: drain, drainSoon: drainSoon, load: load, remove: remove, claimBackground: claimBackground };
})();

API.AIExecutorPool = (() => {
  var running = {};
  var DEFAULT_MAX = 2;
  var HARD_MAX = 3;
  var BG_TYPES = { generate: true, essay: true, digest: true, mock: true, redo: true };
  var unsafeTools = { spawn_expert: true, kill_expert: true, task_create: true, task_update: true, task_list: true };

  function configuredMax() {
    var raw = parseInt(localStorage.getItem('aic-bg-concurrency') || DEFAULT_MAX, 10);
    if (!isFinite(raw) || raw < 0) raw = DEFAULT_MAX;
    return Math.max(0, Math.min(HARD_MAX, raw));
  }
  function runningCount() {
    return Object.keys(running).length;
  }
  function backgroundTools() {
    if (typeof Tools === 'undefined' || !Tools.TOOL_DEFINITIONS) return [];
    return Tools.TOOL_DEFINITIONS.filter(function(tool) {
      var name = tool && tool.function && tool.function.name;
      return name && !unsafeTools[name];
    });
  }
  function drainSoon() {
    setTimeout(drain, 80);
  }
  function drain() {
    var max = configuredMax();
    if (max <= 0) return false;
    if (API.AIThrottle.blockedMs() > 0) return false;
    var started = false;
    while (runningCount() < max) {
      var item = API.AITaskQueue.claimBackground(BG_TYPES);
      if (!item) break;
      run(item);
      started = true;
    }
    return started;
  }
  async function run(item) {
    var task = API.TaskStore.load().find(function(t) { return t.id === item.id; });
    if (!task) return;
    var abort = new AbortController();
    running[item.id] = { id: item.id, abort: abort, startedAt: Date.now() };
    API.TaskStore.update(item.id, { status: 'running', timestamp: Date.now(), startedAt: Date.now(), read: false });
    API.TaskStore.appendLog(item.id, { type: 'progress', content: '后台 worker 开始执行' });
    API._taskUpdateBadge();

    var msg = String(item.message || '');
    var taskInfo = API._taskDetect(msg);
    var scenario = 'practice';
    if (taskInfo.type === 'essay' || taskInfo.type === 'essay_grade') scenario = 'essay';
    else if (taskInfo.type === 'grade') scenario = 'grading';
    else if (taskInfo.type === 'digest') scenario = 'planning';

    var lastLogAt = 0;
    var textChars = 0;
    try {
      if (API.SecureConfig) await API.SecureConfig.load();
      if (typeof AEngine === 'undefined' || typeof Prompts === 'undefined') throw new Error('AI 引擎未加载');
      var systemPrompt = Prompts.getFullPrompt(scenario);
      var result = await AEngine.runLoop(systemPrompt, msg, [], function(chunk) {
        if (chunk.type === 'text') {
          textChars += (chunk.content || '').length;
          var now = Date.now();
          if (now - lastLogAt > 1500) {
            lastLogAt = now;
            API.TaskStore.appendLog(item.id, { type: 'progress', content: '后台生成中，已接收 ' + textChars + ' 字' });
          }
        } else if (chunk.type === 'tool_start') {
          API.TaskStore.appendLog(item.id, { type: 'tool', content: '调用工具 ' + chunk.name + (chunk.label ? ' · ' + chunk.label : '') });
        } else if (chunk.type === 'tool_error') {
          API.TaskStore.appendLog(item.id, { type: 'tool_error', content: chunk.message || '工具调用失败' });
        }
      }, { signal: abort.signal, tools: backgroundTools(), skipToolReset: true, background: true });
      API.AIThrottle.noteSuccess();
      API.TaskStore.update(item.id, { status: 'done', read: false, progressText: '后台任务完成' });
      API.TaskStore.appendLog(item.id, { type: 'done', content: '后台任务完成' });
      task = API.TaskStore.load().find(function(t) { return t.id === item.id; }) || task;
      API._sessionAppendTaskSummary(task, (task.module || task.title || '练习') + '题目已生成，可以点击任务卡片查看。');
      try { document.dispatchEvent(new CustomEvent('aic-done', { detail: { taskId: item.id, type: taskInfo.type, module: taskInfo.module, date: taskInfo.date, filePath: taskInfo.filePath, stopped: false, background: true } })); } catch(e) {}
      try { document.dispatchEvent(new CustomEvent('task-done', { detail: { id: item.id, background: true } })); } catch(e2) {}
      return result;
    } catch(error) {
      if (error && error.name === 'AbortError') {
        API.TaskStore.update(item.id, { status: 'cancelled', error: '任务已取消', read: false });
        API.TaskStore.appendLog(item.id, { type: 'cancelled', content: '后台任务已取消' });
        task = API.TaskStore.load().find(function(t) { return t.id === item.id; }) || task;
        API._sessionAppendTaskSummary(task, (task.module || task.title || '任务') + '已取消。');
      } else if (API.AIThrottle.isRateLimited(error)) {
        var throttle = API.AIThrottle.noteRateLimit(error);
        var waitMs = Math.max(1000, (throttle.limitUntil || Date.now()) - Date.now());
        API.TaskStore.update(item.id, { status: 'retrying', error: error.message || '服务商限流', retryAt: throttle.limitUntil, read: false });
        API.TaskStore.appendLog(item.id, { type: 'rate_limit', content: '服务商限流，降级为串行并等待重试' });
        API.AITaskQueue.retry(item.id, msg, item.opts || {}, waitMs);
      } else {
        API.TaskStore.update(item.id, { status: 'error', error: error && error.message ? error.message : String(error), read: false });
        API.TaskStore.appendLog(item.id, { type: 'error', content: error && error.message ? error.message : String(error) });
        task = API.TaskStore.load().find(function(t) { return t.id === item.id; }) || task;
        API._sessionAppendTaskSummary(task, (task.module || task.title || '任务') + '失败：' + API._esc(task.error || '未知错误'));
        API.clearGeneratingForTask(taskInfo, msg);
        try { document.dispatchEvent(new CustomEvent('aic-failed', { detail: { taskId: item.id, type: taskInfo.type, module: taskInfo.module, date: taskInfo.date, reason: 'error', background: true } })); } catch(e3) {}
      }
    } finally {
      delete running[item.id];
      API._taskUpdateBadge();
      drainSoon();
    }
  }
  function cancel(id) {
    var worker = running[id];
    if (worker && worker.abort) worker.abort.abort();
    API.AITaskQueue.remove(id);
    API.TaskStore.update(id, { status: 'cancelled', error: '任务已取消', read: false });
    API._taskUpdateBadge();
  }
  return { drain: drain, drainSoon: drainSoon, cancel: cancel, runningCount: runningCount, configuredMax: configuredMax };
})();

// Parse message to detect task type
API._taskDetect = function(msg) {
  var type = 'chat', module = '', title = 'AI 对话', detail = '', date = '';
  var modMatch = msg.match(/(资料分析|判断推理|言语理解|数量关系|常识判断|申论)/);
  if (modMatch) module = modMatch[1];

  // Extract date from message
  var dateMatch = msg.match(/日期[：:]\s*(\d{4}-\d{2}-\d{2})/) || msg.match(/(\d{4}-\d{2}-\d{2})/);
  date = dateMatch ? dateMatch[1] : API.getLocalDate();

  if (/生成.*积累|每日积累|每日热点|每日知识点/.test(msg)) {
    type = 'digest'; title = '每日积累';
    module = '';
    detail = '每日积累 · ' + date;
  } else if (/模拟考试/.test(msg)) {
    type = 'mock';
    title = module === '申论' ? '申论模考' : (module ? module + '模考' : '模拟考试');
    detail = (module || '模考') + ' · ' + date;
  } else if (/申论.*每日|申论.*练习|申论.*题目/.test(msg)) {
    type = 'essay'; title = '申论练习';
    detail = '申论 · ' + date;
    if (!module) module = '申论';
  } else if (/每日练习|请出.*题|自定义出题|每日计划/.test(msg)) {
    type = 'generate'; title = '生成练习题';
    detail = (module || '练习') + ' · ' + date;
  } else if (/批改答案/.test(msg) && /申论/.test(msg)) {
    type = 'essay_grade'; title = '申论批改';
    detail = '申论 · ' + date;
    if (!module) module = '申论';
  } else if (/批改答案|批改模拟/.test(msg)) {
    type = 'grade'; title = '批改答案';
    detail = (module || '练习') + ' · ' + date;
    module = module || '判断推理';
  } else if (/错题重做/.test(msg)) {
    type = 'redo'; title = '错题重做';
    detail = (module || '练习') + ' · ' + date;
  }
  var filePath = '';
  if (type === 'generate' || type === 'grade' || type === 'redo') {
    filePath = '练习/' + (module || '练习') + '/' + date + '.md';
  } else if (type === 'essay' || type === 'essay_grade') {
    filePath = '申论/' + date + '.md';
  } else if (type === 'mock') {
    filePath = '练习/模拟考试/' + date + '.md';
  } else if (type === 'digest') {
    filePath = '积累/' + date + '.md';
  }
  return { type: type, module: module, title: title, detail: detail, date: date, filePath: filePath };
};

API._taskLockKey = function(taskInfo) {
  taskInfo = taskInfo || {};
  if (!taskInfo.filePath) return '';
  var project = API._activeProject ? API._activeProject() : (localStorage.getItem('zhangl-active-project') || '公考练习');
  return project + ':' + taskInfo.filePath;
};

API._taskDispatchUpdate = function(task) {
  if (!task) return;
  try {
    document.dispatchEvent(new CustomEvent('aic-task-update', {
      detail: {
        taskId: task.id,
        sessionId: task.sessionId || '',
        threadId: task.threadId || task.sessionId || '',
        status: task.status,
        type: task.type,
        module: task.module,
        date: task.date,
        filePath: task.filePath,
        title: task.title,
        detail: task.detail,
        progressText: task.progressText || task.error || ''
      }
    }));
  } catch(e) {}
};

API._sessionAttachTask = async function(sessionId, task) {
  if (!sessionId || !task || !task.id) return;
  try {
    var session = await API.Repository.getSession(sessionId);
    if (!session) return;
    session.taskRefs = Array.isArray(session.taskRefs) ? session.taskRefs : [];
    var ref = session.taskRefs.find(function(item) { return item.taskId === task.id; });
    var data = {
      taskId: task.id,
      type: task.type,
      module: task.module || '',
      date: task.date || '',
      status: task.status,
      title: task.title || '',
      detail: task.detail || '',
      filePath: task.filePath || '',
      createdAt: task.createdAt || task.timestamp || Date.now(),
      updatedAt: Date.now()
    };
    if (ref) Object.assign(ref, data);
    else session.taskRefs.unshift(data);
    session.taskRefs = session.taskRefs.slice(0, 30);
    await API.Repository.saveSession(session);
  } catch(e) { console.warn('[sessionAttachTask]', e); }
};

API._sessionSyncTask = async function(task) {
  if (!task || !task.sessionId) return;
  await API._sessionAttachTask(task.sessionId, task);
};

API._sessionAppendTaskSummary = async function(task, text) {
  if (!task || !task.sessionId || !text) return;
  try {
    var session = await API.Repository.getSession(task.sessionId);
    if (!session) return;
    session.messages = Array.isArray(session.messages) ? session.messages : [];
    var marker = '[task-summary:' + task.id + ']';
    if (session.messages.some(function(m) { return m && m.role === 'assistant' && typeof m.content === 'string' && m.content.indexOf(marker) >= 0; })) return;
    session.messages.push({ role: 'assistant', content: marker + '\n' + text, ts: Date.now() });
    await API.Repository.saveSession(session);
    if (task.sessionId === API._aiSessionId) {
      var msgs = document.getElementById('aic-msgs');
      if (msgs) {
        msgs.insertAdjacentHTML('beforeend', '<div style="display:flex;gap:8px;margin:4px 0"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:14px;height:14px;color:var(--accent)"></i></div><div class="md-body" style="flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px">'+API._md(text)+'</div></div>');
        msgs.scrollTop = msgs.scrollHeight;
        lucide.createIcons();
      }
    }
  } catch(e) { console.warn('[sessionTaskSummary]', e); }
};

API._stripTaskSummaryMarker = function(content) {
  return String(content || '').replace(/^\[task-summary:[^\]]+\]\s*\n?/, '');
};

// Navigate to the page associated with a task
API._taskNavigate = function(task) {
  if (task && task.type !== 'chat') API._aiCloseSheet();
  switch (task.type) {
    case 'generate':
    case 'grade':
    case 'redo':
      // Use smart mode to auto-detect module if task doesn't specify one
      if (task.module) {
        localStorage.setItem('mp-target-module', task.module);
        localStorage.setItem('mp-practice-mode', 'direct');
      } else {
        localStorage.setItem('mp-practice-mode', 'smart');
      }
      localStorage.setItem('mp-practice-date', task.date || API.getLocalDate());
      API.pushPage('practice-card');
      break;
    case 'mock':
      localStorage.setItem('mp-practice-date', task.date || API.getLocalDate());
      localStorage.setItem('mp-practice-mode', 'mock');
      API.pushPage('practice-card');
      break;
    case 'essay':
    case 'essay_grade':
      localStorage.setItem('es-date', task.date || API.getLocalDate());
      API.pushPage('essay');
      break;
    case 'digest':
      API.pushPage('digest');
      break;
    default:
      API.openAIChat(''); // chat: just open AI sheet
  }
  // Close task panel
  var overlay = document.getElementById('task-panel-overlay');
  if (overlay) overlay.remove();
};

// Task panel (bottom sheet)
API.openTaskPanel = function() {
  var tasks = API._taskLoad();
  var overlay = document.createElement('div');
  overlay.className = 'task-panel-overlay';
  overlay.id = 'task-panel-overlay';

  function renderList() {
    var list = overlay.querySelector('.task-panel-list');
    var items = API._taskLoad();
    if (!items.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = items.map(function(t) {
      var icon, iconColor;
      if (t.status === 'running') { icon = 'loader'; iconColor = 'var(--accent)'; }
      else if (t.status === 'queued') { icon = 'clock'; iconColor = 'var(--orange)'; }
      else if (t.status === 'retrying') { icon = 'timer-reset'; iconColor = 'var(--orange)'; }
      else if (t.status === 'paused') { icon = 'pause-circle'; iconColor = 'var(--orange)'; }
      else if (t.status === 'error' || t.status === 'failed') { icon = 'x-circle'; iconColor = 'var(--red)'; }
      else if (t.status === 'stopped' || t.status === 'cancelled' || t.status === 'interrupted') { icon = 'stop-circle'; iconColor = 'var(--text-secondary)'; }
      else { icon = 'check-circle'; iconColor = 'var(--green)'; }
      // Task type prefix icon
      var typeIcon = '';
      if (t.type === 'generate' || t.type === 'redo') typeIcon = '<i data-lucide="edit-3" style="width:12px;height:12px;color:var(--text-secondary);margin-right:4px;vertical-align:-1px"></i>';
      else if (t.type === 'essay' || t.type === 'essay_grade') typeIcon = '<i data-lucide="file-text" style="width:12px;height:12px;color:var(--text-secondary);margin-right:4px;vertical-align:-1px"></i>';
      else if (t.type === 'mock') typeIcon = '<i data-lucide="monitor" style="width:12px;height:12px;color:var(--text-secondary);margin-right:4px;vertical-align:-1px"></i>';
      else if (t.type === 'digest') typeIcon = '<i data-lucide="book-open" style="width:12px;height:12px;color:var(--text-secondary);margin-right:4px;vertical-align:-1px"></i>';
      var rowClass = (t.status === 'running' || t.status === 'retrying') ? 'running' : (t.read ? '' : 'unread');
      var ago = API._timeAgo(t.timestamp);
      var statusText = '';
      if (t.status === 'retrying' && t.retryAt) statusText = '限流重试 ' + Math.max(0, Math.ceil((t.retryAt - Date.now()) / 1000)) + 's';
      else if (t.status === 'queued') statusText = '排队中';
      else if (t.status === 'running') statusText = '运行中';
      else if (t.status === 'interrupted') statusText = '已中断';
      else if (t.status === 'error' || t.status === 'failed') statusText = '失败';
      return '<div class="task-row '+rowClass+'" data-id="'+t.id+'">'+
        '<i data-lucide="'+icon+'" class="task-icon" style="color:'+iconColor+'"></i>'+
        '<div class="task-body"><div class="task-title">'+typeIcon+API._esc(t.title)+'</div>'+
        (t.detail || statusText ? '<div class="task-detail">'+API._esc([t.detail, statusText].filter(Boolean).join(' · '))+'</div>' : '')+
        '</div><span class="task-time">'+ago+'</span></div>';
    }).join('');
    lucide.createIcons();
  }

  function dismiss() {
    overlay.remove();
    // Mark all as read (but not running ones)
    var tasks = API._taskLoad();
    var changed = false;
    tasks.forEach(function(t) { if (t.status !== 'running' && !t.read) { t.read = true; changed = true; } });
    if (changed) { API._taskSave(tasks); API._taskUpdateBadge(); }
  }

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) dismiss();
  });

  overlay.innerHTML =
    '<div class="task-panel">'+
      '<div class="task-panel-header">'+
        '<i data-lucide="bell" style="width:18px;height:18px;color:var(--accent);margin-right:6px"></i>'+
        '<span class="tp-title">任务消息</span>'+
        (tasks.length ? '<button id="tp-clear">清除全部</button>' : '')+
      '</div>'+
      '<div class="task-panel-list"></div>'+
      '<div class="task-panel-footer"><button id="tp-close">关闭</button></div>'+
    '</div>';

  document.body.appendChild(overlay);
  lucide.createIcons();
  renderList();

  document.getElementById('tp-clear') && (document.getElementById('tp-clear').onclick = function() {
    API._taskClear();
    dismiss();
  });
  document.getElementById('tp-close').onclick = dismiss;

  // Click row to navigate to result
  overlay.querySelector('.task-panel-list').addEventListener('click', function(e) {
    var row = e.target.closest('.task-row');
    if (!row) return;
    var id = row.dataset.id;
    var tasks = API._taskLoad();
    var found = tasks.find(function(t) { return t.id === id; });
    if (found) {
      // Mark as read
      if (found.status !== 'running' && !found.read) {
        found.read = true;
        API._taskSave(tasks);
        API._taskUpdateBadge();
      }
      // Navigate
      API._taskNavigate(found);
    }
  });
};

API._timeAgo = function(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
  return Math.floor(diff/86400000) + ' 天前';
};

// ── Task bell — injected into every page's navbar ──
API._taskInject = function() {
  document.querySelectorAll('.navbar').forEach(function(nav) {
    if (nav.querySelector('[data-task-bell]')) return;
    var btn = document.createElement('button');
    btn.setAttribute('data-task-bell', '');
    btn.setAttribute('aria-label', '任务消息');
    btn.innerHTML = '<i data-lucide="bell"></i><span class="task-badge"></span>';
    btn.onclick = function(e) { e.stopPropagation(); API.openTaskPanel(); };
    // Insert before last child so it doesn't overlap with 3-dot menu
    var last = nav.lastElementChild;
    if (last && last.tagName === 'SPAN') {
      nav.insertBefore(btn, last);
    } else {
      nav.appendChild(btn);
    }
  });
  lucide.createIcons();
  API._taskUpdateBadge();
};

// Tab bar
API.renderTabs = function(active) {
  var tabs = [
    { id: 'home', icon: 'home', label: '首页' },
    { id: 'practice', icon: 'edit-3', label: '刷题' },
    { id: 'exam', icon: 'monitor', label: '模考' },
    { id: 'wrongbook', icon: 'book-open', label: '错题本' },
    { id: 'profile', icon: 'user', label: '我的' },
  ];
  return tabs.map(function(t) {
    var isActive = t.id === active;
    var isShell = !!document.getElementById('sp-home');
    var onclick = isShell ? 'API.switchTab(\''+t.id+'\')' : 'location.href=\''+t.id+'.html\'';
    return '<div class="tab-item'+(isActive?' active':'')+'" onclick="'+onclick+'">'+
      '<i data-lucide="'+t.icon+'" style="width:22px;height:22px"></i><span>'+t.label+'</span></div>';
  }).join('');
};

API.initPage = async function(activeTab) {
  API.IOSViewport.init();
  API.StyleGuard.init();
  API.applyThemePreference(localStorage.getItem('zhangl-theme') || 'light');
  API.applyFontPreference(localStorage.getItem(API.KEYS.font) || '标准');
  var isShell = !!document.getElementById('sp-home');
  if (!document.getElementById('aic-bubble')) API._aiInject();
  API._taskInject();

  if (isShell) return; // Shell manages itself

  // Only redirect if current page IS a tab page (not a sub-page like practice-card)
  var tabPages = ['home','practice','exam','wrongbook','profile'];
  var currentPage = location.pathname.split('/').pop().replace('.html', '');
  if (tabPages.indexOf(currentPage) >= 0) {
    location.replace('index.html#' + currentPage);
    return;
  }

  // Standalone sub-page: render tabs normally
  document.querySelector('.tabs').innerHTML = API.renderTabs(activeTab);
  lucide.createIcons();
  API._taskUpdateBadge();
};

// ===== AI 气泡 + 底部半屏面板 (自动注入，贯穿所有页面) =====
API._aiSessionId = '';
API._aiStreaming = false;
API._aiAbort = null;
API._aiOpen = false;

API._aiInject = function() {
  // Bubble (draggable)
  var bubble = document.createElement('button');
  bubble.id = 'aic-bubble';
  bubble.setAttribute('aria-label', 'AI 助手');
  bubble.innerHTML = '<i data-lucide="bot" style="width:22px;height:22px" aria-hidden="true"></i>';

  // Drag to move (touch) + click to open (mouse)
  var bd = { x: 0, y: 0, startX: 0, startY: 0, dragging: false, moved: false };
  var dragStart = function(ex, ey) {
    bd.originX = ex; bd.originY = ey;
    bd.dragging = true; bd.moved = false;
    bubble.style.transition = 'none';
    bubble.style.transform = 'none'; // kill :active scale so rect is accurate
    var r = bubble.getBoundingClientRect();
    bd.bubbleX = r.left; bd.bubbleY = r.top;
  };
  var dragMove = function(ex, ey) {
    if (!bd.dragging) return;
    if (Math.abs(ex - bd.originX) > 5 || Math.abs(ey - bd.originY) > 5) bd.moved = true;
    if (!bd.moved) return;
    var nl = bd.bubbleX + (ex - bd.originX);
    var nt = bd.bubbleY + (ey - bd.originY);
    nl = Math.max(8, Math.min(window.innerWidth - 58, nl));
    nt = Math.max(60, Math.min(window.innerHeight - 130, nt));
    bubble.style.left = nl + 'px'; bubble.style.top = nt + 'px';
    bubble.style.right = 'auto'; bubble.style.bottom = 'auto';
    localStorage.setItem('aic-bubble-x', nl);
    localStorage.setItem('aic-bubble-y', nt);
  };
  var dragEnd = function() {
    bubble.style.transition = 'transform .15s, box-shadow .15s';
    bubble.style.transform = '';
    bd.dragging = false;
  };

  // Touch events for mobile drag
  bubble.addEventListener('touchstart', function(e) { dragStart(e.touches[0].clientX, e.touches[0].clientY); }, {passive: false});
  bubble.addEventListener('touchmove', function(e) { e.preventDefault(); dragMove(e.touches[0].clientX, e.touches[0].clientY); }, {passive: false});
  bubble.addEventListener('touchend', function(e) { dragEnd(); if (!bd.moved) API._aiOpenSheet(); });

  // Mouse events for desktop
  bubble.addEventListener('mousedown', function(e) { dragStart(e.clientX, e.clientY); });
  document.addEventListener('mousemove', function(e) { if (bd.dragging) dragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', function() {
    if (!bd.dragging) return; dragEnd();
    if (!bd.moved) API._aiOpenSheet();
  });

  // Click fallback (ensures tap always works)
  bubble.addEventListener('click', function(e) { if (!bd.moved) API._aiOpenSheet(); });
  var savedX = parseInt(localStorage.getItem('aic-bubble-x'));
  var savedY = parseInt(localStorage.getItem('aic-bubble-y'));
  if (savedX && savedY) {
    bubble.style.left = savedX + 'px';
    bubble.style.top = savedY + 'px';
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
  }

  document.body.appendChild(bubble);

  // Backdrop
  var backdrop = document.createElement('div');
  backdrop.id = 'aic-backdrop';
  backdrop.onclick = API._aiCloseSheet;
  document.body.appendChild(backdrop);

  // Sheet
  var sheet = document.createElement('div');
  sheet.id = 'aic-sheet';
  sheet.innerHTML =
  // Drag handle
  '<div id="aic-handle" style="display:flex;justify-content:center;padding:8px 0 2px;cursor:grab;flex-shrink:0"><div style="width:36px;height:4px;border-radius:2px;background:var(--border)"></div></div>'+
  // Header
  '<div style="display:flex;align-items:center;padding:4px 16px 8px;gap:6px;flex-shrink:0">'+
    '<span id="aic-status-dot" style="width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0"></span>'+
	    '<span id="aic-status-text" style="font-size:11px;color:var(--text-secondary);flex-shrink:0">就绪</span>'+
	    '<span style="flex:1"></span>'+
	    '<button onclick="API._aiNewSession()" title="新建会话" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:4px;display:flex;flex-shrink:0"><i data-lucide="message-square-plus" style="width:16px;height:16px"></i></button>'+
    '<div style="position:relative">'+
      '<button id="aic-session-btn" onclick="API._aiToggleSessions()" style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;color:var(--text);cursor:pointer;font-size:11px;padding:4px 8px;font-family:inherit;display:flex;align-items:center;gap:3px;max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">'+
        '<i data-lucide="message-square" style="width:12px;height:12px;flex-shrink:0"></i><span id="aic-session-label" style="overflow:hidden;text-overflow:ellipsis">会话</span><i data-lucide="chevron-down" style="width:10px;height:10px;flex-shrink:0"></i></button>'+
	      '<div id="aic-session-list" style="display:none;position:absolute;top:100%;right:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:100;max-height:180px;overflow-y:auto;margin-top:4px;font-size:11px;min-width:130px"></div>'+
	    '</div>'+
	    '<button onclick="API._aiCloseSheet()" title="收起" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:4px;display:flex;flex-shrink:0"><i data-lucide="chevron-down" style="width:17px;height:17px"></i></button>'+
	  '</div>'+
	  // Thinking panel
	  '<div id="aic-thinking" class="aic-thinking collapsed" style="display:none">'+
	    '<button class="aic-thinking-toggle" title="执行过程">'+
	      '<span class="aic-thinking-line"></span><span class="aic-thinking-title">过程</span><span id="aic-think-chevron" class="aic-thinking-grip" aria-hidden="true"></span><span class="aic-thinking-line"></span>'+
	    '</button>'+
	    '<div id="aic-thinking-preview" class="aic-thinking-preview"><div id="aic-thinking-preview-track" class="aic-thinking-preview-track"></div></div>'+
	    '<div id="aic-thinking-body" class="aic-thinking-body" style="display:none"></div>'+
	  '</div>'+
	  // Messages
	  '<div id="aic-msgs" style="flex:1;overflow-y:auto;padding:8px 16px">'+
	    '<div style="display:flex;gap:8px"><div style="width:26px;height:26px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:14px;height:14px;color:var(--accent)"></i></div>'+
	    '<div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">AI 助手</div>'+
	    '<div style="font-size:13px;line-height:1.6;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px"><strong>你好！我是公考AI助手</strong><br>学习闭环：<strong>学透→练习→批改→掌握</strong></div></div></div>'+
	  '</div>'+
	  '<div id="aic-task-strip" class="aic-task-popover" style="display:none"></div>'+
	  // Input
	  '<div style="padding:6px 16px;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;padding-bottom:max(4px, calc(env(safe-area-inset-bottom) - 8px))">'+
	    '<textarea id="aic-input" placeholder="输入问题，或让 AI 出题 / 批改" rows="1" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:12px;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:80px;line-height:1.4;color:var(--text);background:var(--bg);margin-bottom:6px" oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,80)+\'px\'"></textarea>'+
	    '<div style="display:flex;align-items:center;gap:6px">'+
	      '<input type="file" id="aic-file-input" accept=".txt,.md,.json,.yaml,.pdf,.png,.jpg,.jpeg,.gif,.webp" multiple onchange="API._aiHandleFiles(this)" style="display:none">'+
	      '<button onclick="document.getElementById(\'aic-file-input\').click()" title="上传文件" style="width:32px;height:32px;padding:0;border:none;background:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;border-radius:8px;flex-shrink:0"><i data-lucide="paperclip" style="width:18px;height:18px"></i></button>'+
	      '<label id="aic-thinking-pill" onclick="var t=document.getElementById(\'aic-thinking-toggle\');t.checked=!t.checked;this.classList.toggle(\'active\',t.checked)" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--border);border-radius:16px;font-size:11px;color:var(--text-secondary);cursor:pointer;font-family:inherit;flex-shrink:0;user-select:none" title="深度思考">'+
	        '<input type="checkbox" id="aic-thinking-toggle" style="display:none">'+
	        '<i data-lucide="brain" style="width:13px;height:13px"></i><span>思考</span></label>'+
	      '<button id="aic-task-entry" onclick="API._aiToggleTaskStrip()" title="后台任务" style="display:none;height:32px;border:1px solid var(--border);border-radius:16px;background:var(--surface2);color:var(--text-secondary);font-size:11px;font-family:inherit;padding:0 10px;align-items:center;gap:4px;flex-shrink:0"><i data-lucide="activity" style="width:13px;height:13px"></i><span>Task 0/0</span></button>'+
	      '<span style="flex:1"></span>'+
	      '<span id="aic-file-badge" style="display:none;font-size:10px;color:var(--accent);background:var(--accent-soft);padding:2px 8px;border-radius:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>'+
	      '<button id="aic-send-btn" onclick="API._aiSend()" style="width:34px;height:34px;border:none;border-radius:50%;background:var(--accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="send" style="width:16px;height:16px"></i></button>'+
      '<button id="aic-stop-btn" onclick="API._aiStop()" style="display:none;width:34px;height:34px;border:none;border-radius:50%;background:var(--red);color:#fff;cursor:pointer;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="square" style="width:14px;height:14px"></i></button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(sheet);

  // Input handlers
  document.getElementById('aic-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); API._aiSend(); }
  });
  document.getElementById('aic-thinking').addEventListener('click', function(e) {
    if (e.target.closest('.aic-thinking-body')) return;
    API._aiToggleThinking();
  });
	  document.getElementById('aic-task-strip').addEventListener('click', function(e) {
	    var btn = e.target.closest('[data-aic-task-action]');
	    var card = e.target.closest('[data-aic-task-id]');
	    var id = btn ? btn.getAttribute('data-task-id') : (card ? card.getAttribute('data-aic-task-id') : '');
	    var action = btn ? btn.getAttribute('data-aic-task-action') : (card ? 'open' : '');
	    if (action === 'toggle-strip') {
	      API._aiToggleTaskStrip();
	      return;
	    }
	    if (!id && (e.target.closest('.aic-task-popover-head') || !this.classList.contains('open'))) {
	      API._aiToggleTaskStrip();
	      return;
	    }
	    if (!id) return;
	    var task = API._taskLoad().find(function(t) { return t.id === id; });
	    if (!task) return;
	    if (action === 'cancel') {
	      e.stopPropagation();
	      if (API.AIExecutorPool) API.AIExecutorPool.cancel(id);
	      else { API.AITaskQueue.remove(id); API.TaskStore.update(id, { status: 'cancelled', error: '任务已取消', read: false }); }
	      API._aiRenderTaskCards();
	    } else if (action === 'open') {
	      API._taskNavigate(task);
    }
	  });
	  document.getElementById('aic-task-strip').addEventListener('keydown', function(e) {
	    if (e.key !== 'Enter' && e.key !== ' ') return;
	    var card = e.target.closest('[data-aic-task-id]');
	    if (!card) return;
	    e.preventDefault();
	    var id = card.getAttribute('data-aic-task-id');
	    var task = API._taskLoad().find(function(t) { return t.id === id; });
	    if (task) API._taskNavigate(task);
	  });
  // Close session list on outside click
  document.addEventListener('click', function(e) {
    var list = document.getElementById('aic-session-list');
    if (list && !e.target.closest('#aic-session-btn')) list.style.display = 'none';
  });

  // Drag to dismiss
  API._aiSetupDrag();

  document.addEventListener('aic-task-update', function(e) {
    var detail = e.detail || {};
    if (!detail.sessionId || detail.sessionId !== API._aiSessionId) return;
    API._aiRenderTaskCards();
  });

  // Init session on first inject
  lucide.createIcons();
  API._aiInitSession();
};

API._aiOpenSheet = function() {
  document.getElementById('aic-backdrop').classList.add('open');
  document.getElementById('aic-sheet').classList.add('open');
  document.getElementById('aic-bubble').classList.remove('has-reply');
  API._aiOpen = true;
  // Don't auto-focus — user taps to type. Preset messages still send via _aiSend().
};

API._aiCloseSheet = function() {
  document.getElementById('aic-backdrop').classList.remove('open');
  document.getElementById('aic-sheet').classList.remove('open');
  API._aiOpen = false;
  // Don't abort - AI keeps running in background, bubble shows working state
};

API._aiSetupDrag = function() {
  var sheet = document.getElementById('aic-sheet');
  var handle = document.getElementById('aic-handle');
  var sY = 0, sTop = 0, dragging = false;
  var minTop = window.innerHeight * 0.1;  // can't drag higher than 10%
  var defaultTop = window.innerHeight * 0.25; // default position
  var dismissThreshold = 80; // drag down > 80px → close

  var hStart = function(ey) { sY = ey; sTop = sheet.getBoundingClientRect().top; dragging = true; sheet.style.transition = 'none'; };
  var hMove = function(ey) {
    if (!dragging) return;
    var newTop = sTop + (ey - sY);
    // Clamp: can't go above 10% or below screen
    sheet.style.top = Math.max(minTop, Math.min(newTop, window.innerHeight)) + 'px';
  };
  var hEnd = function(ey) {
    dragging = false;
    sheet.style.transition = 'top 0.3s ease';
    var delta = ey - sY;
    // Close if dragged down significantly
    if (delta > dismissThreshold) {
      API._aiCloseSheet();
      sheet.style.top = '';
      return;
    }
    // Snap: if dragged up past halfway between default and min, snap to max
    var currentTop = parseInt(sheet.style.top);
    var midPoint = (minTop + defaultTop) / 2;
    if (currentTop < midPoint) {
      sheet.style.top = minTop + 'px';
    } else {
      sheet.style.top = ''; // reset to CSS default
    }
  };

  handle.addEventListener('touchstart', function(e) { hStart(e.touches[0].clientY); }, {passive: false});
  handle.addEventListener('touchmove', function(e) { e.preventDefault(); hMove(e.touches[0].clientY); }, {passive: false});
  handle.addEventListener('touchend', function(e) { hEnd(e.changedTouches[0].clientY); });

  handle.addEventListener('mousedown', function(e) { hStart(e.clientY); });
  document.addEventListener('mousemove', function(e) { if (dragging) hMove(e.clientY); });
  document.addEventListener('mouseup', function(e) { if (dragging) hEnd(e.clientY); });
};

// Renderer libraries are loaded only by pages that render Markdown, or when
// the AI panel is first used. This keeps the shell's initial route lightweight.
API._ensureOptionalScript = function(src) {
  var name = src.replace(/[^a-z0-9]/gi, '-');
  if (src.indexOf('marked') >= 0 && typeof marked !== 'undefined') return Promise.resolve();
  if (src.indexOf('mermaid') >= 0 && typeof mermaid !== 'undefined') return Promise.resolve();
  var existing = document.querySelector('script[data-optional-script="' + name + '"]');
  if (existing) return new Promise(function(resolve) {
    if (existing.dataset.loaded === '1') return resolve();
    existing.addEventListener('load', resolve, { once: true });
    existing.addEventListener('error', resolve, { once: true });
  });
  return new Promise(function(resolve) {
    var script = document.createElement('script');
    script.src = src; script.async = false; script.dataset.optionalScript = name;
    script.onload = function() { script.dataset.loaded = '1'; resolve(); };
    script.onerror = resolve;
    document.head.appendChild(script);
  });
};

// Open with preset message (called from external code)
API.openAIChat = function(msg, opts) {
  opts = opts || {};
  if (msg && API._aiStreaming) {
    API._aiEnsureSession().then(function(sessionId) {
      opts.sessionId = opts.sessionId || sessionId;
      opts.threadId = opts.threadId || sessionId;
      API.AITaskQueue.enqueue(msg, opts);
    }).catch(function() {
      API.AITaskQueue.enqueue(msg, opts);
    });
    return true;
  }
  if (!API._aiOpen) API._aiOpenSheet();
  if (msg) {
    var input = document.getElementById('aic-input');
    if (input) { input.value = msg; }
    // Create fresh session if requested (for grading etc.)
    var send = function() {
      if (opts.freshSession) API._aiNewSession().then(function() { setTimeout(function() { API._aiSend(); }, 100); });
      else setTimeout(function() { API._aiSend(); }, 100);
    };
    API._ensureOptionalScript('marked.js').then(send);
  }
  return true;
};

API._aiEnsureSession = async function() {
  if (API._aiSessionId) return API._aiSessionId;
  var proj = API._activeProject();
  var id = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  var session = { id: id, name: '移动端会话', project: proj, messages: [], taskRefs: [], created: new Date().toISOString() };
  await API.Repository.saveSession(session);
  API._aiSessionId = id;
  var lbl = document.getElementById('aic-session-label'); if (lbl) lbl.textContent = '新会话';
  API._aiLoadSessionList();
  API._aiRenderTaskCards();
  return id;
};

// ===== Session Management =====
API._aiInitSession = async function() {
  try {
    var proj = API._activeProject();
    var sessions = await API.Repository.listSessions(proj);
    // Find current or most recent session
    var current = sessions.find(function(s) { return s.id === API._aiSessionId; });
    if (!current && sessions.length) current = sessions[sessions.length - 1];
    if (current) {
      API._aiSessionId = current.id;
      if (current.messages && current.messages.length > 0) {
        var msgs = document.getElementById('aic-msgs');
        msgs.innerHTML = '';
        current.messages.forEach(function(m) {
          if (m.role === 'system') return;  // never render system prompt
          if (m.role === 'tool') return;  // never render tool results
          if (m.role === 'assistant' && !m.content) return;  // skip tool_calls-only assistant
          if (m.role === 'user') {
            msgs.innerHTML += '<div style="display:flex;justify-content:flex-end;margin:4px 0"><div style="max-width:80%;padding:8px 12px;background:var(--accent-soft);border-radius:14px 14px 3px 14px;font-size:13px;line-height:1.5;color:var(--text)">'+API._esc(m.content)+'</div></div>';
          } else {
            var html = API._md(API._stripTaskSummaryMarker(m.content));
            msgs.innerHTML += '<div style="display:flex;gap:8px;margin:4px 0"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:14px;height:14px;color:var(--accent)"></i></div><div class="md-body" style="flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px">'+html+'</div></div>';
          }
        });
        msgs.scrollTop = msgs.scrollHeight;
        lucide.createIcons();
      }
    }
    API._aiLoadSessionList();
    API._aiRenderTaskCards();
  } catch(e) {}
};

API._aiLoadSessionList = async function() {
  try {
    var proj = API._activeProject();
    var sessions = await API.Repository.listSessions(proj);
    if (!sessions || !sessions.length) return;
    var label = document.getElementById('aic-session-label');
    var current = sessions.find(function(s) { return s.id === API._aiSessionId; });
    if (current && label) label.textContent = API._esc((current.name || current.id.slice(0,8)).slice(0,14));
    var list = document.getElementById('aic-session-list');
    if (!list) return;
    list.innerHTML = sessions.map(function(s) {
      var isCur = s.id === API._aiSessionId;
      // Escape id for use inside onclick JS string literal; escape name for HTML text node
      var idJs = API.escapeJs(s.id);
      var nameHtml = API._esc(s.name || s.id.slice(0,8));
      return '<div style="display:flex;align-items:center;padding:6px 10px;cursor:pointer;'+(isCur?'background:var(--accent-soft);font-weight:600;color:var(--accent)':'')+'" onclick="API._aiSwitchSession(\''+idJs+'\')">'+
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+nameHtml+' <span style="color:var(--text-secondary);font-size:9px">'+((s.messages&&s.messages.length)||0)+'</span></span>'+
        (!isCur ? '<span onclick="event.stopPropagation();API._aiDeleteSession(\''+idJs+'\')" style="color:var(--text-secondary);cursor:pointer;padding:2px 4px;font-size:14px">×</span>' : '<span style="font-size:8px;color:var(--accent)">当前</span>')+
        '</div>';
    }).join('') +
    '<div style="position:sticky;bottom:0;background:var(--surface);padding:4px 8px;border-top:1px solid var(--border-light)">'+
      '<button onclick="API._aiClearAllSessions()" style="width:100%;text-align:center;font-size:10px;padding:4px 0;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-family:inherit;border-radius:4px">清除所有历史会话</button>'+
    '</div>';
  } catch(e) { console.warn('[aiLoadSessionList]', e); }
};

API._aiClearAllSessions = function() {
  API.confirm('清除会话', '确定要清除所有历史会话吗？（当前会话保留）', async function() {
    try {
    var proj = API._activeProject();
    var sessions = await API.Repository.listSessions(proj);
    for (var i = 0; i < (sessions||[]).length; i++) {
      if (sessions[i].id !== API._aiSessionId) {
        await API.Repository.deleteSession(sessions[i].id);
      }
    }
    document.getElementById('aic-session-list').style.display = 'none';
    API._aiLoadSessionList();
    API.toast('已清除');
    } catch(e) { API.toast('清除失败'); }
  });
};

API._aiToggleSessions = function() {
  var list = document.getElementById('aic-session-list');
  if (list) { list.style.display = list.style.display === 'none' ? 'block' : 'none'; API._aiLoadSessionList(); }
};

API._aiSwitchSession = async function(id) {
  if (id === API._aiSessionId) return;
  if (API._aiStreaming) API._aiStop();
  try {
    API._aiSessionId = id;
    var sl = document.getElementById('aic-session-list'); if (sl) sl.style.display = 'none';
    // Reload messages from LocalStore
    var session = await API.Repository.getSession(id);
    var data = session || { messages: [] };
    var msgs = document.getElementById('aic-msgs');
    if (!msgs) return;
    msgs.innerHTML = '';
    if (data.messages) data.messages.forEach(function(m) {
      if (m.role === 'system') return;  // never render system prompt
      if (m.role === 'tool') return;  // never render tool results
      if (m.role === 'assistant' && !m.content) return;  // skip tool_calls-only assistant
      if (m.role === 'user') {
        msgs.innerHTML += '<div style="display:flex;justify-content:flex-end;margin:4px 0"><div style="max-width:80%;padding:8px 12px;background:var(--accent-soft);border-radius:14px 14px 3px 14px;font-size:13px;line-height:1.5;color:var(--text)">'+API._esc(m.content)+'</div></div>';
      } else {
        var html = API._md(API._stripTaskSummaryMarker(m.content));
        msgs.innerHTML += '<div style="display:flex;gap:8px;margin:4px 0"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:14px;height:14px;color:var(--accent)"></i></div><div class="md-body" style="flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px">'+html+'</div></div>';
      }
    });
    msgs.scrollTop = msgs.scrollHeight;
    lucide.createIcons();
    API._aiLoadSessionList();
    API._aiRenderTaskCards();
  } catch(e) { console.warn('[aiSwitchSession]', e); API.toast('切换会话失败'); }
};

API._aiNewSession = async function() {
  if (API._aiStreaming) API._aiStop();
  try {
    var proj = API._activeProject();
    var id = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    var session = { id: id, name: '移动端会话', project: proj, messages: [], taskRefs: [], created: new Date().toISOString() };
    await API.Repository.saveSession(session);
    API._aiSessionId = id;
	    document.getElementById('aic-session-label').textContent = '新会话';
	    document.getElementById('aic-msgs').innerHTML = '<div style="display:flex;gap:8px"><div style="width:28px;height:28px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:16px;height:16px;color:var(--accent)"></i></div><div style="flex:1;min-width:0;font-size:13px;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px">新会话已开始，有什么可以帮你的？</div></div>';
	    document.getElementById('aic-thinking').style.display = 'none';
	    document.getElementById('aic-thinking-body').innerHTML = '';
	    var preview = document.getElementById('aic-thinking-preview-track');
	    if (preview) { preview.textContent = ''; preview.removeAttribute('data-items'); }
	    API._aiRenderTaskCards();
    API._aiLoadSessionList();
    lucide.createIcons();
    API.toast('新会话已创建');
  } catch(e) { API.toast('创建会话失败'); }
};

API._aiDeleteSession = async function(id) {
  try {
    await API.Repository.deleteSession(id);
    if (id === API._aiSessionId) {
      API._aiSessionId = '';
      var m = document.getElementById('aic-msgs'); if (m) m.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px">会话已删除，请新建会话</div>';
    }
    API._aiLoadSessionList();
  } catch(e) { console.warn('[aiDeleteSession]', e); API.toast('删除失败'); }
};

// ===== Thinking Panel =====
API._aiTools = []; // {id, name, label, status: 'pending'|'done'|'error'}

API._aiToggleThinking = function() {
  var panel = document.getElementById('aic-thinking');
  var body = document.getElementById('aic-thinking-body');
  var chevron = document.getElementById('aic-think-chevron');
  if (!panel || !body) return;
  var collapsed = panel.classList.contains('collapsed');
  if (collapsed) {
    panel.classList.remove('collapsed');
    body.style.display = '';
    if (chevron) chevron.style.opacity = '.62';
  } else {
    panel.classList.add('collapsed');
    body.style.display = 'none';
    if (chevron) chevron.style.opacity = '.42';
  }
};

API._aiUpdateThinkPreview = function(text) {
  var track = document.getElementById('aic-thinking-preview-track');
  if (!track) return;
  var clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  track.setAttribute('data-latest', clean);
  track.textContent = clean;
};

API._aiAddThink = function(type, data) {
  var panel = document.getElementById('aic-thinking');
  var body = document.getElementById('aic-thinking-body');
  if (panel) panel.style.display = '';
  if (!body) return;

  if (type === 'tool_start') {
    if (panel) panel.classList.add('running');
    var id = 't'+Date.now()+Math.random().toString(36).slice(2,5);
    var short = data.name || '';
    var label = data.label || '';
    var expert = data.expert_id ? '<span class="aic-tool-chip">'+API._esc(data.expert_id.slice(0,12))+'</span>' : '';
    var title = label || short || '执行工具';
    body.innerHTML += '<div class="aic-tool-row running" id="'+id+'">'+
      '<span class="aic-tool-status"><span class="aic-dot-pulse"></span></span>'+
      '<div class="aic-tool-main">'+
        '<div class="aic-tool-top"><span class="aic-tool-name">'+API._esc(short || 'tool')+'</span>'+expert+'</div>'+
        '<div class="aic-tool-label">'+API._esc(title)+'</div>'+
      '</div>'+
      '</div>';
    var toolInfo = {id:id, name:short || 'tool', label:title, status:'pending'};
    API._aiTools.push(toolInfo);
    API._aiUpdateThinkPreview(_toolPreviewText(toolInfo, '执行中'));
    body.scrollTop = body.scrollHeight;
  } else if (type === 'tool_done') {
    // Mark all pending tools as done
    API._aiTools.forEach(function(t) {
      if (t.status === 'pending') { t.status = 'done'; updateToolRow(t, 'done', ''); }
    });
    if (panel && !API._aiTools.some(function(t) { return t.status === 'pending'; })) panel.classList.remove('running');
  } else if (type === 'tool_error') {
    API._aiTools.forEach(function(t) {
      if (t.status === 'pending') { t.status = 'error'; updateToolRow(t, 'error', data.message||''); }
    });
    if (panel) panel.classList.remove('running');
  } else if (type === 'thinking') {
    var content = data.content || data;
    body.innerHTML += '<div class="aic-thought-row"><span class="aic-thought-dot"></span><span>'+API._esc(content)+'</span></div>';
    API._aiUpdateThinkPreview(content);
    body.scrollTop = body.scrollHeight;
  }

  function _toolPreviewText(tool, statusText, msg) {
    tool = tool || {};
    var parts = [tool.name || 'tool'];
    if (tool.label && tool.label !== tool.name) parts.push(tool.label);
    parts.push(statusText || '');
    var text = parts.filter(Boolean).join(' · ');
    if (msg) text += ' · ' + msg;
    return text;
  }

  function updateToolRow(tool, status, msg) {
    var id = tool && tool.id;
    var row = document.getElementById(id);
    if (!row) return;
    var dot = row.querySelector('.aic-tool-status');
    row.classList.remove('running');
    row.classList.toggle('done', status === 'done');
    row.classList.toggle('error', status === 'error');
    if (status === 'done') {
      dot.innerHTML = '<i data-lucide="check" style="width:10px;height:10px;color:var(--green)"></i>';
      API._aiUpdateThinkPreview(_toolPreviewText(tool, '已完成'));
    } else if (status === 'error') {
      dot.innerHTML = '<i data-lucide="x" style="width:10px;height:10px;color:var(--red)"></i>';
      if (msg) {
        var main = row.querySelector('.aic-tool-main');
        if (main) main.insertAdjacentHTML('beforeend', '<div class="aic-tool-error">'+API._esc(msg)+'</div>');
      }
      API._aiUpdateThinkPreview(_toolPreviewText(tool, '失败', msg));
    }
    lucide.createIcons();
  }
};

// ===== Helpers =====
// HTML text-node escape — also escapes quotes so it is safe in attribute values
// and onclick JS-string contexts. Use API.escapeAttr for attribute values,
// API.escapeJs for JS string literals (both delegate here + extra).
API._esc = function(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};
API.escapeHtml = API._esc;            // public alias — text nodes & attributes
API.escapeJs = function(s) {          // for onclick="fn('...')" JS string literals
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/\r?\n/g,'\\n');
};
API.escapeAttr = API._esc;            // alias for clarity at call sites

// Lightweight HTML sanitizer for AI/markdown output. Strips <script>/<iframe>/<object>,
// on* event handlers, and javascript:/data: URLs in href/src. No external deps.
API._sanitize = function(html) {
  if (!html) return '';
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove active/document-level content entirely. SVG is allowed for visual
  // reasoning, but foreignObject can reintroduce arbitrary HTML into it.
  tmp.querySelectorAll('script,iframe,object,embed,form,style,link,meta,base,foreignObject').forEach(function(el){ el.remove(); });
  // Strip on* attributes and sanitize href/src
  var walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ELEMENT, null);
  var node;
  while ((node = walker.nextNode())) {
    // remove all on* attributes
    var attrs = Array.prototype.slice.call(node.attributes || []);
    attrs.forEach(function(a) {
      if (/^on/i.test(a.name)) node.removeAttribute(a.name);
      if ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href') && a.value) {
        var v = String(a.value).trim().toLowerCase();
        var isSafeDataImage = /^data:image\/(png|gif|jpeg|webp|svg\+xml);/i.test(v);
        if (v.indexOf('javascript:') === 0 || v.indexOf('data:') === 0 && !isSafeDataImage || v.indexOf('vbscript:') === 0) {
          node.removeAttribute(a.name);
        }
      }
      if (a.name === 'style' && /expression\s*\(|url\s*\(\s*['"]?\s*(javascript|data:text\/html)/i.test(a.value)) node.removeAttribute(a.name);
    });
  }
  return tmp.innerHTML;
};

// Full markdown render with mermaid support (matches desktop md())
API._md = function(text) {
  if (!text) return '';
  try {
    // Extract SVG blocks before parsing
    var svgBlocks = [];
    var work = String(text).replace(/```svg\r?\n([\s\S]*?)```\s*/g, function(_, svg) {
      svgBlocks.push(svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''));
      return '\x00SVG' + (svgBlocks.length - 1) + '\x00';
    });
    // Parse markdown
    var html = marked.parse(work);
    // Restore SVG blocks
    html = html.replace(/\x00SVG(\d+)\x00/g, function(_, i) {
      return '<div class="md-svg">' + svgBlocks[parseInt(i)] + '</div>';
    });
    // Convert mermaid code blocks to renderable elements
    html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, function(_, code) {
      var decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      return '<div class="mermaid">' + decoded + '</div>';
    });
    // Sanitize the final HTML (strips on* handlers, javascript: URLs, script/iframe tags)
    return API._sanitize(html);
  } catch(e) {
    return API._esc(text).replace(/\n/g, '<br>');
  }
};
API.md = API._md; // Public alias

// ===== Send (SSE Streaming) =====
API._aiFileContents = [];

API._aiHandleFiles = function(input) {
  API._aiFileContents = [];
  var badge = document.getElementById('aic-file-badge');
  if (!input.files.length) { badge.style.display = 'none'; return; }
  var names = [];
  var pending = input.files.length;
  Array.from(input.files).forEach(function(file) {
    names.push(file.name);
    var reader = new FileReader();
    reader.onload = function(e) {
      API._aiFileContents.push({ name: file.name, type: file.type, text: e.target.result, data_uri: file.type.startsWith('image/') ? e.target.result : '' });
      if (--pending === 0) {
        badge.textContent = '📎 '+names.join(', ');
        badge.style.display = '';
      }
    };
    if (file.type.startsWith('image/')) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
};

API._aiQuickSend = function(msg) {
  var input = document.getElementById('aic-input');
  if (input) { input.value = msg; API._aiSend(); }
};

API._aiAborted = false; // Track whether the current stream was manually aborted
API._aiRunId = 0;       // Monotonic run id — only the latest _aiSend may write shared state

API._aiStop = function() {
  if (!API._aiStreaming && !API._aiAbort) return; // Already stopped, don't fire duplicate events
  if (API._aiAbort) { API._aiAbort.abort(); API._aiAbort = null; }
  API._aiStreaming = false;
  API._aiAborted = true; // Mark as manually stopped
  // Clear all generation state flags — user stopped, so nothing is generating anymore
  API.cleanupGenerating(true);
  API._aiSetUiState('idle');
  API._taskUpdateBadge();
  // Notify pages that AI was manually stopped (so they can restore UI)
  try { document.dispatchEvent(new CustomEvent('aic-stopped')); } catch(e) {}
  // Don't fire aic-done on manual stop — prevents auto-retry loops
};

// Centralized AI panel UI state (idle/streaming/done) — avoids 3 duplicated blocks (audit S5)
API._aiSetUiState = function(state) {
  var send = document.getElementById('aic-send-btn');
  var stop = document.getElementById('aic-stop-btn');
  var dot = document.getElementById('aic-status-dot');
  var txt = document.getElementById('aic-status-text');
  var bubble = document.getElementById('aic-bubble');
  if (state === 'streaming') {
    if (dot) dot.style.background = 'var(--orange)';
    if (dot) dot.classList.add('running');
    if (txt) txt.textContent = '处理中';
    if (txt) txt.classList.add('running');
    if (send) send.style.display = 'none';
    if (stop) stop.style.display = '';
    if (bubble) { bubble.classList.remove('has-reply'); bubble.classList.add('working'); }
  } else { // idle / done
    if (dot) dot.style.background = 'var(--green)';
    if (dot) dot.classList.remove('running');
    if (txt) txt.textContent = '就绪';
    if (txt) txt.classList.remove('running');
    if (send) send.style.display = '';
    if (stop) stop.style.display = 'none';
    if (bubble) { bubble.classList.remove('working'); bubble.classList.add('has-reply'); }
  }
};

API._taskStatusText = function(task) {
  if (!task) return '';
  if (task.status === 'running') return '运行中';
  if (task.status === 'queued') return '排队中';
  if (task.status === 'retrying') return '限流重试' + (task.retryAt ? ' ' + Math.max(0, Math.ceil((task.retryAt - Date.now()) / 1000)) + 's' : '');
  if (task.status === 'done') return '已完成';
  if (task.status === 'error' || task.status === 'failed') return '失败';
  if (task.status === 'cancelled' || task.status === 'stopped') return '已取消';
  if (task.status === 'interrupted') return '已中断';
  return task.status || '';
};

API._aiToggleTaskStrip = function() {
  var strip = document.getElementById('aic-task-strip');
  if (strip) strip.classList.toggle('open');
  API._aiRenderTaskCards();
};

API._aiRenderTaskCards = function() {
  var strip = document.getElementById('aic-task-strip');
  var entry = document.getElementById('aic-task-entry');
  if (!strip || !entry) return;
  var sid = API._aiSessionId || '';
  var tasks = API._taskLoad().filter(function(t) { return t.sessionId && t.sessionId === sid; });
  var active = tasks.filter(function(t) { return t.status === 'running' || t.status === 'queued' || t.status === 'retrying' || t.status === 'paused'; });
  var recent = tasks.filter(function(t) { return t.status === 'done' || t.status === 'error' || t.status === 'failed' || t.status === 'cancelled' || t.status === 'stopped' || t.status === 'interrupted'; }).slice(0, 3);
  var visible = active.concat(recent).slice(0, 6);
  var totalCount = visible.length;
  if (!visible.length) {
    entry.style.display = 'none';
    entry.classList.remove('running');
    strip.classList.remove('open');
    strip.style.display = 'none';
    strip.innerHTML = '';
    return;
  }
  entry.style.display = 'flex';
  entry.classList.toggle('running', active.length > 0);
  var entryText = entry.querySelector('span');
  if (entryText) entryText.textContent = 'Task ' + active.length + '/' + totalCount;
  strip.style.display = '';
  var stripState = active.length ? (active.some(function(t) { return t.status === 'retrying'; }) ? 'retrying' : 'running') :
    (visible.some(function(t) { return t.status === 'error' || t.status === 'failed'; }) ? 'error' :
      (visible.some(function(t) { return t.status === 'done'; }) ? 'done' : 'idle'));
  strip.classList.remove('status-running', 'status-retrying', 'status-done', 'status-error', 'status-idle');
  strip.classList.add('status-' + stripState);
  var latest = visible[0] || {};
  var latestLabel = [latest.title || latest.module || '任务', API._taskStatusText(latest)].filter(Boolean).join(' · ');
  var summary = active.length ? active.length + ' 个进行中' : recent.length + ' 个最近任务';
  var preview = latestLabel ? summary + ' · ' + latestLabel : summary;
  strip.innerHTML =
    '<div class="aic-task-popover-head">'+
      '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1">'+
        '<span class="aic-task-wave" aria-hidden="true"></span>'+
        '<span class="aic-task-strip-title">后台任务</span>'+
        '<span class="aic-task-strip-summary">'+API._esc(preview)+'</span>'+
      '</div>'+
      '<button data-aic-task-action="toggle-strip" class="aic-task-strip-toggle" title="'+(strip.classList.contains('open') ? '收起' : '展开')+'"><span class="aic-thinking-grip" aria-hidden="true"></span></button>'+
    '</div>'+
    '<div class="aic-task-popover-list">'+
      visible.map(function(t) {
        var color = t.status === 'done' ? 'var(--green)' : (t.status === 'error' || t.status === 'failed' ? 'var(--red)' : (t.status === 'retrying' ? 'var(--orange)' : 'var(--accent)'));
        var label = [t.title || t.module || '任务', API._taskStatusText(t)].filter(Boolean).join(' · ');
        return '<div class="aic-task-card" data-aic-task-id="'+API._esc(t.id)+'" role="button" tabindex="0">'+
          '<div class="aic-task-card-title">'+
            '<span class="aic-task-card-dot" style="background:'+color+'"></span>'+
            '<span>'+API._esc(label)+'</span>'+
          '</div>'+
          '<div class="aic-task-card-detail">'+API._esc(t.progressText || t.detail || '')+'</div>'+
          '<div class="aic-task-card-actions">'+
            ((t.status === 'running' || t.status === 'queued' || t.status === 'retrying') ? '<button data-aic-task-action="cancel" data-task-id="'+API._esc(t.id)+'" class="aic-task-cancel">取消</button>' : '')+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  lucide.createIcons();
};

API._aiSend = async function(sendOptions) {
  sendOptions = sendOptions || {};
  if (API._aiStreaming) return;
  if (API.SecureConfig) {
    try { await API.SecureConfig.load(); } catch(e) { API.toast('安全配置读取失败'); return; }
  }
  var input = document.getElementById('aic-input');
  if (!input) { API.toast('DEBUG: input not found'); return; }
  var msg = input.value.trim();
  if (!msg) return;

  // Verify engine loaded
  if (typeof AEngine === 'undefined') { API.toast('ERROR: AEngine 未加载'); return; }
  if (typeof Prompts === 'undefined') { API.toast('ERROR: Prompts 未加载'); return; }

  // Debug: log config + URL (不暴露给用户)
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    var cfg = API.SecureConfig ? API.SecureConfig.current() : JSON.parse(localStorage.getItem('zhangl-ai-config') || '{}');
    var dbgBase = (cfg.api_base || '(未配置)').replace(/\/+$/, '');
    var dbgPath = (cfg.provider === 'anthropic') ? '/messages' : '/chat/completions';
    console.log('[AI] →', dbgBase + dbgPath);
  }

  // Auto-create session if needed
  if (!API._aiSessionId) {
    try {
      var proj2 = API._activeProject();
      var newId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      var newSession = { id: newId, name: '移动端会话', project: proj2, messages: [], taskRefs: [], created: new Date().toISOString() };
      await API.Repository.saveSession(newSession);
      API._aiSessionId = newId;
      var lbl = document.getElementById('aic-session-label'); if (lbl) lbl.textContent = '新会话';
      API._aiLoadSessionList();
    } catch(e) {}
  }

  // Capture this run's id; only the latest run may mutate shared AI state at the end.
  // This prevents a stale _aiSend (aborted mid-stream) from overwriting a newer run's
  // _aiStreaming/_aiAbort (audit S6 — stop/send race).
  var myRun = ++API._aiRunId;
  API._aiStreaming = true;
  API._aiAborted = false;
  API._aiAbort = new AbortController();

  var msgs = document.getElementById('aic-msgs');

  // User bubble
  msgs.insertAdjacentHTML('beforeend', '<div style="display:flex;justify-content:flex-end;margin:4px 0"><div style="max-width:80%;max-height:200px;overflow-y:auto;padding:8px 12px;background:var(--accent-soft);border-radius:14px 14px 3px 14px;font-size:13px;line-height:1.5;color:var(--text)">'+API._esc(msg).replace(/\n/g, '<br>')+'</div></div>');

  // Task notification: create running task
  var taskInfo = API._taskDetect(msg);
  var taskId = sendOptions.taskId || 'task_'+Date.now();
  var taskLockKey = API._taskLockKey(taskInfo);
  var taskRecord;
  if (sendOptions.taskId) {
    taskRecord = API.TaskStore.update(taskId, { status: 'running', title: taskInfo.title, detail: taskInfo.detail, type: taskInfo.type, module: taskInfo.module, date: taskInfo.date, filePath: taskInfo.filePath, lockKey: taskLockKey, sessionId: sendOptions.sessionId || API._aiSessionId || '', threadId: sendOptions.threadId || sendOptions.sessionId || API._aiSessionId || '', replyTarget: 'task-card', timestamp: Date.now(), error: '', read: false }) || { id: taskId };
  } else {
    taskRecord = API._taskAdd({ id: taskId, type: taskInfo.type, module: taskInfo.module, title: taskInfo.title, status: 'running', detail: taskInfo.detail, date: taskInfo.date, filePath: taskInfo.filePath, lockKey: taskLockKey, sessionId: API._aiSessionId || '', threadId: API._aiSessionId || '', replyTarget: 'chat-ui', error: '', timestamp: Date.now(), read: false });
  }
  taskId = taskRecord.id;
  API._taskUpdateBadge();
  try { document.dispatchEvent(new CustomEvent('task-start', { detail: { id: taskId } })); } catch(e) {}

  input.value = '';
  input.style.height = 'auto';

  // Assistant placeholder
  var replyId = 'aic-reply-'+Date.now();
  msgs.insertAdjacentHTML('beforeend', '<div id="'+replyId+'" style="display:flex;gap:8px;margin:4px 0"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="bot" style="width:14px;height:14px;color:var(--accent)"></i></div><div class="md-body" style="flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--text);background:var(--surface2);padding:10px 14px;border-radius:12px 14px 14px 14px" id="'+replyId+'-text"><span class="aic-dot-pulse" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);animation:aicPulse 1.2s infinite;vertical-align:middle;margin-right:6px"></span>思考中...</div></div>');
  lucide.createIcons();
  msgs.scrollTop = msgs.scrollHeight;

  // UI state
  API._aiSetUiState('streaming');

  // Clear thinking panel
  API._aiTools = [];
  var thinkBody = document.getElementById('aic-thinking-body'); if (thinkBody) thinkBody.innerHTML = '';

  var proj = localStorage.getItem('zhangl-active-project') || '公考练习';
  var streamedText = '';
  var thinkingMode = document.getElementById('aic-thinking-toggle') ? (document.getElementById('aic-thinking-toggle').checked ? 'enabled' : 'disabled') : 'disabled';
  var attachments = API._aiFileContents.length ? API._aiFileContents.map(function(a) { return { name: a.name, type: a.type, text: a.text || '', data_uri: a.data_uri || '' }; }) : [];

  // Clear attachments and badge
  API._aiFileContents = [];
  var fb = document.getElementById('aic-file-badge'); if (fb) fb.style.display = 'none';
  var fi = document.getElementById('aic-file-input'); if (fi) fi.value = '';

  var abortedHere = false; // local abort flag for this run
  try {
    // Load session history. Detect and repair unpaired tool_calls
    // (Python: engine.py _fix_orphaned_tool_uses, line 183-230)
    var session = await API.Repository.getSession(API._aiSessionId);
    var rawHistory = (session && session.messages) ? session.messages.slice() : [];

    // ── Case A: orphaned tool_uses (assistant without results) ──
    // Walk backward; if an assistant has tool_calls whose IDs don't all appear
    // in subsequent tool messages, drop that assistant message.
    var fixed = false;
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = rawHistory.length - 1; i >= 0; i--) {
        var m = rawHistory[i];
        if (m.role !== 'assistant' || !m.tool_calls) continue;
        var tcIds = new Set(m.tool_calls.map(function(tc) { return tc.id; }));
        var foundIds = new Set();
        for (var j = i + 1; j < rawHistory.length; j++) {
          if (rawHistory[j].role === 'tool') {
            var tid = rawHistory[j].tool_call_id || '';
            if (tcIds.has(tid)) foundIds.add(tid);
          } else {
            break; // tool results must be immediately after assistant
          }
        }
        // If not all tool_call IDs have matching tool results → drop this assistant
        if (foundIds.size !== tcIds.size) {
          rawHistory.splice(i, 1);
          fixed = true;
          changed = true;
          break; // restart scan since array changed
        }
      }
    }

    // ── Case B: orphaned tool_results (result without matching tool_use) ──
    // Collect all tool_call IDs from all assistant messages, then remove any
    // tool message whose tool_call_id is not in that set.
    var allTcIds = new Set();
    for (var i = 0; i < rawHistory.length; i++) {
      var m = rawHistory[i];
      if (m.role === 'assistant' && m.tool_calls) {
        m.tool_calls.forEach(function(tc) { allTcIds.add(tc.id); });
      }
    }
    // Remove any tool message whose tool_call_id is not in the set
    // (if allTcIds is empty, ALL tool messages are orphans)
    changed = true;
    while (changed) {
      changed = false;
      for (var i = rawHistory.length - 1; i >= 0; i--) {
        if (rawHistory[i].role === 'tool') {
          var tid = rawHistory[i].tool_call_id || '';
          if (!allTcIds.has(tid)) {
            rawHistory.splice(i, 1);
            fixed = true;
            changed = true;
            break;
          }
        }
      }
    }

    if (fixed) {
      API.toast('检测到中断残留，已自动修复上下文');
    }

    var history = rawHistory;

    // Detect task type for system prompt — default to chat, not practice
    var scenario = 'chat';
    if (msg.indexOf('申论') >= 0 && msg.indexOf('批改') >= 0) scenario = 'essay';
    else if (msg.indexOf('批改') >= 0 || msg.indexOf('做题') >= 0 || msg.indexOf('练习') >= 0) scenario = 'grading';
    else if (msg.indexOf('计划') >= 0 || msg.indexOf('备考') >= 0) scenario = 'planning';
    else if (msg.indexOf('刷题') >= 0 || msg.indexOf('出题') >= 0 || msg.indexOf('生成') >= 0) scenario = 'practice';

    var systemPrompt = Prompts.getFullPrompt(scenario);

    // Call AI engine with streaming callbacks (errors caught by outer try/catch)
    var _streamRenderPending = false;
    var _streamDone = false;
    function _renderStreamedText() {
      if (_streamDone) return;  // don't overwrite final markdown render
      _streamRenderPending = false;
      var rt = document.getElementById(replyId+'-text');
      if (rt) rt.innerHTML = '<span class="aic-dot-pulse" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);animation:aicPulse 1.2s infinite;vertical-align:middle;margin-right:6px"></span>' + API._esc(streamedText).replace(/\n/g, '<br>');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
    var result = await AEngine.runLoop(systemPrompt, msg, history,
      // onChunk: real-time text streaming + tool status updates
      function(chunk) {
        if (chunk.type === 'text') {
          streamedText += chunk.content;
          // Throttle DOM updates to once per animation frame — re-setting innerHTML
          // on every token is expensive and makes streaming look chunky (sentence-by-sentence)
          if (!_streamRenderPending) { _streamRenderPending = true; requestAnimationFrame(_renderStreamedText); }
        } else if (chunk.type === 'tool_start') {
          API._aiAddThink('tool_start', { name: chunk.name, label: chunk.label || '', expert_id: chunk.expert_id || '' });
        } else if (chunk.type === 'tool_done') {
          API._aiAddThink('tool_done', {});
        } else if (chunk.type === 'tool_error') {
          API._aiAddThink('tool_error', { message: chunk.message || '' });
        }
      },
      { signal: API._aiAbort.signal }
    );

    // Save updated messages to session
    if (result && result.messages) {
      await AEngine.saveSession(API._aiSessionId, result.messages);
      streamedText = result.text || streamedText;
    }

    // Final render: stream ended normally, convert to full markdown
    _streamDone = true;  // stop pending stream renders from overwriting markdown
    if (streamedText) {
      var ft = document.getElementById(replyId+'-text'); if (ft) ft.innerHTML = API._md(streamedText);
      setTimeout(function() {
        try { if (typeof mermaid !== 'undefined') mermaid.run({ querySelector: '#'+replyId+'-text .mermaid' }); } catch(e) {}
      }, 200);
    }
    // Task: mark as done
    if (taskId) { API._taskUpdate(taskId, { status: 'done' }); try { document.dispatchEvent(new CustomEvent('task-done', { detail: { id: taskId } })); } catch(e) {} }
    API.AIThrottle.noteSuccess();
  } catch(e) {
    _streamDone = true;  // stop pending stream renders from overwriting
    var isAbort = e.name === 'AbortError' || API._aiAborted;
    if (!isAbort) {
      if (API.AIThrottle.isRateLimited(e) && taskId) {
        var throttle = API.AIThrottle.noteRateLimit(e);
        var waitMs = Math.max(1000, (throttle.limitUntil || Date.now()) - Date.now());
        var etRate = document.getElementById(replyId+'-text');
        if (etRate) etRate.innerHTML = '<span style="color:var(--orange)">服务商限流，约 ' + Math.ceil(waitMs / 1000) + ' 秒后自动重试</span>';
        API._taskUpdate(taskId, { status: 'retrying', error: e.message || '服务商限流', retryAt: throttle.limitUntil, read: false });
        API._taskAppendLog(taskId, { type: 'rate_limit', content: '服务商限流，自动降级为串行并等待重试' });
        API.AITaskQueue.retry(taskId, msg, sendOptions || {}, waitMs);
      } else {
        var et2 = document.getElementById(replyId+'-text'); if (et2) et2.innerHTML = '<span style="color:var(--red)">✗ ' + API._esc(e.message || 'AI 请求失败') + '</span>';
        if (taskId) API._taskUpdate(taskId, { status: 'error', error: e.message || '未知错误' });
        API.clearGeneratingForTask(taskInfo, msg);
        try { document.dispatchEvent(new CustomEvent('aic-failed', { detail: { type: taskInfo.type, module: taskInfo.module, date: taskInfo.date, reason: 'error' } })); } catch(e2) {}
      }
    } else {
      abortedHere = true;
      if (taskId) API._taskUpdate(taskId, { status: 'stopped', title: (taskInfo.title||'任务') + '（已取消）' });
      var stEl = document.getElementById(replyId+'-text');
      if (stEl) {
        if (streamedText) {
          stEl.innerHTML = API._md(streamedText) + '<br><span style="color:var(--text-secondary);font-size:11px">（已停止）</span>';
        } else {
          stEl.innerHTML = '<span style="color:var(--text-secondary)">⊘ 已停止</span>';
        }
        setTimeout(function() {
          try { if (typeof mermaid !== 'undefined') mermaid.run({ querySelector: '#'+replyId+'-text .mermaid' }); } catch(e) {}
        }, 200);
      }
    }
  }

  // === Finalize === Guard: only the latest run may write shared state.
  // If a newer _aiSend started while this one was winding down, leave its state alone.
  if (myRun !== API._aiRunId) return;

  // Restore UI
  API._aiStreaming = false;
  API._aiAbort = null;
  API._aiSetUiState('idle');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  lucide.createIcons();
  API._aiLoadSessionList();
  // Only notify pages if the stream completed normally (not aborted)
  // This prevents cancelled tasks from triggering auto-retry loops
  if (!abortedHere) {
    try { document.dispatchEvent(new CustomEvent('aic-done', { detail: { type: taskInfo.type, module: taskInfo.module, date: taskInfo.date, stopped: false } })); } catch(e) {}
  }

  // Task notification: update badge + toast if sheet is closed
  API._taskUpdateBadge();
  if (taskId) {
    var tasks = API._taskLoad();
    var t = tasks.find(function(x) { return x.id === taskId; });
    if (t) {
      var toastIcon = t.status === 'error' ? '✗' : t.status === 'stopped' ? '⊘' : '✓';
      var toastMsg = toastIcon + ' ' + t.title + (t.status === 'error' ? '失败' : t.status === 'stopped' ? '已取消' : '完成');
      if (t.detail) toastMsg += ' · ' + t.detail;
      if (t.status === 'stopped' || !API._aiOpen) API.toast(toastMsg);
    }
  }
  API.AITaskQueue.drainSoon();
};
