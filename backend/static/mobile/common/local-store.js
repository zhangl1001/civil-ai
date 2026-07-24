// ===== LocalStore — IndexedDB 文件系统层 =====
// 替代后端 /api/projects/{name}/files/* 的全部 CRUD
// 对外接口与后端 API 行为一致，底层用 IndexedDB 实现

const LocalStore = (() => {
  const DB_NAME = 'zhangl-examtutor';
  const DB_VERSION = 3;
  const SCHEMA_VERSION = 3;
  let _db = null;

  // ── IndexedDB 初始化 ─────────────────────────────────────────
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        ensureStores(db);
        const meta = e.target.transaction.objectStore('meta');
        meta.put({
          key: 'schema_version',
          value: SCHEMA_VERSION,
          db_version: DB_VERSION,
          upgraded_from: e.oldVersion || 0,
          updated_at: new Date().toISOString(),
        });
      };
      req.onsuccess = (e) => {
        _db = e.target.result;
        ensureRuntimeMeta().then(() => resolve(_db)).catch(reject);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function ensureStores(db) {
    // 文件存储: key = project + path 复合主键
    if (!db.objectStoreNames.contains('files')) {
      const fs = db.createObjectStore('files', { keyPath: 'id' });
      fs.createIndex('project', 'project', { unique: false });
      fs.createIndex('path', 'path', { unique: false });
      fs.createIndex('project_path', ['project', 'path'], { unique: true });
    }
    // 项目存储
    if (!db.objectStoreNames.contains('projects')) {
      db.createObjectStore('projects', { keyPath: 'name' });
    }
    // AI 会话存储
    if (!db.objectStoreNames.contains('sessions')) {
      const ss = db.createObjectStore('sessions', { keyPath: 'id' });
      ss.createIndex('project', 'project', { unique: false });
    }
    // 元信息/迁移状态
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
    // Offline changes are durable until the repository confirms server receipt.
    if (!db.objectStoreNames.contains('sync_queue')) {
      const queue = db.createObjectStore('sync_queue', { keyPath: 'id' });
      queue.createIndex('project', 'project', { unique: false });
      queue.createIndex('created_at', 'created_at', { unique: false });
    }
  }

  async function ensureRuntimeMeta() {
    if (!_db || !_db.objectStoreNames.contains('meta')) return;
    const t = _db.transaction('meta', 'readwrite');
    const store = t.objectStore('meta');
    const existing = await storeReq(store, 'get', 'schema_version');
    if (!existing || existing.value !== SCHEMA_VERSION) {
      await storeReq(store, 'put', {
        key: 'schema_version',
        value: SCHEMA_VERSION,
        db_version: DB_VERSION,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // ── 通用事务辅助 ─────────────────────────────────────────────
  function tx(storeName, mode) {
    return openDB().then(db => {
      const t = db.transaction(storeName, mode);
      return t.objectStore(storeName);
    });
  }

  function storeReq(store, method, ...args) {
    return new Promise((resolve, reject) => {
      const req = store[method](...args);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getMeta(key) {
    const db = await openDB();
    const t = db.transaction('meta', 'readonly');
    return storeReq(t.objectStore('meta'), 'get', key);
  }

  async function getSchemaInfo() {
    const meta = await getMeta('schema_version');
    return {
      db_name: DB_NAME,
      db_version: DB_VERSION,
      schema_version: meta && meta.value ? meta.value : SCHEMA_VERSION,
      updated_at: meta && meta.updated_at ? meta.updated_at : '',
    };
  }

  // ── 文件 CRUD ────────────────────────────────────────────────

  /** 读取文件内容，返回 string 或 null */
  async function readFile(project, path) {
    const db = await openDB();
    const t = db.transaction('files', 'readonly');
    const store = t.objectStore('files');
    const idx = store.index('project_path');
    const id = projectId(project, path);
    const rec = await storeReq(idx, 'get', [project, path]);
    return rec ? rec.content : null;
  }

  async function getFileRecord(project, path) {
    const db = await openDB();
    const t = db.transaction('files', 'readonly');
    return storeReq(t.objectStore('files'), 'get', projectId(project, path));
  }

  async function markFileSynced(project, path, serverMtime) {
    const db = await openDB();
    const t = db.transaction('files', 'readwrite');
    const store = t.objectStore('files');
    const rec = await storeReq(store, 'get', projectId(project, path));
    if (!rec) return null;
    rec.server_mtime = serverMtime || '';
    await storeReq(store, 'put', rec);
    return rec;
  }

  // ── 并发写入保护 (key 级锁) ──────────────────────────────
  // 防止并行专家/工具同时写入同一文件导致数据丢失
  var _writeLocks = {};  // projectId(path) → Promise chain

  async function _withWriteLock(project, path, fn) {
    var key = projectId(project, path);
    // Chain onto existing lock or start new
    var prevLock = _writeLocks[key] || Promise.resolve();
    var resolveThis;
    var thisLock = new Promise(function(r) { resolveThis = r; });
    _writeLocks[key] = thisLock;

    try {
      await prevLock;  // Wait for previous write to finish
      return await fn();
    } finally {
      resolveThis();   // Release lock
      // Clean up if this is the current lock
      if (_writeLocks[key] === thisLock) {
        delete _writeLocks[key];
      }
    }
  }

  /** 写入文件，如果存在则覆盖。带并发写入保护。 */
  async function writeFile(project, path, content) {
    return _withWriteLock(project, path, async function() {
      const db = await openDB();
      const t = db.transaction('files', 'readwrite');
      const store = t.objectStore('files');
      const id = projectId(project, path);
      // 检查是否已存在（保留 ctime）
      const existing = await storeReq(store, 'get', id);
      const now = new Date().toISOString();
      const rec = {
        id,
        project,
        path,
        content,
        type: path.endsWith('.json') ? 'json' : 'md',
        size: typeof content === 'string' ? content.length : 0,
        ctime: existing ? existing.ctime : now,
        mtime: now,
      };
      await storeReq(store, 'put', rec);
      return rec;
    });
  }

  /** 删除文件 */
  async function deleteFile(project, path) {
    const db = await openDB();
    const t = db.transaction('files', 'readwrite');
    const store = t.objectStore('files');
    const id = projectId(project, path);
    await storeReq(store, 'delete', id);
  }

  /** 列出某项目某前缀下的所有文件路径
   *  模拟后端 GET /api/projects/{name}/files/{path}/ 的目录列表行为
   *  返回 string[] — 匹配前缀的文件路径列表
   */
  async function listFiles(project, prefix) {
    const db = await openDB();
    const t = db.transaction('files', 'readonly');
    const store = t.objectStore('files');
    const idx = store.index('project');
    const range = IDBKeyRange.only(project);
    const all = await storeReq(idx, 'getAll', range);
    if (!prefix) return all.map(r => r.path).sort();
    // 前缀匹配
    return all
      .filter(r => r.path.startsWith(prefix))
      .map(r => r.path)
      .sort();
  }

  /** 列出某前缀下的直接子项（一层）
   *  如 prefix="练习/" 返回 ["练习/判断推理/", "练习/资料分析/", "练习/申论/"]
   *  或 prefix="练习/判断推理/" 返回 ["练习/判断推理/2026-07-03.md"]
   */
  async function listDir(project, prefix) {
    const paths = await listFiles(project, prefix);
    const entries = new Set();
    for (const p of paths) {
      // 去掉 prefix，取第一段
      const rest = p.substring(prefix.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx >= 0) {
        entries.add(prefix + rest.substring(0, slashIdx + 1));
      } else if (rest) {
        entries.add(p);
      }
    }
    return Array.from(entries).sort();
  }

  /** 删除某前缀下的所有文件 */
  async function deletePrefix(project, prefix) {
    const paths = await listFiles(project, prefix);
    const db = await openDB();
    const t = db.transaction('files', 'readwrite');
    const store = t.objectStore('files');
    for (const p of paths) {
      store.delete(projectId(project, p));
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(paths.length);
      t.onerror = () => reject(t.error);
    });
  }

  // ── 项目 CRUD ────────────────────────────────────────────────

  async function listProjects() {
    const db = await openDB();
    const t = db.transaction('projects', 'readonly');
    const store = t.objectStore('projects');
    return storeReq(store, 'getAll');
  }

  async function getProject(name) {
    const db = await openDB();
    const t = db.transaction('projects', 'readonly');
    const store = t.objectStore('projects');
    return storeReq(store, 'get', name);
  }

  // ── 创建项目时的默认文件 (翻译自 Python 项目初始化) ────────
	  var _DEFAULT_FILES = {
	    '能力画像.json': '{"modules":{}}',
	    '练习统计.json': '{"records":[]}',
	    '复习队列.json': '{"queue":[]}',
	    '题目元数据.json': '{"version":2,"files":{},"questions":{}}',
	    '评分记录.json': '{"version":2,"records":[]}',
	    '学习事件.json': '{"version":3,"events":[]}',
	    '索引/每日完成索引.json': '{"version":1,"updated_at":"","records":{}}',
	    '索引/错题索引.json': '{"version":1,"updated_at":"","items":[]}',
	    '学习事务.json': '{"version":1,"transactions":[]}',
	    '复习项目.json': '{"version":3,"items":[]}',
	    '申论画像.json': '{"version":3,"dimensions":{},"sessions":[]}',
	    '面试画像.json': '{"version":3,"dimensions":{},"sessions":[]}',
	  };

  // ── 默认知识体系树 (翻译自 Python backend/app.py _DEFAULT_KNOWLEDGE_TREE) ──
  var _DEFAULT_KNOWLEDGE_TREE = {
    "判断推理": {
      "逻辑判断": ["直言命题","假言推理","选言命题","削弱加强","解释评价"],
      "图形推理": ["位置规律","样式规律","属性规律","数量规律","空间重构"],
      "定义判断": ["关键词匹配","要件提取","多定义辨析"],
      "类比推理": ["语义关系","逻辑关系","语法关系","字符类比"]
    },
    "言语理解": {
      "逻辑填空": ["语境分析","词语辨析","成语运用","关联词搭配"],
      "片段阅读": ["主旨概括","意图判断","细节理解","词句理解","标题选择"],
      "语句表达": ["语句排序","语句填空","接语选择","病句辨析"]
    },
    "资料分析": {
      "核心概念": ["增长量","增长率","比重","倍数","平均数"],
      "速算技巧": ["估算法","直除法","特殊值法","差分法","十字交叉"],
      "综合分析": ["文字材料","表格材料","图形材料","综合材料"]
    },
    "数量关系": {
      "数学运算": ["工程问题","行程问题","利润问题","排列组合","概率问题","几何问题"],
      "数字推理": ["等差数列","等比数列","幂次数列","递推数列"]
    },
    "常识判断": {
      "时政热点": ["重大会议","重要政策","领导人讲话"],
      "法律常识": ["宪法","行政法","民法典","刑法"],
      "人文历史": ["中国古代史","文学常识","传统节日"],
      "科技地理": ["前沿科技","地理国情","生活常识"]
    },
    "申论": {
      "归纳概括": ["概括主旨","提炼要点","归纳原因","总结影响"],
      "综合分析": ["词句理解","观点评价","现象分析","关系分析"],
      "提出对策": ["问题识别","对策设计","可行性分析","优先级排序"],
      "公文写作": ["通知","报告","意见","简报","倡议书"],
      "申发论述": ["立意审题","结构布局","论证方法","语言表达","素材运用"]
    }
  };

  async function createProject(name, config) {
    const db = await openDB();
    const t = db.transaction('projects', 'readwrite');
    const store = t.objectStore('projects');
    const now = new Date().toISOString();
    const rec = {
      name,
      config: config || {},
      created: now,
      modified: now,
    };
    await storeReq(store, 'put', rec);

    // Auto-create default files if they don't exist
    for (var fpath in _DEFAULT_FILES) {
      if (!_DEFAULT_FILES.hasOwnProperty(fpath)) continue;
      var existing = await readFile(name, fpath);
      if (existing === null) {
        await writeFile(name, fpath, _DEFAULT_FILES[fpath]);
      }
    }

    // Auto-create 知识体系.json from default tree
    var existingTree = await readFile(name, '知识体系.json');
    if (existingTree === null) {
      await writeFile(name, '知识体系.json', JSON.stringify(_DEFAULT_KNOWLEDGE_TREE, null, 2));
    }

    // Auto-create syllabus/{module}.json for each module (AI reads these for learning progress)
    for (var mod in _DEFAULT_KNOWLEDGE_TREE) {
      if (!_DEFAULT_KNOWLEDGE_TREE.hasOwnProperty(mod)) continue;
      var sylPath = 'syllabus/' + mod + '.json';
      var existingSyl = await readFile(name, sylPath);
      if (existingSyl === null) {
        // Format: { moduleName: [{name: "kp1", status: "未学"}, ...], subModule: [...] }
        var sylData = {};
        var subMods = _DEFAULT_KNOWLEDGE_TREE[mod];
        for (var sub in subMods) {
          if (!subMods.hasOwnProperty(sub)) continue;
          sylData[sub] = subMods[sub].map(function(kp) { return { name: kp, status: '未学' }; });
        }
        await writeFile(name, sylPath, JSON.stringify(sylData, null, 2));
      }
    }

    // Auto-create 备考计划.json from config so home countdown works immediately
    if (config) {
      var existingPlan = await readFile(name, '备考计划.json');
      if (!existingPlan) {
        var planData = {
          exam_date: config.exam_date,
          exam_name: config.exam_name || config.exam_type || '',
          exam_type: config.exam_type || '',
          province: config.province || '',
          mock_exam_count: config.mock_exam_count || 120,
          position: config.position || '',
          requirements: config.requirements || '',
          business_model: config.business_model || {},
        };
        // Compute phases from exam_date
        if (config.exam_date) {
          var endD = new Date(config.exam_date + 'T00:00:00');
          var nowD = new Date();
          var totalDays = Math.max(1, Math.ceil((endD - nowD) / 86400000));
          var phaseLen = Math.ceil(totalDays / 3);
          var p1s = new Date(nowD); var p1e = new Date(p1s); p1e.setDate(p1e.getDate() + phaseLen);
          var p2s = new Date(p1e); p2s.setDate(p2s.getDate() + 1); var p2e = new Date(p2s); p2e.setDate(p2e.getDate() + phaseLen);
          var p3s = new Date(p2e); p3s.setDate(p3s.getDate() + 1);
          planData.phases = {
            '基础期': p1s.toISOString().slice(0,10) + ' ~ ' + p1e.toISOString().slice(0,10),
            '强化期': p2s.toISOString().slice(0,10) + ' ~ ' + p2e.toISOString().slice(0,10),
            '冲刺期': p3s.toISOString().slice(0,10) + ' ~ ' + config.exam_date,
          };
        }
        await writeFile(name, '备考计划.json', JSON.stringify(planData, null, 2));
      }
    }

    return rec;
  }

  async function deleteProject(name) {
    const db = await openDB();
    // 删除项目记录
    const t1 = db.transaction('projects', 'readwrite');
    t1.objectStore('projects').delete(name);
    // 删除项目下所有文件
    const fileIds = await listFiles(name, '');
    const t2 = db.transaction('files', 'readwrite');
    const store = t2.objectStore('files');
    for (const p of fileIds) {
      store.delete(projectId(name, p));
    }
    // 删除项目下所有会话
    const t3 = db.transaction('sessions', 'readwrite');
    const sStore = t3.objectStore('sessions');
    const idx = sStore.index('project');
    const range = IDBKeyRange.only(name);
    const sessions = await new Promise((resolve, reject) => {
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const s of sessions) {
      sStore.delete(s.id);
    }
    return new Promise((resolve, reject) => {
      t3.oncomplete = () => resolve();
      t3.onerror = () => reject(t3.error);
    });
  }

  // ── 会话 CRUD ────────────────────────────────────────────────

  async function listSessions(project) {
    const db = await openDB();
    const t = db.transaction('sessions', 'readonly');
    const idx = t.objectStore('sessions').index('project');
    return storeReq(idx, 'getAll', IDBKeyRange.only(project));
  }

  async function getSession(id) {
    const db = await openDB();
    const t = db.transaction('sessions', 'readonly');
    return storeReq(t.objectStore('sessions'), 'get', id);
  }

  async function saveSession(session) {
    const db = await openDB();
    const t = db.transaction('sessions', 'readwrite');
    await storeReq(t.objectStore('sessions'), 'put', session);
  }

  async function deleteSession(id) {
    const db = await openDB();
    const t = db.transaction('sessions', 'readwrite');
    await storeReq(t.objectStore('sessions'), 'delete', id);
  }

  async function clearSessions(project) {
    const sessions = await listSessions(project);
    const db = await openDB();
    const t = db.transaction('sessions', 'readwrite');
    const store = t.objectStore('sessions');
    for (const s of sessions) {
      store.delete(s.id);
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(sessions.length);
      t.onerror = () => reject(t.error);
    });
  }

  // ── 离线同步队列 ─────────────────────────────────────────────
  async function enqueueSync(change) {
    const db = await openDB();
    const t = db.transaction('sync_queue', 'readwrite');
    const rec = Object.assign({
      id: 'sync-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      created_at: new Date().toISOString(),
    }, change || {});
    await storeReq(t.objectStore('sync_queue'), 'put', rec);
    return rec;
  }

  async function listSyncQueue(project) {
    const db = await openDB();
    const t = db.transaction('sync_queue', 'readonly');
    const store = t.objectStore('sync_queue');
    if (!project) return storeReq(store, 'getAll');
    return storeReq(store.index('project'), 'getAll', IDBKeyRange.only(project));
  }

  async function removeSyncQueue(ids) {
    if (!ids || !ids.length) return 0;
    const db = await openDB();
    const t = db.transaction('sync_queue', 'readwrite');
    const store = t.objectStore('sync_queue');
    ids.forEach(function(id) { store.delete(id); });
    return new Promise(function(resolve, reject) {
      t.oncomplete = function() { resolve(ids.length); };
      t.onerror = function() { reject(t.error); };
    });
  }

  // ── 数据导出/导入 ────────────────────────────────────────────

  /** 导出项目所有数据为 JSON 对象 */
  async function exportProject(name) {
    const project = await getProject(name);
    const schema = await getSchemaInfo();
    const db = await openDB();
    const t = db.transaction('files', 'readonly');
    const store = t.objectStore('files');
    const idx = store.index('project');
    const all = await storeReq(idx, 'getAll', IDBKeyRange.only(name));
    return {
      schema_version: SCHEMA_VERSION,
      db_version: DB_VERSION,
      exported_at: new Date().toISOString(),
      schema,
      project,
      files: all,
    };
  }

  /** 导入项目数据 */
  async function importProject(data) {
    const normalized = normalizeImportData(data);
    await createProject(normalized.project.name, normalized.project.config);
    await saveProjectRecord(normalized.project);
    if (normalized.files.length) {
      const db = await openDB();
      const t = db.transaction('files', 'readwrite');
      const store = t.objectStore('files');
      for (const f of normalized.files) {
        store.put(f);
      }
      await new Promise((resolve, reject) => {
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    }
    return {
      project: normalized.project,
      files_imported: normalized.files.length,
      schema_version: normalized.schema_version,
    };
  }

  // ── 辅助 ─────────────────────────────────────────────────────

  function projectId(project, path) {
    return project + ':' + path;
  }

  async function saveProjectRecord(project) {
    const db = await openDB();
    const t = db.transaction('projects', 'readwrite');
    await storeReq(t.objectStore('projects'), 'put', project);
  }

  function normalizeImportData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('导入失败：备份文件不是有效 JSON 对象');
    }
    const rawProject = data.project;
    if (!rawProject || typeof rawProject.name !== 'string' || !rawProject.name.trim()) {
      throw new Error('导入失败：缺少 project.name');
    }
    const incomingSchema = Number(data.schema_version || (data.schema && data.schema.schema_version) || 1);
    if (!Number.isFinite(incomingSchema) || incomingSchema < 1) {
      throw new Error('导入失败：schema_version 无效');
    }
    if (incomingSchema > SCHEMA_VERSION) {
      throw new Error('导入失败：备份版本过高，请先升级应用');
    }
    const projectName = rawProject.name.trim().slice(0, 80);
    const now = new Date().toISOString();
    const project = {
      name: projectName,
      config: rawProject.config && typeof rawProject.config === 'object' ? rawProject.config : {},
      created: typeof rawProject.created === 'string' ? rawProject.created : now,
      modified: now,
    };
    const rawFiles = Array.isArray(data.files) ? data.files : [];
    const maxFiles = 5000;
    const maxBytes = 20 * 1024 * 1024;
    if (rawFiles.length > maxFiles) {
      throw new Error('导入失败：文件数量超过 ' + maxFiles + ' 个上限');
    }
    let totalBytes = 0;
    const files = rawFiles.map(function(f, idx) {
      if (!f || typeof f !== 'object') {
        throw new Error('导入失败：第 ' + (idx + 1) + ' 个文件记录无效');
      }
      if (typeof f.path !== 'string' || !f.path.trim()) {
        throw new Error('导入失败：第 ' + (idx + 1) + ' 个文件缺少 path');
      }
      const cleanPath = normalizePath(f.path);
      const content = f.content == null ? '' : String(f.content);
      totalBytes += new Blob([content]).size;
      if (totalBytes > maxBytes) {
        throw new Error('导入失败：解压后的数据超过 20MB 上限');
      }
      const mtime = typeof f.mtime === 'string' ? f.mtime : now;
      const ctime = typeof f.ctime === 'string' ? f.ctime : mtime;
      return {
        id: projectId(projectName, cleanPath),
        project: projectName,
        path: cleanPath,
        content: content,
        type: cleanPath.endsWith('.json') ? 'json' : (typeof f.type === 'string' && f.type ? f.type : 'md'),
        size: content.length,
        ctime: ctime,
        mtime: mtime,
      };
    });
    return {
      schema_version: incomingSchema,
      project: project,
      files: files,
    };
  }

  function normalizePath(path) {
    const clean = String(path).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.indexOf('\0') >= 0) {
      throw new Error('导入失败：文件路径无效');
    }
    const parts = clean.split('/');
    if (parts.some(function(p) { return !p || p === '.' || p === '..'; })) {
      throw new Error('导入失败：文件路径包含非法片段：' + clean);
    }
    return clean;
  }

  // ── 对外接口 ─────────────────────────────────────────────────

  return {
    openDB,
    getSchemaInfo,
    readFile,
    getFileRecord,
    markFileSynced,
    writeFile,
    deleteFile,
    listFiles,
    listDir,
    deletePrefix,
    listProjects,
    getProject,
    createProject,
    deleteProject,
    listSessions,
    getSession,
    saveSession,
    deleteSession,
    clearSessions,
    enqueueSync,
    listSyncQueue,
    removeSyncQueue,
    exportProject,
    importProject,
  };
})();
