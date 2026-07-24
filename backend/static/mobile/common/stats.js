// ===== Stats Engine — 统计计算引擎 =====
// 1:1 翻译自 backend/stats.py，所有文件 I/O 通过 LocalStore
// 纯确定性计算，零 LLM 依赖

const Stats = (() => {
  // ── 日期工具 ─────────────────────────────────────────────────
  function _today() { return API.getLocalDate(); }

  function _tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return _fmtDate(d);
  }

  // Add N days to a date string — uses date arithmetic (not ms) to avoid DST issues
  function _addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return _fmtDate(d);
  }

  function _daysBetween(d1, d2) {
    try {
      return Math.round((new Date(d1) - new Date(d2)) / 86400000);
    } catch (e) { return 0; }
  }

  function _letterGrade(score) {
    if (score >= 95) return 'S';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'D';
  }

  function _isEssayModule(mod) { return mod === '申论'; }

  // ── 阶段权重 ─────────────────────────────────────────────────
  const PHASE_WEIGHTS = {
    '基础期': { acc: 0.70, spd: 0.00, stb: 0.20, rec: 0.10 },
    '强化期': { acc: 0.45, spd: 0.25, stb: 0.20, rec: 0.10 },
    '冲刺期': { acc: 0.35, spd: 0.35, stb: 0.20, rec: 0.10 },
  };

  const PHASE_THRESHOLDS = {
    '基础期': { mProf: 0.70, mAtt: 15, rProf: 0.50, rAtt: 8, wProf: 0.60, wAtt: 5 },
    '强化期': { mProf: 0.75, mAtt: 20, rProf: 0.55, rAtt: 10, wProf: 0.65, wAtt: 8 },
    '冲刺期': { mProf: 0.80, mAtt: 25, rProf: 0.60, rAtt: 12, wProf: 0.70, wAtt: 10 },
  };

  const ESSAY_THRESHOLDS = {
    '基础期': { mProf: 0.70, mAtt: 3, rProf: 0.50, rAtt: 2, wProf: 0.60, wAtt: 2 },
    '强化期': { mProf: 0.75, mAtt: 4, rProf: 0.55, rAtt: 3, wProf: 0.65, wAtt: 3 },
    '冲刺期': { mProf: 0.80, mAtt: 5, rProf: 0.60, rAtt: 4, wProf: 0.70, wAtt: 3 },
  };

  const DEFAULT_KP = {
    status: '学习中', last_studied: '',
    accuracy: 0, proficiency: 0,
    accuracy_ema: 0, speed_factor: 1.0,
    recency_days: 0, stability: 0.5,
    attempts: 0, correct: 0,
    avg_time_seconds: 0, trend: 'new', trend_delta: 0,
    confidence: '不足',
    by_difficulty: {
      '★': { attempts: 0, correct: 0 },
      '★★': { attempts: 0, correct: 0 },
      '★★★': { attempts: 0, correct: 0 },
    },
    errors: { '概念性错误': 0, '理解性错误': 0, '执行性错误': 0, dominant: '' },
    plateau: { is_plateau: false, sessions_at_level: 0, avg_accuracy: 0 },
    review: { last_date: null, last_accuracy: null, total: 0, accuracies: [] },
    roi: { score: 0, attempts_to_master: null, learning_rate: 0 },
  };

  function _copyDefaultKP() { return JSON.parse(JSON.stringify(DEFAULT_KP)); }

  // ── I/O helpers ──────────────────────────────────────────────
  async function _readJSON(path) {
    const proj = API._activeProject();
    const content = await API.Repository.readFile(proj, path);
    return content ? JSON.parse(content) : {};
  }

  async function _writeJSON(path, data) {
    const proj = API._activeProject();
    await API.Repository.writeFile(proj, path, JSON.stringify(data, null, 2));
  }

  function _dailyIndexRecord(date, data) {
    const record = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : {};
    record.date = date;
    record.path = '每日完成/' + date + '.json';
    return record;
  }

  async function _updateDailyCompletionIndex(date, daily) {
    const path = '索引/每日完成索引.json';
    let index = await _readJSON(path);
    if (!index || Object.keys(index).length === 0) index = { version: 1, records: {} };
    index.version = 1;
    index.records = index.records || {};
    index.records[date] = _dailyIndexRecord(date, daily);
    index.updated_at = new Date().toISOString();
    index.built_at = index.built_at || index.updated_at;
    await _writeJSON(path, index);
  }

  function _wrongBookItemId(item) {
    return ['wb', item.module || '', item.date || '', item.qNum || item.q || '', item.file || item.file_path || ''].join('|');
  }

  async function _upsertWrongBookIndex(items) {
    if (!items || !items.length) return;
    const path = '索引/错题索引.json';
    let index = await _readJSON(path);
    if (!index || Object.keys(index).length === 0) index = { version: 1, items: [] };
    index.version = 1;
    index.items = index.items || [];
    const byId = {};
    index.items.forEach(function(item, idx) {
      if (item && item.id) byId[item.id] = idx;
    });
    items.forEach(function(item) {
      const normalized = Object.assign({}, item);
      normalized.id = normalized.id || _wrongBookItemId(normalized);
      normalized.updated_at = new Date().toISOString();
      if (byId[normalized.id] >= 0) index.items[byId[normalized.id]] = normalized;
      else {
        byId[normalized.id] = index.items.length;
        index.items.push(normalized);
      }
    });
    index.updated_at = new Date().toISOString();
    index.built_at = index.built_at || index.updated_at;
    await _writeJSON(path, index);
  }

  async function _readText(path) {
    const proj = API._activeProject();
    return await API.Repository.readFile(proj, path) || '';
  }

  async function _getCurrentPhase() {
    const plan = await _readJSON('备考计划.json');
    if (!plan) return '基础期';
    if (plan.phase) return plan.phase;  // explicit phase if present
    if (!plan.phases || !plan.exam_date) return '基础期';
    // Derive phase from plan.phases date ranges (matches home.html countdown logic)
    const phases = ['基础期', '强化期', '冲刺期'];
    let startD = new Date();
    for (let i = 0; i < phases.length; i++) {
      const r = plan.phases[phases[i]];
      if (typeof r === 'string') {
        const m = r.match(/(\d{4}-\d{2}-\d{2})/);
        if (m) { startD = new Date(m[1] + 'T00:00:00'); break; }
      }
    }
    const endD = new Date(plan.exam_date + 'T00:00:00');
    const td = Math.max(1, Math.ceil((endD - startD) / 86400000));
    const ed = Math.max(0, Math.ceil((new Date() - startD) / 86400000));
    return phases[Math.min(2, Math.floor(ed / Math.max(1, td / 3)))];
  }

  // ── EMA ──────────────────────────────────────────────────────
  function _computeEma(records, oldEma) {
    if (!records || records.length === 0) {
      return oldEma != null ? oldEma : 0;
    }
    const alpha = 0.3;
    let ema = oldEma != null ? oldEma : (records[0].accuracy || 0);
    const start = oldEma != null ? 0 : 1;
    for (let i = start; i < records.length; i++) {
      ema = alpha * (records[i].accuracy || 0) + (1 - alpha) * ema;
    }
    return Math.round(ema * 10000) / 10000;
  }

  // ── 速度因子 ─────────────────────────────────────────────────
  async function _computeSpeedFactor(avgTimeSeconds, module) {
    if (avgTimeSeconds <= 0) return 1.0;
    const plan = await _readJSON('备考计划.json');
    const standards = plan.time_standards || {};
    const modStd = standards[module];
    const standard = (modStd && modStd.seconds_per_q) ? modStd.seconds_per_q : 60;
    if (standard <= 0) return 1.0;
    const ratio = standard / avgTimeSeconds;
    return Math.round(Math.min(1.0, ratio) * 1000) / 1000;
  }

  // ── 新鲜度衰减 ───────────────────────────────────────────────
  function _computeRecencyFactor(lastStudied) {
    if (!lastStudied) return 0.3;
    const days = _daysBetween(_today(), lastStudied);
    if (days <= 0) return 1.0;
    if (days >= 60) return 0.3;
    return Math.round((1.0 - 0.7 * (days / 60)) * 1000) / 1000;
  }

  // ── 稳定性 ───────────────────────────────────────────────────
  function _computeStability(records) {
    const accs = (records || []).filter(r => (r.total || 0) >= 3).map(r => r.accuracy || 0);
    if (accs.length < 2) return 0.5;
    const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
    if (mean === 0) return 0.5;
    const variance = accs.reduce((s, a) => s + (a - mean) ** 2, 0) / accs.length;
    const std = Math.sqrt(variance);
    const cv = std / mean;
    const stability = 1.0 - Math.min(cv, 1.0);
    return Math.round(Math.max(0.3, stability) * 1000) / 1000;
  }

  // ── 置信度 ───────────────────────────────────────────────────
  function _computeConfidence(attempts) {
    if (attempts < 5) return '不足';
    if (attempts < 15) return '一般';
    if (attempts < 30) return '充分';
    return '非常充分';
  }

  // ── 趋势 ─────────────────────────────────────────────────────
  function _computeTrendV2(records) {
    if (!records || records.length < 2) return ['new', 0];
    const split = Math.max(1, Math.floor(records.length * 2 / 5));
    const recent = records.slice(-split);
    const earlier = records.slice(0, -split);
    if (earlier.length === 0) return ['new', 0];
    const recentAvg = recent.reduce((s, r) => s + (r.accuracy || 0), 0) / recent.length;
    const earlierAvg = earlier.reduce((s, r) => s + (r.accuracy || 0), 0) / earlier.length;
    const delta = Math.round((recentAvg - earlierAvg) * 10000) / 10000;
    if (delta > 0.05) return ['上升', delta];
    if (delta < -0.05) return ['下降', delta];
    return ['稳定', delta];
  }

  // ── 熟练度 ───────────────────────────────────────────────────
  function _computeProficiency(accuracyEma, speedFactor, recencyFactor, stability, phase) {
    const w = PHASE_WEIGHTS[phase] || PHASE_WEIGHTS['基础期'];
    const raw = accuracyEma * w.acc + speedFactor * w.spd + stability * w.stb + recencyFactor * w.rec;
    return Math.round(Math.min(1.0, raw) * 10000) / 10000;
  }

  // ── 高原期检测 ───────────────────────────────────────────────
  function _detectPlateau(records, threshold) {
    threshold = threshold || 4;
    if (!records || records.length < threshold) {
      return { is_plateau: false, sessions_at_level: 0, avg_accuracy: 0 };
    }
    const recent = records.slice(-threshold);
    const accs = recent.filter(r => (r.total || 0) >= 3).map(r => r.accuracy || 0);
    if (accs.length < threshold) {
      return { is_plateau: false, sessions_at_level: 0, avg_accuracy: 0 };
    }
    const avg = accs.reduce((a, b) => a + b, 0) / accs.length;
    if (accs.every(a => Math.abs(a - avg) <= 0.08)) {
      return { is_plateau: true, sessions_at_level: accs.length, avg_accuracy: Math.round(avg * 1000) / 1000 };
    }
    return { is_plateau: false, sessions_at_level: 0, avg_accuracy: Math.round(avg * 1000) / 1000 };
  }

  // ── ROI ──────────────────────────────────────────────────────
  function _computeRoi(attempts, proficiency, isMastered) {
    if (attempts < 3) return { score: 0, attempts_to_master: null, learning_rate: 0 };
    const learningRate = attempts > 0 ? Math.round(proficiency / attempts * 10000) / 10000 : 0;
    const roi = Math.round(Math.min(1.0, proficiency * (isMastered ? 1.0 : 0.5) * Math.min(1.0, 30 / Math.max(attempts, 1))) * 1000) / 1000;
    return { score: roi, attempts_to_master: isMastered ? attempts : null, learning_rate: learningRate };
  }

  // ── 状态判定 ─────────────────────────────────────────────────
  function _determineStatus(proficiency, attempts, recencyDays, isEssay, phase) {
    if (attempts < 3) return ['学习中', false];
    const t = (isEssay ? ESSAY_THRESHOLDS : PHASE_THRESHOLDS)[phase] || PHASE_THRESHOLDS['基础期'];
    const isMastered = proficiency >= t.mProf && attempts >= t.mAtt && recencyDays <= 30;
    const needRelearn = proficiency < t.rProf && attempts >= t.rAtt;
    if (isMastered) return ['已掌握', true];
    if (needRelearn) return ['需重学', false];
    if (proficiency < t.wProf && attempts >= t.wAtt) return ['薄弱', false];
    return ['学习中', false];
  }

  // ── 练习统计更新 ─────────────────────────────────────────────
  async function updatePracticeStats(module, knowledgePoint, total, correct, timeSeconds, date, batchLabel) {
    batchLabel = batchLabel || '首次';
    const path = '练习统计.json';
    let stats = await _readJSON(path);
    if (!stats || Object.keys(stats).length === 0) {
      stats = { records_summary: { total_sessions: 0, total_questions: 0, total_correct: 0, overall_accuracy: 0, by_module: {} }, records: [] };
    }
    const records = stats.records || [];
    const newId = records.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
    const avgTime = total > 0 ? Math.round(timeSeconds / total * 10) / 10 : 0;

    const record = {
      id: newId, date, module, knowledge_point: knowledgePoint, batch: batchLabel,
      total, correct,
      accuracy: total > 0 ? Math.round(correct / total * 1000) / 1000 : 0,
      time_seconds: timeSeconds, avg_time_seconds: avgTime,
    };
    records.push(record);

    const totalQ = records.reduce((s, r) => s + r.total, 0);
    const totalC = records.reduce((s, r) => s + r.correct, 0);
    const overallAcc = totalQ > 0 ? Math.round(totalC / totalQ * 1000) / 1000 : 0;

    const byModule = {};
    records.forEach(r => {
      const m = r.module;
      if (!byModule[m]) byModule[m] = { sessions: 0, questions: 0, correct: 0, accuracy: 0 };
      byModule[m].sessions += 1;
      byModule[m].questions += r.total;
      byModule[m].correct += r.correct;
    });
    Object.keys(byModule).forEach(m => {
      byModule[m].accuracy = Math.round(byModule[m].correct / byModule[m].questions * 1000) / 1000;
    });

    // Unique (date, module) session count
    const sessionSet = new Set(records.map(r => r.date + '|' + r.module));
    stats.records_summary = { total_sessions: sessionSet.size, total_questions: totalQ, total_correct: totalC, overall_accuracy: overallAcc, by_module: byModule };
    stats.records = records;
    await _writeJSON(path, stats);
    return stats.records_summary;
  }

  // ── 能力画像更新 ─────────────────────────────────────────────
  async function updateAbilityProfile(module, knowledgePoints, totalPerKp, correctPerKp, date, avgTimePerKp, errorsPerKp, difficultyPerKp, mode) {
    mode = mode || 'practice';
    avgTimePerKp = avgTimePerKp || {};
    errorsPerKp = errorsPerKp || {};
    difficultyPerKp = difficultyPerKp || {};

    const path = '能力画像.json';
    let profile = await _readJSON(path);
    if (!profile || Object.keys(profile).length === 0) {
      profile = { modules: {}, mock_exam_history: [], diagnostic_complete: false };
    }
    const modules = profile.modules = profile.modules || {};
    profile.mock_exam_history = profile.mock_exam_history || [];
    let mod = modules[module] = modules[module] || {};

    // Resolve KP name: try exact match, then suffix match
    function resolveKp(name) {
      if (mod[name]) return name;
      for (const existing of Object.keys(mod)) {
        if (existing.endsWith('-' + name) || name.endsWith('-' + existing)) return existing;
      }
      return name;
    }

    const updatedKps = {};
    const phase = await _getCurrentPhase();

    const statsForHistory = await _readJSON('练习统计.json');
    const allRecordsForHistory = statsForHistory.records || [];

    for (let kpName of knowledgePoints) {
      kpName = resolveKp(kpName);
      let kp = mod[kpName] || _copyDefaultKP();

      const nTotal = totalPerKp[kpName] || 0;
      const nCorrect = correctPerKp[kpName] || 0;
      const avgTime = avgTimePerKp[kpName] || kp.avg_time_seconds || 0;

      const newAttempts = (kp.attempts || 0) + nTotal;
      const newCorrect = (kp.correct || 0) + nCorrect;
      const newAvgTime = newAttempts > 0
        ? Math.round(((kp.avg_time_seconds || 0) * (kp.attempts || 0) + avgTime * nTotal) / newAttempts * 10) / 10
        : 0;

      // Get session history from the already-loaded practice stats.
      const history = allRecordsForHistory
        .filter(r => r.module === module && r.knowledge_point && r.knowledge_point.split(',').map(function(s){return s.trim();}).indexOf(kpName) >= 0)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      const oldEma = kp.accuracy_ema;
      const accuracyEma = _computeEma(history, oldEma);
      const speedFactor = await _computeSpeedFactor(newAvgTime, module);
      const recencyFactor = _computeRecencyFactor(date);
      const recencyDays = _daysBetween(_today(), date);
      const stability = _computeStability(history);
      const proficiency = _computeProficiency(accuracyEma, speedFactor, recencyFactor, stability, phase);
      const confidence = _computeConfidence(newAttempts);
      const [trendLabel, trendDelta] = _computeTrendV2(history);

      const [status, isMastered] = _determineStatus(proficiency, newAttempts, recencyDays, _isEssayModule(module), phase);
      const rawAccuracy = newAttempts > 0 ? Math.round(newCorrect / newAttempts * 1000) / 1000 : 0;

      // v3: difficulty
      const byDiff = JSON.parse(JSON.stringify(kp.by_difficulty || DEFAULT_KP.by_difficulty));
      if (difficultyPerKp[kpName]) {
        const stars = ['★', '★★', '★★★'];
        stars.forEach(star => {
          const d = difficultyPerKp[kpName][star];
          if (d && byDiff[star]) {
            byDiff[star].attempts += d.total || 0;
            byDiff[star].correct += d.correct || 0;
          }
        });
      }

      // v3: errors
      const err = JSON.parse(JSON.stringify(kp.errors || DEFAULT_KP.errors));
      if (errorsPerKp[kpName]) {
        ['概念性错误', '理解性错误', '执行性错误'].forEach(etype => {
          err[etype] = (err[etype] || 0) + (errorsPerKp[kpName][etype] || 0);
        });
        const maxType = ['概念性错误', '理解性错误', '执行性错误'].reduce((a, b) => (err[a] || 0) >= (err[b] || 0) ? a : b);
        err.dominant = (err[maxType] || 0) > 0 ? maxType : '';
      }

      // v3: plateau
      const plateau = _detectPlateau(history);
      const roi = _computeRoi(newAttempts, proficiency, isMastered);

      // v3: review
      const rv = JSON.parse(JSON.stringify(kp.review || DEFAULT_KP.review));
      if (mode === 'review' || mode === 'mock_exam') {
        rv.last_date = date;
        rv.last_accuracy = rawAccuracy;
        rv.total += 1;
        rv.accuracies = [...(rv.accuracies || []), rawAccuracy].slice(-10);
      }

      Object.assign(kp, {
        status, last_studied: date,
        accuracy: rawAccuracy, proficiency,
        accuracy_ema: accuracyEma, speed_factor: speedFactor,
        recency_days: recencyDays, stability,
        attempts: newAttempts, correct: newCorrect,
        avg_time_seconds: newAvgTime,
        trend: trendLabel, trend_delta: trendDelta,
        confidence,
        by_difficulty: byDiff, errors: err, plateau, roi, review: rv,
      });
      mod[kpName] = kp;
      updatedKps[kpName] = {
        attempts: newAttempts, correct: newCorrect,
        accuracy: rawAccuracy, proficiency,
        status, is_mastered: isMastered,
        confidence, trend: trendLabel,
        errors_dominant: err.dominant || '',
        plateau: plateau.is_plateau,
        roi_score: roi.score,
      };
    }

    modules[module] = mod;
    profile.modules = modules;
    await _writeJSON(path, profile);
    return updatedKps;
  }

  // ── 复习队列 ─────────────────────────────────────────────────
  async function updateReviewQueue(module, knowledgePoint, accuracy, isMastered) {
    const path = '复习队列.json';
    let queueData = await _readJSON(path);
    if (!queueData || Object.keys(queueData).length === 0) queueData = { queue: [] };
    let queue = queueData.queue || [];

    const existingIdx = queue.findIndex(e => e.module === module && e.knowledge_point === knowledgePoint);
    let result = null;

    if (existingIdx >= 0) {
      const existing = queue[existingIdx];
      if (accuracy >= 0.80) {
        const intervalMap = { 1: 3, 3: 7, 7: 15, 15: 30, 30: 60 };
        const newInterval = intervalMap[existing.interval_days] || 61;
        if (newInterval >= 60) {
          queue.splice(existingIdx, 1);
          result = { action: 'removed', reason: 'fully_mastered' };
        } else {
          existing.interval_days = newInterval;
          existing.next_review = _addDays(_today(), newInterval);
          existing.review_count = (existing.review_count || 0) + 1;
          existing._consecutive_fails = 0;
          result = { action: 'interval_extended', new_interval: newInterval };
        }
      } else {
        const oldInterval = existing.interval_days;
        const newInterval = Math.max(1, Math.floor(oldInterval / 2));
        existing.interval_days = newInterval;
        existing.next_review = _fmtDate(new Date(Date.now() + newInterval * 86400000));
        existing.review_count = (existing.review_count || 0) + 1;
        existing._consecutive_fails = (existing._consecutive_fails || 0) + 1;
        if (existing._consecutive_fails >= 2) {
          queue.splice(existingIdx, 1);
          result = { action: 'removed', reason: 'consecutive_fails', note: 'syllabus should be reset to 未学' };
        } else {
          result = { action: 'interval_halved', new_interval: newInterval };
        }
      }
    } else if (isMastered) {
      queue.push({
        module, knowledge_point: knowledgePoint,
        interval_days: 1, next_review: _tomorrow(), review_count: 0,
      });
      result = { action: 'added', interval: 1 };
    }

    // Strip internal fields
    // _consecutive_fails is persisted across sessions (reset on success, increment on fail)
    queueData.queue = queue;
    await _writeJSON(path, queueData);
    return result;
  }

  function _fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ── 每日评分 ─────────────────────────────────────────────────
  async function updateDailyCompletion(date, moduleResults, lectureCompleted, extraPractice, timeSeconds, timeSuggestedSeconds, comment) {
    if (lectureCompleted === undefined) lectureCompleted = true;
    if (extraPractice === undefined) extraPractice = false;
    timeSeconds = timeSeconds || 0;
    timeSuggestedSeconds = timeSuggestedSeconds || 0;
    comment = comment || '';

    const path = '每日完成/' + date + '.json';
    let existing = await _readJSON(path);
    if (!existing || Object.keys(existing).length === 0) existing = {};

    const allModules = existing.modules ? JSON.parse(JSON.stringify(existing.modules)) : {};
    Object.keys(moduleResults).forEach(modName => {
      const mr = moduleResults[modName];
      if (allModules[modName]) {
        allModules[modName].total = (allModules[modName].total || 0) + (mr.total || 0);
        allModules[modName].correct = (allModules[modName].correct || 0) + (mr.correct || 0);
        allModules[modName].accuracy = allModules[modName].total > 0 ? Math.round(allModules[modName].correct / allModules[modName].total * 1000) / 1000 : 0;
      } else {
        allModules[modName] = { accuracy: mr.accuracy || 0, correct: mr.correct || 0, total: mr.total || 0 };
      }
    });

    const totalQ = Object.values(allModules).reduce((s, m) => s + m.total, 0);
    const totalC = Object.values(allModules).reduce((s, m) => s + m.correct, 0);
    const overallAcc = totalQ > 0 ? Math.round(totalC / totalQ * 1000) / 1000 : 0;

    const accuracyScore = Math.round(overallAcc * 50);
    let completionScore = lectureCompleted ? 8 : 0;
    const completedModules = Object.values(allModules).filter(m => m.total > 0).length;
    completionScore += Math.min(18, completedModules * 6);
    if (extraPractice) completionScore += 4;

    let timeScore = 20;
    if (timeSuggestedSeconds > 0 && timeSeconds > 0) {
      const ratio = timeSeconds / timeSuggestedSeconds;
      if (ratio <= 1.0) timeScore = 20;
      else if (ratio <= 1.5) timeScore = 10;
      else timeScore = 0;
    }

    const totalScore = Math.min(100, accuracyScore + completionScore + timeScore);
    const grade = _letterGrade(totalScore);
    const finalComment = comment || _defaultComment(grade, overallAcc);

    const daily = {
      overall: { score: totalScore, grade, accuracy: overallAcc, total_questions: totalQ, total_correct: totalC, accuracy_score: accuracyScore, completion_score: completionScore, time_score: timeScore, comment: finalComment },
      modules: allModules,
    };

    // Merge with existing
    const merged = Object.assign(JSON.parse(JSON.stringify(existing)), daily);
    await _writeJSON(path, merged);
    await _updateDailyCompletionIndex(date, merged);
    return merged;
  }

  function _defaultComment(grade, accuracy) {
    if (grade === 'S') return '表现优异，继续保持！';
    if (grade === 'A') return '完成不错，还有提升空间。';
    if (grade === 'B') return '基础还可以，需要针对薄弱点加强。';
    if (grade === 'C') return '需要更多练习，建议回顾讲义内容。';
    return '基础薄弱，建议重新学习知识点再做题。';
  }

  // ── 课程大纲 ─────────────────────────────────────────────────
  async function updateSyllabus(module, knowledgePoint, newStatus) {
    const path = 'syllabus/' + module + '.json';
    const syllabus = await _readJSON(path);
    if (!syllabus || Object.keys(syllabus).length === 0) return false;
    // syllabus is keyed by submodule names, each value is an array of {name, status}
    for (const sub in syllabus) {
      if (!syllabus.hasOwnProperty(sub)) continue;
      const items = syllabus[sub];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item.name === knowledgePoint) {
          item.status = newStatus;
          await _writeJSON(path, syllabus);
          return true;
        }
      }
    }
    return false;
  }

  // ── 错题提取 ─────────────────────────────────────────────────
  async function _extractQuestionFromPractice(filePath, qNum) {
    if (!qNum) return '';
    const content = await _readText(filePath);
    if (!content) return '';
    const blocks = content.split(/\n---\n/);
    const marker = '**' + qNum + '.**';
    for (const block of blocks) {
      const trimmed = block.trim();
      if (trimmed.startsWith(marker)) {
        return trimmed
          .replace(/<div\s+class="(?:answer-block|grading-block)[^"]*".*?<\/div>\s*/gs, '')
          .trim();
      }
    }
    return '';
  }

  // ── 错题本追加 ───────────────────────────────────────────────
  async function appendWrongBook(module, date, wrongItems) {
    if (_isEssayModule(module)) return '';
    const dir = '错题本';
    const filePath = dir + '/' + module + '.md';

    const lines = [];
    const indexItems = [];
    for (const item of wrongItems) {
      const qRaw = item.q || '?';
      const q = String(qRaw).replace(/^Q/i, '');
      const qLabel = q === '?' ? '?' : ('Q' + q);
      const kp = item.knowledge_point || '';
      const fp = item.file_path || ('练习/' + module + '/' + date + '.md');
      let questionText = await _extractQuestionFromPractice(fp, q);

      lines.push('### ' + qLabel + ' | ' + kp + ' | ' + date);
      lines.push('');
      lines.push('**原题：**');
      if (questionText) lines.push(questionText);
      lines.push('@see ' + fp + ' ' + qLabel);
      lines.push('');
      lines.push('**你的答案：** ' + (item.your_answer || item.user_answer || '?'));
      lines.push('**正确答案：** ' + (item.correct_answer || '?'));
      const errorType = item.error_type || '';
      const errorAnalysis = item.error_detail || item.error_analysis || '';
      const reason = errorType && errorAnalysis ? (errorType + ' — ' + errorAnalysis) : (errorType || errorAnalysis || '');
      lines.push('**错因：**');
      if (reason) lines.push(reason);
      const ca = item.correct_approach || '';
      if (ca) { lines.push('**正解：**'); lines.push(ca); }
      const tips = item.tips || '';
      if (tips) { lines.push('**技巧：**'); lines.push(tips); }
      lines.push('');
      indexItems.push({
        id: _wrongBookItemId({ module: module, date: date, qNum: qLabel, file: fp }),
        qNum: qLabel,
        module: module,
        subType: kp,
        date: date,
        stem: questionText,
        summary: (questionText || '').replace(/^\*\*\d+\.\*\*\s*(?:（[^）]*）\s*)?/, '').trim().substring(0, 80),
        correctAns: item.correct_answer || '',
        wrongAns: item.your_answer || item.user_answer || '',
        reason: reason,
        analysis: ca,
        fix: ca,
        tips: tips,
        fullText: questionText,
        file: fp,
        seeRef: { file: fp, qNum: qLabel },
        rawBlock: ''
      });
    }

    // Append to existing file
    const existing = await _readText(filePath);
    const content = existing ? existing + '\n' + lines.join('\n') : lines.join('\n');
    await API.Repository.writeFile(API._activeProject(), filePath, content);
    await _upsertWrongBookIndex(indexItems);
    return 'Appended ' + wrongItems.length + ' wrong questions to ' + filePath;
  }

  // ── 总编排器 ─────────────────────────────────────────────────
  async function processGradingResult(data) {
    const mode = data.mode || 'practice';
    const mod = data.module;
    const date = data.date;
    let knowledgePoints = data.knowledge_points || [];
    const results = data.results || [];
    const total = data.total;
    const correct = data.correct;
    const timeSeconds = data.time_seconds || 0;
    const timeSuggested = data.time_suggested_seconds || 0;
    const lectureCompleted = data.lecture_completed !== undefined ? data.lecture_completed : true;
    const extraPractice = data.extra_practice || false;
    const batchLabel = data.batch_label || '首次';
    const comment = data.comment || '';

    const summaryParts = [];

    // 1. Practice stats
    const statsSummary = await updatePracticeStats(mod, knowledgePoints.join(', '), total, correct, timeSeconds, date, batchLabel);
    summaryParts.push('练习统计: +' + total + '题, 正确' + correct + '/' + total + ' (' + (statsSummary.overall_accuracy * 100).toFixed(1) + '%)');

    // 2. Ability profile — deduplicate KPs
    const kpList = [...new Set(knowledgePoints)];
    if (kpList.length === 0) kpList.push('__default__');

    const totalPerKp = {};
    const correctPerKp = {};
    // Prefer per-question KP breakdown from results; fallback to even split
    const hasPerQKp = results.some(r => r.knowledge_point);
    if (hasPerQKp) {
      results.forEach(r => {
        const kp = r.knowledge_point || kpList[0] || '__default__';
        totalPerKp[kp] = (totalPerKp[kp] || 0) + 1;
        if (r.correct) correctPerKp[kp] = (correctPerKp[kp] || 0) + 1;
      });
      kpList.forEach(kp => { if (totalPerKp[kp] === undefined) { totalPerKp[kp] = 0; correctPerKp[kp] = 0; } });
    } else if (kpList.length === 1) {
      totalPerKp[kpList[0]] = total;
      correctPerKp[kpList[0]] = correct;
    } else {
      const base = Math.floor(total / kpList.length);
      let remainder = total % kpList.length;
      const cBase = Math.floor(correct / kpList.length);
      let cRem = correct % kpList.length;
      kpList.forEach((kp, i) => {
        totalPerKp[kp] = base + (i < remainder ? 1 : 0);
        correctPerKp[kp] = cBase + (i < cRem ? 1 : 0);
      });
    }

    const avgTime = total > 0 ? Math.round(timeSeconds / total * 10) / 10 : 0;
    const avgTimePerKp = {};
    kpList.forEach(kp => { avgTimePerKp[kp] = avgTime; });

    // v3: extract difficulty and errors from results
    const difficultyPerKp = {};
    const errorsPerKp = {};
    results.forEach(r => {
      const kp = r.knowledge_point || kpList[0] || '';
      const diff = r.difficulty || '★★';
      difficultyPerKp[kp] = difficultyPerKp[kp] || {};
      difficultyPerKp[kp][diff] = difficultyPerKp[kp][diff] || { total: 0, correct: 0 };
      difficultyPerKp[kp][diff].total += 1;
      if (r.correct) difficultyPerKp[kp][diff].correct += 1;
      if (!r.correct && r.error_type) {
        errorsPerKp[kp] = errorsPerKp[kp] || {};
        errorsPerKp[kp][r.error_type] = (errorsPerKp[kp][r.error_type] || 0) + 1;
      }
    });

    const kpResults = await updateAbilityProfile(mod, kpList, totalPerKp, correctPerKp, date, avgTimePerKp, errorsPerKp, difficultyPerKp, mode);
    Object.entries(kpResults).forEach(([kpName, kpr]) => {
      const extra = [];
      if (kpr.errors_dominant) extra.push('主导错因=' + kpr.errors_dominant);
      if (kpr.plateau) extra.push('⚠️高原期');
      if (kpr.roi_score > 0) extra.push('ROI=' + kpr.roi_score.toFixed(2));
      const extraStr = extra.length > 0 ? ' ' + extra.join(', ') : '';
      summaryParts.push('能力画像/' + kpName + ': 能力分' + (kpr.proficiency * 100).toFixed(1) + '% (原始' + (kpr.accuracy * 100).toFixed(1) + '%) 置信度=' + kpr.confidence + ' 趋势=' + kpr.trend + ' 状态=' + kpr.status + extraStr);
    });

    // 3. Review queue
    for (const [kpName, kpr] of Object.entries(kpResults)) {
      if (kpr.is_mastered) {
        const rqResult = await updateReviewQueue(mod, kpName, kpr.accuracy, true);
        if (rqResult) summaryParts.push('复习队列/' + kpName + ': ' + rqResult.action);
      }
    }

    // 4. Daily completion
    const moduleAcc = total > 0 ? Math.round(correct / total * 1000) / 1000 : 0;
    const daily = await updateDailyCompletion(date, { [mod]: { accuracy: moduleAcc, correct, total } }, lectureCompleted, extraPractice, timeSeconds, timeSuggested, comment);
    const ov = daily.overall;
    summaryParts.push('每日评分: ' + ov.score + '分/' + ov.grade + '级 (正确率' + ov.accuracy_score + '+完成度' + ov.completion_score + '+限时' + ov.time_score + ')');

    // 4.5 Mock exam history
    if (mode === 'mock_exam') {
      const profile = await _readJSON('能力画像.json');
      const mockHistory = profile.mock_exam_history || [];
      mockHistory.push({
        date, module: mod, total, correct,
        accuracy: total > 0 ? Math.round(correct / total * 1000) / 1000 : 0,
        time_seconds: timeSeconds,
      });
      profile.mock_exam_history = mockHistory;
      await _writeJSON('能力画像.json', profile);
      summaryParts.push('模考记录已保存 (共' + mockHistory.length + '次)');
    }

    // 5. Wrong book
    const wrongItems = results.filter(r => !r.correct);
    if (wrongItems.length > 0 && !_isEssayModule(mod)) {
      wrongItems.forEach(item => {
        if (!item.knowledge_point) item.knowledge_point = kpList[0] || '';
        if (!item.file_path) item.file_path = '练习/' + mod + '/' + date + '.md';
      });
      const wbResult = await appendWrongBook(mod, date, wrongItems);
      summaryParts.push(wbResult);
    }

    // 6. Syllabus
    for (const [kpName, kpr] of Object.entries(kpResults)) {
      if (kpr.status === '已掌握') {
        await updateSyllabus(mod, kpName, '已学');
        summaryParts.push('syllabus/' + mod + '/' + kpName + ' → 已学');
      }
    }

    return { ok: true, summary: summaryParts.join('\n'), daily_score: daily.overall };
  }

  async function handleUpdateStats(argsJSON) {
    let data;
    try { data = typeof argsJSON === 'string' ? JSON.parse(argsJSON) : argsJSON; }
    catch (e) { return 'Error: invalid JSON — ' + e.message; }

    const required = ['module', 'date', 'total', 'correct'];
    const missing = required.filter(k => !(k in data));
    if (missing.length > 0) return 'Error: missing required fields: ' + missing.join(', ');

    try {
      const result = await processGradingResult(data);
      return result.summary;
    } catch (e) {
      return 'Error updating stats: ' + e.message;
    }
  }

  // ── 错因分析报告 ─────────────────────────────────────────────
  // 聚合能力画像各 KP 的 errors 字段，输出按模块/知识点分层的错因分布
  async function generateErrorReport() {
    const profile = await _readJSON('能力画像.json');
    const modules = (profile && profile.modules) || {};

    const report = {
      date: _today(),
      total_errors: 0,
      error_distribution: { '概念性错误': 0, '理解性错误': 0, '执行性错误': 0 },
      modules: {},
      recommendations: [],
    };

    const weakKps = [];

    Object.entries(modules).forEach(([modName, mod]) => {
      // KP 直接挂在模块下（无 knowledge_points 层）
      const kpEntries = Object.entries(mod).filter(([k, v]) => v && typeof v === 'object' && 'attempts' in v);
      if (kpEntries.length === 0) return;

      const modData = { total_errors: 0, error_distribution: { '概念性错误': 0, '理解性错误': 0, '执行性错误': 0 }, by_kp: [] };

      kpEntries.forEach(([kpName, kp]) => {
        const errors = kp.errors || {};
        const concept = errors['概念性错误'] || 0;
        const understand = errors['理解性错误'] || 0;
        const execute = errors['执行性错误'] || 0;
        const kpErrs = concept + understand + execute;
        if (kpErrs === 0 && (kp.attempts || 0) === 0) return;

        modData.total_errors += kpErrs;
        modData.error_distribution['概念性错误'] += concept;
        modData.error_distribution['理解性错误'] += understand;
        modData.error_distribution['执行性错误'] += execute;

        const dominant = errors.dominant || '';
        modData.by_kp.push({
          name: kpName,
          proficiency: kp.proficiency || 0,
          error_type: dominant,
          error_count: kpErrs,
          plateau: (kp.plateau && kp.plateau.is_plateau) || false,
        });

        if ((kp.proficiency || 0) < 0.5 && (kp.attempts || 0) >= 3) {
          weakKps.push({ module: modName, kp: kpName, proficiency: kp.proficiency || 0, dominant });
        }
      });

      if (modData.total_errors > 0 || modData.by_kp.length > 0) {
        report.modules[modName] = modData;
        report.total_errors += modData.total_errors;
        report.error_distribution['概念性错误'] += modData.error_distribution['概念性错误'];
        report.error_distribution['理解性错误'] += modData.error_distribution['理解性错误'];
        report.error_distribution['执行性错误'] += modData.error_distribution['执行性错误'];
      }
    });

    const modNames = Object.keys(report.modules);

    if (modNames.length > 0 && report.total_errors > 0) {
      const sorted = Object.entries(report.error_distribution).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      if (top && top[1] > 0) {
        report.recommendations.push('主导错因为「' + top[0].replace('错误', '') + '」，占错题的 ' + Math.round(top[1] / report.total_errors * 100) + '%，建议针对性强化。');
      }
      if (weakKps.length > 0) {
        const w = weakKps[0];
        report.recommendations.push('最薄弱知识点：' + w.module + ' / ' + w.kp + '（掌握度 ' + Math.round(w.proficiency * 100) + '%），建议优先专项练习。');
      }
      const plateauKps = Object.values(report.modules).flatMap(m => m.by_kp).filter(k => k.plateau);
      if (plateauKps.length > 0) {
        report.recommendations.push('检测到 ' + plateauKps.length + ' 个知识点处于高原期，建议变换学习方法或寻求 AI 讲解突破瓶颈。');
      }
    }

    return report;
  }

  // ── 考前冲刺计划 ─────────────────────────────────────────────
  // 基于能力画像薄弱 KP + 距考天数，生成每日冲刺任务与紧急复习清单
  async function generateSprintPlan() {
    const plan = await _readJSON('备考计划.json');
    const profile = await _readJSON('能力画像.json');
    const modules = (profile && profile.modules) || {};

    let remainDays = 30;
    if (plan && plan.exam_date) {
      remainDays = Math.max(1, _daysBetween(plan.exam_date, _today()));
    }

    const intensity = remainDays <= 7 ? 'extreme' : remainDays <= 14 ? 'high' : 'normal';
    const dailyQ = intensity === 'extreme' ? 40 : intensity === 'high' ? 24 : 16;

    // 收集所有 KP，按掌握度排序
    const allKps = [];
    Object.entries(modules).forEach(([modName, mod]) => {
      Object.entries(mod).forEach(([kpName, kp]) => {
        if (!kp || typeof kp !== 'object' || !('attempts' in kp)) return;
        allKps.push({
          module: modName, kp: kpName,
          proficiency: kp.proficiency || 0,
          attempts: kp.attempts || 0,
          dominant_error: (kp.errors && kp.errors.dominant) || '',
          plateau: (kp.plateau && kp.plateau.is_plateau) || false,
        });
      });
    });

    const weakKps = allKps
      .filter(k => k.attempts >= 2 && k.proficiency < 0.65)
      .sort((a, b) => a.proficiency - b.proficiency)
      .slice(0, 12);

    const emergencyReview = allKps
      .filter(k => k.attempts >= 2 && k.proficiency < 0.40)
      .sort((a, b) => a.proficiency - b.proficiency)
      .slice(0, 8)
      .map(k => k.kp);

    // 生成最近 7 天的每日任务
    const dailySchedule = [];
    const focusModules = weakKps.length > 0
      ? [...new Set(weakKps.map(k => k.module))]
      : [];

    for (let i = 0; i < 7; i++) {
      const date = _addDays(_today(), i);
      if (focusModules.length === 0) break;
      const focusMod = focusModules[i % focusModules.length];
      const modKps = weakKps.filter(k => k.module === focusMod).map(k => k.kp);
      const priorityKps = (modKps.length > 0 ? modKps : weakKps.slice(0, 3).map(k => k.kp)).slice(0, 5);
      dailySchedule.push({
        date,
        focus_module: focusMod,
        question_count: dailyQ,
        review_count: Math.round(dailyQ * 0.3),
        intensity,
        priority_kps: priorityKps,
      });
    }

    return {
      exam_date: (plan && plan.exam_date) || '',
      remain_days: remainDays,
      intensity,
      daily_questions: dailyQ,
      daily_schedule: dailySchedule,
      weak_kps: weakKps,
      emergency_review: emergencyReview,
    };
  }

  // ── 时政月报 ─────────────────────────────────────────────────
  // 从每日完成记录里提取热点条目；无真实数据时返回空 items
  async function generateMonthlyDigest(year, month) {
    const items = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const categories = ['政治', '经济', '社会', '科技', '文化', '法律', '外交'];

    // 尝试读取每日完成记录，提取热点信息
    for (let d = 1; d <= daysInMonth; d++) {
      const dd = d < 10 ? '0' + d : '' + d;
      const mm = month < 10 ? '0' + month : '' + month;
      const dateStr = year + '-' + mm + '-' + dd;
      try {
        const rec = await _readJSON('每日完成/' + dateStr + '.json');
        if (rec && rec.daily_digest && Array.isArray(rec.daily_digest)) {
          rec.daily_digest.forEach(it => {
            if (it && it.title) items.push({
              category: it.category || categories[d % categories.length],
              title: it.title,
              summary: it.summary || '',
              date: dateStr,
              source: it.source || '',
              tags: it.tags || [],
            });
          });
        }
      } catch (e) {}
    }

    return {
      year, month,
      item_count: items.length,
      items,
      source_files: [],
      generated_at: _today(),
    };
  }

  // ── 出题质量评估 ─────────────────────────────────────────────
  // 评估近期练习的难度对齐度、错因集中度、高原期，输出综合评分与问题清单
  async function evaluateQuestionQuality() {
    const profile = await _readJSON('能力画像.json');
    const stats = await _readJSON('练习统计.json');
    const modules = (profile && profile.modules) || {};
    const records = (stats && stats.records) || [];

    const totalQuestions = records.reduce((s, r) => s + (r.total || 0), 0);
    if (totalQuestions === 0) {
      return {
        date: _today(),
        total_questions: 0,
        overall_score: 0,
        difficulty_alignment: 0,
        error_concentration: '暂无',
        plateau_detected: false,
        difficulty_breakdown: {},
        issues: [],
      };
    }

    // 难度对齐度：按难度档统计预期 vs 实际正确率
    const diffBreakdown = { 1: { expected: 0.85, actual: 0, count: 0 }, 2: { expected: 0.55, actual: 0, count: 0 }, 3: { expected: 0.25, actual: 0, count: 0 } };
    let diffAlignedCount = 0, diffTotalCount = 0;

    Object.values(modules).forEach(mod => {
      Object.values(mod).forEach(kp => {
        if (!kp || typeof kp !== 'object' || !kp.by_difficulty) return;
        const bd = kp.by_difficulty;
        [['★', 1], ['★★', 2], ['★★★', 3]].forEach(([star, idx]) => {
          const d = bd[star];
          if (d && d.attempts > 0) {
            const actual = d.correct / d.attempts;
            diffBreakdown[idx].actual = (diffBreakdown[idx].actual * diffBreakdown[idx].count + actual) / (diffBreakdown[idx].count + 1);
            diffBreakdown[idx].count += 1;
            diffTotalCount += 1;
            if (Math.abs(actual - diffBreakdown[idx].expected) < 0.15) diffAlignedCount += 1;
          }
        });
      });
    });

    const difficultyAlignment = diffTotalCount > 0 ? Math.round(diffAlignedCount / diffTotalCount * 100) : 0;

    // 错因集中度
    let totalErrors = 0;
    const errorTypeCount = { '概念性错误': 0, '理解性错误': 0, '执行性错误': 0 };
    Object.values(modules).forEach(mod => {
      Object.values(mod).forEach(kp => {
        if (!kp || !kp.errors) return;
        Object.entries(kp.errors).forEach(([t, c]) => { if (t !== 'dominant') { errorTypeCount[t] = (errorTypeCount[t] || 0) + c; totalErrors += c; } });
      });
    });
    const maxErrType = Math.max(...Object.values(errorTypeCount));
    const errorConcentration = totalErrors > 0 && maxErrType / totalErrors >= 0.5 ? '高' : totalErrors > 0 ? '中' : '低';

    // 高原期检测
    let plateauCount = 0;
    Object.values(modules).forEach(mod => {
      Object.values(mod).forEach(kp => { if (kp && kp.plateau && kp.plateau.is_plateau) plateauCount += 1; });
    });
    const plateauDetected = plateauCount > 0;

    // 综合评分
    let score = 0;
    score += difficultyAlignment * 0.4;
    score += (errorConcentration === '低' ? 100 : errorConcentration === '中' ? 60 : 30) * 0.3;
    score += (plateauDetected ? 40 : 100) * 0.3;
    const overallScore = Math.round(score);

    // 问题清单
    const issues = [];
    if (difficultyAlignment < 60) issues.push({ severity: 'medium', description: '题目难度与你的水平匹配度偏低（' + difficultyAlignment + '%），建议调整出题难度分布。' });
    if (errorConcentration === '高') {
      const top = Object.entries(errorTypeCount).sort((a, b) => b[1] - a[1])[0];
      issues.push({ severity: 'high', description: '错因高度集中于「' + top[0].replace('错误', '') + '」，需针对性强化该类问题。' });
    }
    if (plateauDetected) issues.push({ severity: 'medium', description: '检测到 ' + plateauCount + ' 个知识点处于高原期，建议变换学习方法。' });
    if (issues.length === 0) issues.push({ severity: 'low', description: '出题质量良好，难度分布合理，继续保持。' });

    return {
      date: _today(),
      total_questions: totalQuestions,
      overall_score: overallScore,
      difficulty_alignment: difficultyAlignment,
      error_concentration: errorConcentration,
      plateau_detected: plateauDetected,
      difficulty_breakdown: {
        1: { expected_accuracy: diffBreakdown[1].expected, actual_accuracy: diffBreakdown[1].actual },
        2: { expected_accuracy: diffBreakdown[2].expected, actual_accuracy: diffBreakdown[2].actual },
        3: { expected_accuracy: diffBreakdown[3].expected, actual_accuracy: diffBreakdown[3].actual },
      },
      issues,
    };
  }

  // ── 对外接口 ─────────────────────────────────────────────────
  return {
    computeEma: _computeEma,
    computeProficiency: _computeProficiency,
    detectPlateau: _detectPlateau,
    computeRoi: _computeRoi,
    updatePracticeStats,
    updateAbilityProfile,
    updateReviewQueue,
    updateDailyCompletion,
    updateSyllabus,
    appendWrongBook,
    processGradingResult,
    handleUpdateStats,
    generateErrorReport,
    generateSprintPlan,
    generateMonthlyDigest,
    evaluateQuestionQuality,
  };
})();
