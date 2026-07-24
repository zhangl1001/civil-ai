// ===== Tools — AI 工具执行器 =====
// 翻译自 backend/tools/core/*.py
// 当 LLM 通过 function calling 调用工具时，由 ai-engine.js 调度执行

const Tools = (() => {
  const proj = () => API._activeProject();

  async function _readJsonFile(path, fallback) {
    try {
      const raw = await API.Repository.readFile(proj(), path);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(fallback));
    } catch(e) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  async function _writeJsonFile(path, data) {
    await API.Repository.writeFile(proj(), path, JSON.stringify(data, null, 2));
  }

  function _gradingTransactionId(kind, args) {
    const data = args || {};
    if (data.idempotency_key) return String(data.idempotency_key);
    const grades = (data.grades || data.results || []).map(function(item) {
      return [item.q || '', item.correct ? 1 : 0, item.knowledge_point || '', item.error_type || ''].join(':');
    }).join('|');
    return 'grading-' + [kind, data.file || '', data.module || '', data.date || API.getLocalDate(), data.total || '', data.correct == null ? '' : data.correct, grades].join('::');
  }

  async function _runGradingTransaction(kind, args, runner) {
    const id = _gradingTransactionId(kind, args);
    const journal = await _readJsonFile('学习事务.json', { version: 1, transactions: [] });
    journal.version = 1;
    journal.transactions = journal.transactions || [];
    let transaction = journal.transactions.find(function(item) { return item && item.id === id; });
    if (transaction && transaction.status === 'completed') return { id: id, replayed: true, result: transaction.result || '批改结果已处理，无需重复累计。' };
    if (!transaction) {
      transaction = { id: id, kind: kind, status: 'in_progress', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_steps: [], step_results: {} };
      journal.transactions.push(transaction);
    } else {
      transaction.status = 'in_progress';
      transaction.completed_steps = transaction.completed_steps || [];
      transaction.step_results = transaction.step_results || {};
    }
    async function save() {
      transaction.updated_at = new Date().toISOString();
      journal.transactions = journal.transactions.slice(-300);
      await _writeJsonFile('学习事务.json', journal);
    }
    async function step(name, action) {
      if (transaction.completed_steps.indexOf(name) >= 0) return transaction.step_results[name];
      const result = await action();
      transaction.completed_steps.push(name);
      transaction.step_results[name] = result == null ? true : result;
      await save();
      return result;
    }
    await save();
    try {
      const result = await runner(step, id);
      transaction.status = 'completed';
      transaction.result = result;
      transaction.error = '';
      await save();
      return { id: id, replayed: false, result: result };
    } catch (error) {
      transaction.status = 'failed';
      transaction.error = error && error.message ? error.message : String(error);
      await save();
      throw error;
    }
  }

  async function _recordQuestionMetadata(file, moduleName, date, questions, startIdx, extra) {
    const meta = await _readJsonFile('题目元数据.json', { version: 2, files: {}, questions: {} });
    meta.version = 2;
    meta.files = meta.files || {};
    meta.questions = meta.questions || {};
    const fileEntry = meta.files[file] = meta.files[file] || { file: file, module: moduleName, date: date, question_ids: [], updated_at: '' };
    fileEntry.module = moduleName;
    fileEntry.date = date;
    fileEntry.updated_at = new Date().toISOString();
    (questions || []).forEach(function(q, i) {
      const qNum = startIdx + i;
      const id = file + '#Q' + qNum;
      const quality = API.Business.questionQuality(q);
      const rec = API.Business.questionMeta({
        id: id,
        file: file,
        q: 'Q' + qNum,
        module: moduleName,
        date: date,
        knowledge_point: q.knowledge_point || q.kp_label || '',
        difficulty: q.difficulty || '',
        source_type: q.source_type || (extra && extra.source_type) || 'ai_generated',
        source_name: q.source_name || (extra && extra.source_name) || '',
        quality_status: q.quality_status || quality.status,
        review_points: q.review_points || quality.review_points,
        has_answer: !!(q.answer || q.correct),
        text: (q.stem || q.question || '') + '\n' + (q.solution || '') + '\n' + (q.tip || '')
      });
      meta.questions[id] = rec;
      if (fileEntry.question_ids.indexOf(id) < 0) fileEntry.question_ids.push(id);
    });
    await _writeJsonFile('题目元数据.json', meta);
  }

  async function _recordLearningEvent(args) {
    const data = await _readJsonFile('学习事件.json', { version: 3, events: [] });
    data.version = 3;
    data.events = data.events || [];
    const source = args || {};
    const stableId = source.id || ('evt-' + [source.type || source.mode || 'practice', source.mode || '', source.file || '', source.date || API.getLocalDate(), source.total || 0, source.correct || 0].join('|'));
    const event = API.Business.learningEvent(Object.assign({}, source, { id: stableId }));
    if (data.events.some(function(item) { return item && item.id === event.id; })) return event;
    data.events.push(event);
    if (data.events.length > 2000) data.events = data.events.slice(-2000);
    await _writeJsonFile('学习事件.json', data);
    await API.PlanProgressReducer.consume(event);
    if (API.LearningNotifications) API.LearningNotifications.refresh().catch(function(error) { console.warn('[learning-notifications]', error); });
    return event;
  }

  async function _recordScore(args) {
    const data = await _readJsonFile('评分记录.json', { version: 2, records: [] });
    data.version = 2;
    data.records = data.records || [];
    const record = API.Business.scoreRecord(Object.assign({}, args, { id: args && args.idempotency_key ? args.idempotency_key : (args && args.id) }));
    if (data.records.some(function(item) { return item && item.id === record.id; })) return record;
    data.records.push(record);
    if (data.records.length > 1000) data.records = data.records.slice(-1000);
    await _writeJsonFile('评分记录.json', data);
  }

  async function _updateQuestionReviewQueue(file, moduleName, date, grades) {
    const data = await _readJsonFile('复习队列.json', { queue: [], queue_v2: [] });
    data.queue = data.queue || [];
    data.queue_v2 = data.queue_v2 || [];
    const today = API.getLocalDate();
    (grades || []).forEach(function(g) {
      if (g.correct) return;
      const qNum = g.q ? ('Q' + g.q) : '';
      const id = file + '#' + qNum;
      const existing = data.queue_v2.find(function(e) { return e.id === id; });
      const next = {
        id: id,
        file: file,
        q: qNum,
        module: moduleName,
        date: date,
        knowledge_point: g.knowledge_point || '',
        error_type: g.error_type || '未分类',
        status: 'due',
        interval_days: 1,
        next_review: today,
        fail_count: existing ? ((existing.fail_count || 0) + 1) : 1,
        updated_at: new Date().toISOString()
      };
      if (existing) Object.assign(existing, next);
      else data.queue_v2.push(next);
    });
    data.queue_v2 = data.queue_v2.filter(function(e) { return e && e.id; }).slice(-500);
    await _writeJsonFile('复习队列.json', data);
  }

  async function _updateUnifiedReviewItems(file, moduleName, date, grades) {
    const data = await _readJsonFile('复习项目.json', { version: 3, items: [] });
    data.version = 3;
    data.items = data.items || [];
    const byId = {};
    data.items.forEach(function(it) { if (it && it.id) byId[it.id] = it; });
    (grades || []).forEach(function(g) {
      const qNum = g.q ? ('Q' + g.q) : '';
      const id = file + '#' + qNum;
      if (!id || id === file + '#') return;
      if (g.correct) {
        if (byId[id]) {
          byId[id].status = 'scheduled';
          byId[id].success_count = (byId[id].success_count || 0) + 1;
          byId[id].interval_days = Math.min(30, Math.max(2, (byId[id].interval_days || 1) * 2));
          byId[id].next_review = addDays(byId[id].interval_days);
          byId[id].updated_at = new Date().toISOString();
        }
        return;
      }
      const next = API.Business.reviewItem({
        id: id,
        file: file,
        q: qNum,
        module: moduleName,
        knowledge_point: g.knowledge_point || '',
        date: date,
        error_type: g.error_type || '未分类',
        status: 'due',
        priority: g.error_type ? 'high' : 'medium',
        interval_days: 1,
        next_review: API.getLocalDate(),
        fail_count: byId[id] ? ((byId[id].fail_count || 0) + 1) : 1,
        source: 'grade_practice'
      });
      byId[id] = Object.assign(byId[id] || {}, next);
    });
    data.items = Object.values(byId).filter(function(it) { return it && it.id; }).slice(-1000);
    await _writeJsonFile('复习项目.json', data);
  }

  function addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + (n || 1));
    return API.getLocalDate(d);
  }

  function _validateGradesAgainstFile(content, grades) {
    const missing = [];
    (grades || []).forEach(function(g) {
      const qNum = g.q;
      if (!qNum || qNum < 1) return;
      const marker = '**' + qNum + '.**';
      const qIdx = content.indexOf(marker);
      if (qIdx < 0) { missing.push('Q' + qNum + ' 不存在'); return; }
      const afterQ = content.indexOf('\n---\n', qIdx);
      if (afterQ < 0) missing.push('Q' + qNum + ' 缺少题目分隔符');
    });
    return missing;
  }

  async function _updateEssayProfile(args) {
    const data = await _readJsonFile('申论画像.json', { version: 3, dimensions: {}, sessions: [] });
    data.version = 3;
    data.dimensions = data.dimensions || {};
    data.sessions = data.sessions || [];
    const scores = args.scores || {};
    const dims = [
      ['coverage', '要点覆盖', scores.coverage, 5],
      ['logic', '结构逻辑', scores.logic, 3],
      ['expression', '语言表达', scores.expression, 4],
      ['total', '综合得分', args.total_score, args.max_total || 15],
    ];
    dims.forEach(function(d) {
      const key = d[0], label = d[1], value = Number(d[2] || 0), max = Number(d[3] || 1);
      const old = data.dimensions[key] || { label: label, attempts: 0, avg_score: 0, max_score: max };
      const attempts = (old.attempts || 0) + 1;
      old.label = label;
      old.max_score = max;
      old.avg_score = Math.round((((old.avg_score || 0) * (attempts - 1) + value) / attempts) * 10) / 10;
      old.proficiency = max > 0 ? Math.round(old.avg_score / max * 100) : 0;
      old.attempts = attempts;
      old.last_date = args.date;
      data.dimensions[key] = old;
    });
    data.sessions.push({
      date: args.date,
      essay_type: args.essay_type,
      total_score: args.total_score,
      max_total: args.max_total,
      scores: scores,
      missing_points: args.missing_points || [],
      highlights: args.highlights || [],
      feedback: args.feedback || '',
      confidence: args.confidence || 'medium'
    });
    if (data.sessions.length > 100) data.sessions = data.sessions.slice(-100);
    await _writeJsonFile('申论画像.json', data);
  }

  async function _updateInterviewProfileDimensions(args) {
    const data = await _readJsonFile('面试画像.json', { version: 3, dimensions: {}, sessions: [] });
    data.version = 3;
    data.dimensions = data.dimensions || {};
    data.sessions = data.sessions || [];
    const scores = args.scores || {};
    [
      ['content', '内容充实度', scores.content, 5],
      ['expression', '表达流畅度', scores.expression, 5],
      ['logic', '逻辑结构', scores.logic, 5],
    ].forEach(function(d) {
      const key = d[0], label = d[1], value = Number(d[2] || 0), max = Number(d[3] || 1);
      const old = data.dimensions[key] || { label: label, attempts: 0, avg_score: 0, max_score: max };
      const attempts = (old.attempts || 0) + 1;
      old.label = label;
      old.max_score = max;
      old.avg_score = Math.round((((old.avg_score || 0) * (attempts - 1) + value) / attempts) * 10) / 10;
      old.proficiency = max > 0 ? Math.round(old.avg_score / max * 100) : 0;
      old.attempts = attempts;
      old.last_date = args.date;
      data.dimensions[key] = old;
    });
    const existingIdx = data.sessions.findIndex(function(s) {
      return s.date === args.date && (s.type || s.interview_type) === args.interview_type && s.total_score === args.total_score && s.question_count === args.question_count;
    });
    const session = {
      date: args.date,
      type: args.interview_type,
      question_count: args.question_count,
      total_score: args.total_score,
      max_total: args.max_total,
      scores: scores,
      feedback: args.feedback || '',
      confidence: args.confidence || 'medium'
    };
    if (existingIdx >= 0) data.sessions[existingIdx] = Object.assign(data.sessions[existingIdx], session);
    else data.sessions.push(session);
    if (data.sessions.length > 100) data.sessions = data.sessions.slice(-100);
    await _writeJsonFile('面试画像.json', data);
  }

  // ── A1 题目格式化 (翻译自 Python write_questions.py _format_question) ──
  function _formatQuestion(q, idx) {
    // idx: 1-based question number
    const diff = q.difficulty || '★★';
    const kpLabel = q.kp_label || q.knowledge_point || '';
    const kpDisplay = kpLabel ? (' ' + kpLabel) : '';
    const stem = q.stem || q.question || '';

    // Python: **{q_num}.** （{difficulty} {kp_label}）{stem}
    let md = '**' + idx + '.** （' + diff + kpDisplay + '）' + stem + '\n';

    // Options — Python limits to 4: options[:4]
    const options = (q.options || []).slice(0, 4);
    const labels = 'ABCD';
    md += '\n';  // blank line between stem and first option (A1 rule)
    options.forEach((opt, i) => {
      const label = labels[i] || String(i + 1);
      // Strip repeated prefix like "A. A. xxx" → "xxx" (Python: while loop)
      let clean = String(opt);
      clean = clean.replace(/^[A-Z][\.\．]\s*/, '');
      md += label + '. ' + clean + '\n\n';  // blank line after each option (A1 rule)
    });

    md += '\n<div class="answer-block">\n\n';
    // Python: **答案** {answer}  (no colon after 答案)
    md += '**答案** ' + (q.answer || q.correct || '') + '\n\n';

    // Python: **解题步骤** + numbered list from steps array
    const steps = q.steps;
    if (steps && Array.isArray(steps) && steps.length > 0) {
      md += '**解题步骤**\n';
      steps.forEach((step, i) => { md += (i + 1) + '. ' + step + '\n'; });
      md += '\n';
    } else if (q.solution) {
      // Fallback: if AI sends solution as string instead of steps array
      md += '**解题步骤**\n' + q.solution + '\n\n';
    }

    // Python: **考点** {topic if topic else kp_label}
    const topic = q.key_point || q.knowledge_point || kpLabel;
    if (topic) {
      md += '**考点** ' + topic + '\n\n';
    }

    // Python: **避坑** {tip if tip else '无'}
    const tip = q.tip || q.pitfall || '无';
    md += '**避坑** ' + tip + '\n\n';

    md += '</div>\n\n---\n';
    return md;
  }

  // ── A5 申论格式化 (翻译自 Python _format_essay) ───────────
  function _formatEssay(essay) {
    let md = '<div class="question-block">\n\n';
    // Python: ## 题目
    md += '## 题目\n\n';
    if (essay.material) {
      md += essay.material + '\n\n';
    }
    if (essay.requirements) {
      // Python: requirements is a string, not array
      const reqs = Array.isArray(essay.requirements) ? essay.requirements : [essay.requirements];
      // Python: ### 【作答要求】
      md += '### 【作答要求】\n\n';
      reqs.forEach((r, i) => {
        md += (i + 1) + '. ' + r + '\n';
      });
      md += '\n';
    }
    md += '</div>\n\n';
    md += '<div class="answer-block">\n\n';
    // Python: ## 答案
    if (essay.reference_answer) {
      md += '## 答案\n\n' + essay.reference_answer + '\n\n';
    }
    // Python: ## 答案区（用户作答） + <!-- 请在下方写出你的答案... -->
    md += '## 答案区（用户作答）\n\n<!-- 请在下方写出你的答案，完成后提交批改 -->\n\n';
    md += '</div>\n';
    return md;
  }

  // ── 讲义格式化 (翻译自 Python _format_lecture) ──────────
  function _formatLecture(lecture) {
    let md = '## 讲义：' + (lecture.topic || '') + '\n\n';
    // Python: > 本次学习知识点，请认真阅读讲义后再做练习题。
    md += '> 本次学习知识点，请认真阅读讲义后再做练习题。\n\n';
    if (lecture.concept) md += '### 概念定义\n\n' + _formatLectureContent(lecture.concept) + '\n\n';
    // Python uses steps_text, types_text, pitfalls_text, examples_text
    // JS accepts both Python names and short names
    const stepsText = lecture.steps_text || lecture.steps || '';
    const typesText = lecture.types_text || lecture.common_types || '';
    const pitfallsText = lecture.pitfalls_text || lecture.traps || '';
    const examplesText = lecture.examples_text || lecture.examples || '';
    if (stepsText) md += '### 解题步骤\n\n' + _formatLectureContent(stepsText) + '\n\n';
    if (typesText) md += '### 常见题型\n\n' + _formatLectureContent(typesText) + '\n\n';
    if (pitfallsText) md += '### 易错陷阱\n\n' + _formatLectureContent(pitfallsText) + '\n\n';
    if (examplesText) md += '### 例题精讲\n\n' + _formatLectureContent(examplesText) + '\n\n';
    return md;
  }

  // ── 讲义内容格式化 (Python: supports both str and list) ──
  function _formatLectureContent(content) {
    if (Array.isArray(content)) {
      return content.map(item => '- ' + item).join('\n');
    }
    return String(content || '');
  }

  // ── 选项清洗 ──────────────────────────────────────────
  function _cleanOptions(options) {
    return (options || []).map(opt => {
      let s = String(opt);
      // Strip repeated prefix like "A. A. xxx" → "xxx" (Python: while loop)
      return s.replace(/^[A-Z][\.\．]\s*/, '');
    });
  }

  // ── write_questions (翻译自 Python write_questions.py) ──
  async function writeQuestions(args) {
    const file = args.file;
    const moduleName = args.module || '';
    const date = args.date || API.getLocalDate();
    const questions = args.questions || [];
    const essay = args.essay;
    const lecture = args.lecture;
    const isReview = args.is_review || false;

    // Python: if not questions and not essay: return Error
    if (!questions.length && !essay) {
      return 'Error: must provide questions or essay';
    }

    let content = '';

    // Header — Python uses "|" separator, not "·"
    content += '# ' + moduleName + ' | ' + date + '\n\n';
    if (isReview) {
      // Python: ## 间隔复习
      content += '## 间隔复习\n\n';
    }

    // Lecture section (only at top of new file, Python: if lecture and not existing_content)
    if (lecture) {
      content += _formatLecture(lecture) + '\n';
    }

    // Questions section — Python: ## 练习题
    content += '## 练习题\n\n';

    let startIdx = 1;
    // Check existing file for continuation numbering
    const existing = await API.Repository.readFile(proj(), file);
    if (existing) {
      const existingNums = (existing.match(/\*\*(\d+)\.\*\*/g) || [])
        .map(m => parseInt(m.replace(/\*\*|\.\*\*/g, '')))
        .filter(n => !isNaN(n));
      if (existingNums.length > 0) {
        startIdx = Math.max(...existingNums) + 1;
      }
      content = existing.trimEnd() + '\n\n';
      // Don't add lecture or 练习题 header when appending
    }

    // Clean options
    const cleaned = questions.map(q => ({
      ...q,
      options: _cleanOptions(q.options || []),
    }));

    // Format each question
    cleaned.forEach((q, i) => {
      const isEssayQ = q.type === 'essay' || (essay && i === 0);
      if (isEssayQ) {
        content += _formatEssay(q);
      } else {
        content += _formatQuestion(q, startIdx + i);
      }
    });

    // If only essay (no questions array)
    if (essay && cleaned.length === 0) {
      content += _formatEssay(essay);
    }

	    // Atomic write
	    await API.Repository.writeFile(proj(), file, content);
	    if (cleaned.length || essay) {
	      await _recordQuestionMetadata(file, moduleName, date, cleaned, startIdx, {
	        source_type: args.source_type || 'ai_generated',
	        source_name: args.source_name || ''
	      });
	    }
	    // Python return format: "文件已写入：file\n新建/追加 N 题（含讲义）"
    var lectureNote = lecture ? '（含讲义）' : '';
    return '文件已写入：' + file + '\n' + (existing ? '追加' : '新建') + ' ' + cleaned.length + ' 题' + lectureNote;
  }

  // ── grade_practice (翻译自 Python grade_practice.py) ──
  async function gradePractice(args) {
    const file = args.file;
    const moduleName = args.module || '';
    const date = args.date || API.getLocalDate();
    // Python: grades field (JS also accepts results for compatibility)
    const grades = args.grades || args.results || [];
    const total = args.total || grades.length;
    const correct = args.correct != null ? args.correct : grades.filter(r => r.correct).length;

    // Python: if not grades: return Error
    if (!grades.length) {
      return 'Error: must provide grades/results';
    }

    // 1. Read practice file
    let content = await API.Repository.readFile(proj(), file);
    if (!content) return 'Error: practice file not found: ' + file;
    const validationIssues = _validateGradesAgainstFile(content, grades);
    if (validationIssues.length) {
      return 'Error: grading validation failed\n' + validationIssues.join('\n');
    }

    // 2. Insert grading blocks before each ---
    // Python: process from end to start to preserve positions
    const sortedGrades = grades.slice().sort((a, b) => (b.q || 0) - (a.q || 0));

    for (const g of sortedGrades) {
      const qNum = g.q;
      if (!qNum || qNum < 1) continue;

      // Find the question block
      const marker = '**' + qNum + '.**';
      const qIdx = content.indexOf(marker);
      if (qIdx < 0) continue;

      // Find next --- after this question (Python: ^---\s*$)
      const afterQ = content.indexOf('\n---\n', qIdx);
      if (afterQ < 0) continue;

      // Check if already graded
      const before = content.substring(Math.max(0, afterQ - 200), afterQ);
      if (before.indexOf('grading-block') >= 0) continue;

      let gradingBlock = '';
      if (g.correct) {
        // Python _build_correct_block
        gradingBlock = '\n<div class="grading-block correct" data-q="' + qNum + '">\n\n### ✅ 正确\n\n</div>\n';
      } else {
        // Python _build_wrong_block
        gradingBlock = '\n<div class="grading-block wrong" data-q="' + qNum + '">\n\n';
        gradingBlock += '### ❌ 错误\n\n';
        // Python: **你的答案** {your_answer} (JS also accepts user_answer)
        const yourAnswer = g.your_answer || g.user_answer || '';
        if (yourAnswer) gradingBlock += '**你的答案** ' + yourAnswer + '\n\n';
        // Python: **错因** {error_type}\n{error_detail}
        if (g.error_type) {
          gradingBlock += '**错因** ' + g.error_type + '\n';
          // Python: error_detail (JS also accepts error_analysis)
          const errorDetail = g.error_detail || g.error_analysis || '';
          if (errorDetail) gradingBlock += errorDetail + '\n';
          gradingBlock += '\n';
        }
        gradingBlock += '</div>\n';
      }
      content = content.substring(0, afterQ) + gradingBlock + content.substring(afterQ);
    }

    // 3. Commit every dependent write through one durable, resumable transaction.
    // Re-submitting the same grading result therefore cannot count the practice twice.
    const mode = args.mode || (moduleName.indexOf('申论') >= 0 ? 'essay' : 'practice');
    const knowledgePoints = args.knowledge_points || grades.map(r => r.knowledge_point || '').filter(Boolean);
    const gradingData = {
      mode,
      module: moduleName,
      date,
      knowledge_points: knowledgePoints,
      results: grades,
      total,
      correct,
      time_seconds: args.time_seconds || 0,
    };
    const transaction = await _runGradingTransaction('practice', args, async function(step, transactionId) {
      await step('practice_file', function() { return API.Repository.writeFile(proj(), file, content); });
      const statsSummary = await step('stats', function() { return Stats.processGradingResult(gradingData); });
      await step('score', function() {
        return _recordScore({ idempotency_key: transactionId, mode, file, module: moduleName, date, total, correct,
          confidence: args.confidence || 'medium', evidence: args.evidence || '', review_points: args.review_points || [] });
      });
      await step('review_queue', function() { return _updateQuestionReviewQueue(file, moduleName, date, grades); });
      await step('review_items', function() { return _updateUnifiedReviewItems(file, moduleName, date, grades); });
      await step('learning_event', function() {
        return _recordLearningEvent({ id: transactionId, type: 'grade', mode, file, module: moduleName, date, total, correct,
          time_seconds: args.time_seconds || 0, confidence: args.confidence || 'medium', reason: args.evidence || '',
          next_action: grades.some(function(g){return !g.correct;}) ? '错题复习与同类变式训练' : '进入间隔复习' });
      });
      const pct = total > 0 ? (correct / total * 100).toFixed(1) : '0.0';
      return '批改完成：' + correct + '/' + total + ' 正确 (' + pct + '%)\n文件已更新：' + file + '\n统计：' + (statsSummary && statsSummary.summary ? statsSummary.summary : '已更新');
    });
    return transaction.result;
  }

  // ── grade_essay (申论批改：插入 A7 批改块 + 更新统计) ──
  async function gradeEssay(args) {
    const file = args.file;
    const date = args.date || API.getLocalDate();
    const essayType = args.essay_type || '申发论述';
    const scores = args.scores || {};
    const totalScore = scores.total || 0;
    const maxTotal = scores.max_total || 15;
    const feedback = args.feedback || '';
    const missingPoints = args.missing_points || [];
    const highlights = args.highlights || [];
    const wordCountOk = scores.word_count_ok !== false;

    // 1. Prepare A7 grading block; the transaction below performs the write.
    let essayContent = null;
    if (file) {
      let content = await API.Repository.readFile(proj(), file);
      if (content && content.indexOf('### AI 批改') < 0) {
        let block = '\n\n### AI 批改\n\n> **Total ' + totalScore + '/' + maxTotal + '** | Coverage ' + (scores.coverage||0) + '/5 | Logic ' + (scores.logic||0) + '/3 | Expression ' + (scores.expression||0) + '/4 | Word count ' + (wordCountOk ? '✓' : '✗') + '\n';
        if (missingPoints.length) block += '> ❌ Missing points: ' + missingPoints.join('；') + '\n';
        if (highlights.length) block += '> ✅ Highlights: ' + highlights.join('；') + '\n';
        if (feedback) block += '> ' + feedback + '\n';
        const ansIdx = content.indexOf('## 答案区');
        if (ansIdx >= 0) {
          content = content.substring(0, ansIdx) + block + '\n' + content.substring(ansIdx);
        } else {
          content += '\n' + block;
        }
        essayContent = content;
      }
    }

    // 2. Update stats — convert essay score to correct/total (>=60% = pass)
    const ratio = maxTotal > 0 ? totalScore / maxTotal : 0;
    const correct = ratio >= 0.6 ? 1 : 0;
    const gradingData = {
      mode: 'essay',
      module: '申论',
      date,
      knowledge_points: [essayType],
      total: 1,
      correct,
      results: [],
      time_seconds: args.time_seconds || 0,
    };
    const transaction = await _runGradingTransaction('essay', args, async function(step, transactionId) {
      if (essayContent) await step('essay_file', function() { return API.Repository.writeFile(proj(), file, essayContent); });
      const result = await step('stats', function() { return Stats.processGradingResult(gradingData); });
      await step('score', function() {
        return _recordScore({ idempotency_key: transactionId, mode: 'essay', file: file || '', module: '申论', date, total: 1, correct, scores,
          confidence: args.confidence || 'medium', evidence: feedback, review_points: [].concat(missingPoints || [], highlights || []) });
      });
      await step('essay_profile', function() {
        return _updateEssayProfile({ date, essay_type: essayType, total_score: totalScore, max_total: maxTotal, scores, feedback,
          missing_points: missingPoints, highlights, confidence: args.confidence || 'medium' });
      });
      await step('learning_event', function() {
        return _recordLearningEvent({ id: transactionId, type: 'essay', mode: 'essay', file: file || '', module: '申论', knowledge_point: essayType,
          date, total: 1, correct, scores, confidence: args.confidence || 'medium', reason: feedback,
          next_action: missingPoints.length ? ('补齐要点：' + missingPoints.slice(0, 3).join('、')) : '保持限时训练' });
      });
      return '申论批改完成：' + totalScore + '/' + maxTotal + '（' + essayType + '）\n文件已更新：' + (file||'无') + '\n统计：' + (result && result.summary ? result.summary : '已更新');
    });
    return transaction.result;
  }

  // ── grade_interview (面试评分：更新面试画像 + 统计) ──
  async function gradeInterview(args) {
    const date = args.date || API.getLocalDate();
    const interviewType = args.interview_type || '结构化';
    const questionCount = args.question_count || 3;
    const scores = args.scores || {};
    const content = scores.content || 0;
    const expression = scores.expression || 0;
    const logic = scores.logic || 0;
    const totalScore = scores.total != null ? scores.total : (content + expression + logic);
    const maxTotal = scores.max_total || 15;
    const feedback = args.feedback || '';

    // 1. Save to 面试画像.json (drop old sample entries on first real save)
    let profileRaw = await API.Repository.readFile(proj(), '面试画像.json');
    let profile = profileRaw ? JSON.parse(profileRaw) : { sessions: [] };
    if (!profile.sessions) profile.sessions = [];
    profile.sessions = profile.sessions.filter(function(s) { return !s._demo; });
    profile.sessions.push({
      date, type: interviewType, question_count: questionCount,
      total_score: totalScore,
      scores: { content: content, expression: expression, logic: logic },
      feedback: feedback,
    });
    if (profile.sessions.length > 50) profile.sessions = profile.sessions.slice(-50);
    const interviewProfileContent = JSON.stringify(profile);

    // 2. Update stats — convert interview score to correct/total (>=60% = pass)
    const ratio = maxTotal > 0 ? totalScore / maxTotal : 0;
    const correct = ratio >= 0.6 ? 1 : 0;
    const gradingData = {
      mode: 'interview',
      module: '面试',
      date,
      knowledge_points: [interviewType],
      total: 1,
      correct,
      results: [],
      time_seconds: args.time_seconds || 0,
    };
    const transaction = await _runGradingTransaction('interview', args, async function(step, transactionId) {
      await step('interview_profile', function() { return API.Repository.writeFile(proj(), '面试画像.json', interviewProfileContent); });
      const result = await step('stats', function() { return Stats.processGradingResult(gradingData); });
      await step('score', function() {
        return _recordScore({ idempotency_key: transactionId, mode: 'interview', file: '面试画像.json', module: '面试', date, total: 1, correct,
          scores: { content: content, expression: expression, logic: logic, total: totalScore, max_total: maxTotal }, confidence: args.confidence || 'medium',
          evidence: feedback, review_points: args.review_points || [] });
      });
      await step('dimensions', function() {
        return _updateInterviewProfileDimensions({ date, interview_type: interviewType, question_count: questionCount, total_score: totalScore,
          max_total: maxTotal, scores: { content: content, expression: expression, logic: logic }, feedback, confidence: args.confidence || 'medium' });
      });
      await step('learning_event', function() {
        return _recordLearningEvent({ id: transactionId, type: 'interview', mode: 'interview', file: '面试画像.json', module: '面试',
          knowledge_point: interviewType, date, total: 1, correct,
          scores: { content: content, expression: expression, logic: logic, total: totalScore, max_total: maxTotal }, confidence: args.confidence || 'medium',
          reason: feedback, next_action: totalScore / Math.max(1, maxTotal) < 0.75 ? '针对弱维度复盘并重练' : '保持模拟频率' });
      });
      return '面试评分完成：' + totalScore + '/' + maxTotal + '（内容' + content + '·表达' + expression + '·逻辑' + logic + '）\n统计：' + (result && result.summary ? result.summary : '已更新');
    });
    return transaction.result;
  }

  // ── create_project (首次使用时创建工程 + 默认文件) ──
  async function createProject(args) {
    const name = args.name || API._activeProject();
    const config = {
      exam_date: args.exam_date || '',
      exam_name: args.province ? (args.province + (args.exam_type || '省考')) : (args.exam_type || '国考'),
      exam_type: args.exam_type || '国考',
      province: args.province || '',
      mock_exam_count: args.mock_exam_count || 120,
      position: args.position || '',
	      requirements: args.requirements || '',
	    };
	    config.business_model = API.Business.createTargetModel(config);
	    await API.Repository.createProject(name, config);
    localStorage.setItem('zhangl-active-project', name);
    return '工程「' + name + '」已创建。已初始化：备考计划.json、能力画像.json、练习统计.json、复习队列.json、知识体系.json、syllabus/{各模块}.json。考试日期：' + (config.exam_date || '未设置') + '。现在可以开始练习了。';
  }

  // ── read_file (翻译自 Python file_ops.py read_file) ──
  async function readFile(args) {
    const path = args.path || args.file || '';
    const lines = args.lines;
    const tailBytes = args.tail_bytes || 0;
    let content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    if (lines) {
      const contentLines = content.split('\n');
      if (typeof lines === 'string') {
        if (lines.includes('-')) {
          const parts = lines.split('-').map(Number);
          return contentLines.slice(parts[0] - 1, parts[1]).join('\n');
        }
        if (lines.startsWith('first_')) {
          const n = parseInt(lines.replace('first_', '')) || 50;
          return contentLines.slice(0, n).join('\n');
        }
        if (lines.startsWith('last_')) {
          const n = parseInt(lines.replace('last_', '')) || 50;
          return contentLines.slice(-n).join('\n');
        }
      }
      if (typeof lines === 'number') {
        return contentLines.slice(0, lines).join('\n');
      }
    }

    // tail_bytes support (Python feature)
    if (tailBytes > 0 && content.length > tailBytes) {
      return '... (truncated)\n' + content.substring(content.length - tailBytes);
    }

    // Truncate large files — Python uses 50000, not 12000
    if (content.length > 50000) {
      return content.substring(0, 50000) + '\n... (truncated, total ' + content.length + ' chars)';
    }
    return content;
  }

  // ── write_file (翻译自 Python file_ops.py write_file) ──
  async function writeFile(args) {
    const path = args.path || args.file || '';
    const content = args.content || '';
    // Python: overwrite=false by default, check if file exists
    const overwrite = args.overwrite !== false; // default true for JS (simpler)
    if (!overwrite) {
      const existing = await API.Repository.readFile(proj(), path);
      if (existing) return 'Error: file already exists: ' + path + ' (set overwrite=true to replace)';
    }
    await API.Repository.writeFile(proj(), path, content);
    // Python: "File saved: path (N chars, M lines)"
    const lineCount = content.split('\n').length;
    return 'File saved: ' + path + ' (' + content.length + ' chars, ' + lineCount + ' lines)';
  }

  // ── list_files (翻译自 Python file_ops.py list_files) ──
  async function listFiles(args) {
    const prefix = args.path || args.prefix || '';
    const paths = await API.Repository.listFiles(proj(), prefix);
    // Python: limit to 100 entries
    const limited = paths.slice(0, 100);
    return limited.join('\n') || '(empty)';
  }

  // ── update_stats (薄层，实际逻辑在 Stats 中) ──────────────
  async function updateStats(args) {
    return await Stats.handleUpdateStats(args);
  }

  // ── append_file (翻译自 Python append_file.py) ───────────
  async function appendFile(args) {
    var path = args.path || '';
    var content = args.content || '';
    if (!path) return 'Error: path is required';

    var existing = await API.Repository.readFile(proj(), path);
    if (existing === null) {
      // Create new file
      await API.Repository.writeFile(proj(), path, content);
    } else {
      await API.Repository.writeFile(proj(), path, existing + content);
    }
    var lineCount = content.split('\n').length - 1;
    return 'Appended ' + content.length + ' chars (' + lineCount + ' lines) to ' + path;
  }

  // ── edit (翻译自 Python edit.py — 三级模糊匹配) ─────────
  var _EDIT_MAX_RETRIES = 3;

  function _normalizeEdit(s) {
    // Strip trailing whitespace from each line (Python: _normalize)
    return s.split('\n').map(function(line) { return line.replace(/\s+$/, ''); }).join('\n');
  }

  function _normalizeAggressive(s) {
    // Strip ALL trailing whitespace AND collapse multiple spaces (Python: _normalize_aggressive)
    return s.split('\n').map(function(line) {
      return line.replace(/\s+$/, '').replace(/[ \t]+/g, ' ');
    }).join('\n');
  }

  function _mapBack(text, normText, normPattern, normIdx) {
    // Map normalized-match positions back to original text positions (Python: _map_back)
    try {
      var preNewlines = normText.substring(0, normIdx).split('\n').length - 1;
      var origBefore = 0;
      for (var i = 0; i < preNewlines; i++) {
        origBefore = text.indexOf('\n', origBefore) + 1;
      }

      var lines = normPattern.split('\n');
      var endPos = origBefore;
      for (var li = 0; li < lines.length; li++) {
        var lineEnd;
        if (li < lines.length - 1) {
          lineEnd = text.indexOf('\n', endPos);
          if (lineEnd < 0) return null;
        } else {
          lineEnd = text.length;
        }
        var actualLine = text.substring(endPos, lineEnd);
        if (actualLine.replace(/\s+$/, '') !== lines[li].replace(/\s+$/, '')) return null;
        if (li < lines.length - 1) {
          endPos = lineEnd + 1;
        } else {
          endPos = endPos + actualLine.length;
        }
      }
      return [origBefore, endPos];
    } catch (e) {
      return null;
    }
  }

  function _findFuzzy(text, pattern, aggressive) {
    // 1. Exact match
    var idx = text.indexOf(pattern);
    if (idx >= 0) return [idx, idx + pattern.length];

    // 2. Line-trailing-whitespace tolerant
    if (pattern.indexOf('\n') >= 0) {
      var normText = _normalizeEdit(text);
      var normPattern = _normalizeEdit(pattern);
      idx = normText.indexOf(normPattern);
      if (idx >= 0) {
        var result = _mapBack(text, normText, normPattern, idx);
        if (result) return result;
      }

      // 3. Aggressive: collapse spaces too
      if (aggressive) {
        normText = _normalizeAggressive(text);
        normPattern = _normalizeAggressive(pattern);
        idx = normText.indexOf(normPattern);
        if (idx >= 0) {
          result = _mapBack(text, normText, normPattern, idx);
          if (result) return result;
        }
      }
    }

    return null;
  }

  async function editFile(args) {
    var path = args.path || '';
    var oldString = args.old_string || '';
    var newString = args.new_string || '';
    var replaceAll = args.replace_all || false;

    if (oldString === newString) return 'Error: old_string and new_string are identical — nothing to change.';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    // Try fuzzy match with retries — use aggressive mode on 2nd+ attempt
    for (var attempt = 1; attempt <= _EDIT_MAX_RETRIES; attempt++) {
      var useAggressive = (attempt >= 2);
      var match = _findFuzzy(content, oldString, useAggressive);

      if (match === null) {
        var firstLine = oldString.split('\n')[0].replace(/\s+$/, '').substring(0, 60);
        var hint = '';
        if (firstLine && content.indexOf(firstLine) >= 0) {
          var pos = content.indexOf(firstLine);
          var ctxStart = Math.max(0, pos - 10);
          var ctxEnd = Math.min(content.length, pos + firstLine.length + 60);
          hint = '\nHint: found "' + firstLine + '" at offset ' + pos + '. Surrounding:\n  ' + content.substring(ctxStart, ctxEnd).replace(/\n/g, '\\n');
        }
        if (attempt < _EDIT_MAX_RETRIES) continue;
        return 'Error: old_string not found in ' + path + ' (attempt ' + attempt + '/' + _EDIT_MAX_RETRIES + ').' + hint +
          '\n\n建议：文件可能已被修改，请用 read_file 重新读取目标内容，确认后重试 edit。也可用 write_file 重写整个文件。';
      }

      var start = match[0], end = match[1];

      // Uniqueness check (Python line 146-148)
      if (!replaceAll) {
        var otherMatch = _findFuzzy(content.substring(end), oldString, useAggressive);
        if (otherMatch !== null) {
          return 'Error: old_string appears multiple times in ' + path + '. Use replace_all=true to replace all, or provide more surrounding context to make it unique.';
        }
      }

      // Apply replacement
      var newContent;
      if (replaceAll) {
        newContent = content.split(oldString).join(newString);
      } else {
        newContent = content.substring(0, start) + newString + content.substring(end);
      }

      await API.Repository.writeFile(proj(), path, newContent);
      var what = replaceAll ? 'all occurrences' : '1 occurrence';
      return 'Replaced ' + what + ' in ' + path + ' (offset ' + start + ')';
    }

    return 'Error: edit failed after ' + _EDIT_MAX_RETRIES + ' attempts';
  }

  // ── glob (翻译自 Python glob.py — 客户端模式匹配) ───────
  async function globFiles(args) {
    var pattern = args.pattern || '';
    var basePath = args.path || '';
    if (!pattern) return 'Error: pattern is required';

    // List all files, then filter with glob pattern
    var allFiles = await API.Repository.listFiles(proj(), basePath);
    if (!allFiles || !allFiles.length) return 'No files matching \'' + pattern + '\' in ' + (basePath || '/');

    // Convert glob pattern to regex
    // Support: * (any within segment), ** (any depth), ? (single char)
    var regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
      .replace(/\*\*/g, '{{GLOBSTAR}}')        // placeholder for **
      .replace(/\*/g, '[^/]*')                  // * matches within segment
      .replace(/\{\{GLOBSTAR\}\}/g, '.*')       // ** matches any depth
      .replace(/\?/g, '[^/]');                   // ? matches single char
    var regex;
    try {
      regex = new RegExp('^' + regexStr + '$');
    } catch (e) {
      return 'Error: invalid glob pattern: ' + pattern;
    }

    var matches = allFiles.filter(function(f) {
      var rel = basePath ? f.substring(basePath.length).replace(/^\//, '') : f;
      return regex.test(rel) || regex.test(f);
    }).sort();

    if (!matches.length) return 'No files matching \'' + pattern + '\' in ' + (basePath || '/');

    // Limit to 200 results
    var limited = matches.slice(0, 200);
    var result = limited.map(function(f) { return '  ' + f; }).join('\n');
    if (matches.length > 200) {
      result += '\n  ... (' + matches.length + ' total, showing first 200)';
    }
    return result;
  }

  // ── grep (翻译自 Python grep.py — 内容搜索) ────────────
  async function grepFiles(args) {
    var pattern = args.pattern || '';
    var basePath = args.path || '';
    var globPattern = args.glob || '';
    var outputMode = args.output_mode || 'files_with_matches';
    var caseInsensitive = args['-i'] || args.case_insensitive || false;
    var headLimit = args.head_limit || 200;

    if (!pattern) return 'Error: pattern is required';

    // Compile regex
    var regex;
    try {
      regex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g');
    } catch (e) {
      return 'Error compiling regex \'' + pattern + '\': ' + e.message;
    }

    // Build file list
    var allFiles = await API.Repository.listFiles(proj(), basePath);
    if (!allFiles || !allFiles.length) return 'No files to search (path=' + basePath + ')';

    // Apply glob filter
    var searchFiles = allFiles;
    if (globPattern) {
      var globRegex;
      try {
        var gr = globPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
        globRegex = new RegExp(gr, 'i');
      } catch (e) { globRegex = null; }
      if (globRegex) {
        searchFiles = allFiles.filter(function(f) { return globRegex.test(f); });
      }
    }

    // Search each file
    var fileMatches = {};
    var totalMatches = 0;
    for (var fi = 0; fi < searchFiles.length; fi++) {
      var fpath = searchFiles[fi];
      var content = await API.Repository.readFile(proj(), fpath);
      if (content === null) continue;

      var lines = content.split('\n');
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var testRegex = new RegExp(pattern, caseInsensitive ? 'i' : '');
        if (testRegex.test(line)) {
          if (!fileMatches[fpath]) fileMatches[fpath] = [];
          fileMatches[fpath].push([li + 1, line.replace(/\s+$/, '')]);
          totalMatches++;
          if (outputMode === 'content' && totalMatches >= headLimit * 2) break;
        }
      }
      if (outputMode === 'content' && totalMatches >= headLimit * 2) break;
    }

    if (!Object.keys(fileMatches).length) {
      return 'No matches for \'' + pattern + '\' (' + (caseInsensitive ? 'case insensitive' : 'case sensitive') + ')';
    }

    if (outputMode === 'count') {
      var countLines = [];
      Object.keys(fileMatches).sort(function(a, b) {
        return fileMatches[b].length - fileMatches[a].length;
      }).forEach(function(fpath) {
        countLines.push('  ' + String(fileMatches[fpath].length).padStart(4) + '  ' + fpath);
      });
      return Object.keys(fileMatches).length + ' files, ' + totalMatches + ' matches:\n' + countLines.join('\n');

    } else if (outputMode === 'files_with_matches') {
      var fwLines = Object.keys(fileMatches).sort().map(function(fpath) {
        return '  ' + fpath;
      });
      return Object.keys(fileMatches).length + ' files match:\n' + fwLines.join('\n');

    } else {
      // content mode
      var contentLines = [];
      var shown = 0;
      Object.keys(fileMatches).sort().forEach(function(fpath) {
        contentLines.push(fpath + ':');
        fileMatches[fpath].forEach(function(m) {
          contentLines.push('  ' + m[0] + ': ' + m[1]);
          shown++;
          if (shown >= headLimit) return;
        });
        if (shown >= headLimit) {
          contentLines.push('... (truncated, ' + totalMatches + ' total matches)');
          return;
        }
      });
      return contentLines.join('\n');
    }
  }

  // ── ask_user (交互工具) ─────────────────────────────────
  function askUser(args) {
    var question = args.question || '';
    if (!question) return 'Error: question is required';
    // Return a marker that the frontend can detect and show an input dialog
    // The AI engine will see this as the tool result and wait for user input
    return '[需用户回复] ' + question;
  }

  // ── request_review (交互工具) ────────────────────────────
  function requestReview(args) {
    var content = args.content || args.summary || '';
    if (!content) return 'Error: content is required';
    // Return a marker that the frontend can detect and show a review panel
    return '[需用户审核] ' + content;
  }

  // ── Task tracking (翻译自 Python task_tools.py) ──────────
  var _tasks = {};
  var _taskCounter = 0;
  var _sessionSlug = Math.random().toString(36).substring(2, 6);

  var VALID_TRANSITIONS = {
    'pending': { 'in_progress': true },
    'in_progress': { 'done': true, 'pending': true },
    'done': { 'in_progress': true },  // can reopen
  };

  function _formatTasks() {
    if (!Object.keys(_tasks).length) return '(no tasks)';
    var lines = [];
    Object.keys(_tasks).sort(function(a, b) {
      return parseInt(a) - parseInt(b);
    }).forEach(function(id) {
      var t = _tasks[id];
      var icon = { pending: '⬜', in_progress: '🔄', done: '✅' }[t.status] || '  ';
      var deps = '';
      if (t.blockedBy.length) {
        deps = ' (等待: ' + t.blockedBy.join(', ') + ')';
      }
      var owner = t.owner ? ' [' + t.owner + ']' : '';
      var fail = t.expertFailures > 0 ? ' (专家失败' + t.expertFailures + '次)' : '';
      lines.push('  [' + id + '] ' + icon + ' ' + t.subject + owner + deps + fail);
    });
    return lines.join('\n');
  }

  function _hasIncompleteTasks() {
    return Object.values(_tasks).some(function(t) { return t.status !== 'done'; });
  }

  function _hasBlockedTasks() {
    var blocked = [];
    Object.values(_tasks).forEach(function(t) {
      if (t.status === 'done') return;
      for (var i = 0; i < t.blockedBy.length; i++) {
        var dep = _tasks[t.blockedBy[i]];
        if (dep && dep.status !== 'done') {
          blocked.push(t.id);
          break;
        }
      }
    });
    return blocked;
  }

  function _taskStatusSummary() {
    if (!Object.keys(_tasks).length) return '';
    var done = Object.values(_tasks).filter(function(t) { return t.status === 'done'; }).length;
    var total = Object.keys(_tasks).length;
    var pending = Object.values(_tasks).filter(function(t) { return t.status !== 'done'; });
    var lines = ['任务进度: ' + done + '/' + total];
    pending.forEach(function(t) {
      var icon = { pending: '⬜', in_progress: '🔄' }[t.status] || '  ';
      var owner = t.owner ? ' [' + t.owner + ']' : '';
      var fail = t.expertFailures > 0 ? ' (专家已失败' + t.expertFailures + '次)' : '';
      lines.push('  [' + t.id + '] ' + icon + ' ' + t.subject + owner + fail);
    });
    return lines.join('\n');
  }

  function taskCreate(args) {
    var subject = args.subject || '';
    if (!subject) return 'Error: subject is required';
    _taskCounter++;
    var id = _taskCounter + '-' + _sessionSlug;
    _tasks[id] = {
      id: id,
      subject: subject,
      description: args.description || '',
      status: 'pending',
      owner: '',
      expertId: '',
      expertFailures: 0,
      resultSummary: '',
      blocks: args.blocks || [],
      blockedBy: args.blocked_by || [],
    };

    // Update reverse dependencies
    (_tasks[id].blocks || []).forEach(function(bid) {
      if (_tasks[bid] && _tasks[bid].blockedBy.indexOf(id) < 0) {
        _tasks[bid].blockedBy.push(id);
      }
    });
    (_tasks[id].blockedBy || []).forEach(function(bid) {
      if (_tasks[bid] && _tasks[bid].blocks.indexOf(id) < 0) {
        _tasks[bid].blocks.push(id);
      }
    });

    var blockedWarn = '';
    var blockedIds = _hasBlockedTasks();
    if (blockedIds.indexOf(id) >= 0) {
      var unmet = _tasks[id].blockedBy.filter(function(b) {
        return _tasks[b] && _tasks[b].status !== 'done';
      }).map(function(b) { return '[' + b + ']'; });
      blockedWarn = '\n⚠️ 此任务被阻塞，等待: ' + unmet.join(', ');
    }

    return 'Task [' + id + '] created: ' + subject + blockedWarn + '\n' + _formatTasks();
  }

  function taskUpdate(args) {
    var taskId = args.task_id || '';
    if (!_tasks[taskId]) {
      return '❌ Task [' + taskId + '] 不存在！\n⚠️ 可能原因: 1) 旧会话中的 task_id 2) 未创建此任务。\n👉 请先调用 task_create 创建新任务。\n' + _formatTasks();
    }

    var task = _tasks[taskId];
    var msgs = [];

    if (args.status) {
      var valid = VALID_TRANSITIONS[task.status];
      if (!valid || !valid[args.status]) {
        msgs.push('状态转换无效: ' + task.status + ' → ' + args.status);
      } else {
        task.status = args.status;
        var icon = { pending: '⬜', in_progress: '🔄', done: '✅' }[args.status] || '';
        msgs.push('Task [' + taskId + '] → ' + icon + ' ' + args.status);
      }
    }

    (args.add_blocks || []).forEach(function(bid) {
      if (task.blocks.indexOf(bid) < 0) task.blocks.push(bid);
      if (_tasks[bid] && _tasks[bid].blockedBy.indexOf(taskId) < 0) {
        _tasks[bid].blockedBy.push(taskId);
      }
    });

    (args.add_blocked_by || []).forEach(function(bid) {
      if (task.blockedBy.indexOf(bid) < 0) task.blockedBy.push(bid);
      if (_tasks[bid] && _tasks[bid].blocks.indexOf(taskId) < 0) {
        _tasks[bid].blocks.push(taskId);
      }
    });

    return msgs.length ? msgs.join('\n') + '\n' + _formatTasks() : _formatTasks();
  }

  function taskList() {
    if (!Object.keys(_tasks).length) {
      return '(no tasks yet — use task_create to plan work)';
    }
    var done = Object.values(_tasks).filter(function(t) { return t.status === 'done'; }).length;
    var total = Object.keys(_tasks).length;
    var blocked = _hasBlockedTasks();
    var lines = ['进度: ' + done + '/' + total + ' 已完成'];
    if (blocked.length) {
      lines.push('⚠️ ' + blocked.length + ' 个任务被阻塞: ' + blocked.map(function(b) { return '[' + b + ']'; }).join(', '));
    }
    lines.push(_formatTasks());
    return lines.join('\n');
  }

  function resetTasks() {
    _tasks = {};
    _taskCounter = 0;
    _sessionSlug = Math.random().toString(36).substring(2, 6);
  }

  // ── web_fetch (翻译自 Python web_fetch.py) ──────────────
  async function webFetch(args) {
    var url = args.url || '';
    var prompt = args.prompt || '';
    if (!url) return 'Error: url is required';

    // Basic URL validation
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    try {
      var resp;
      if (typeof CapacitorHttp !== 'undefined') {
        resp = await CapacitorHttp.request({
          url: url, method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ExamApp/1.0)',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          },
          connectTimeout: 15000, readTimeout: 15000,
        });
        if (resp.status >= 300) return 'Error fetching URL: HTTP ' + resp.status;
      } else {
        resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExamApp/1.0)' },
        });
        if (!resp.ok) return 'Error fetching URL: HTTP ' + resp.status;
        resp = { data: await resp.text() };
      }

      var html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      var text = _htmlToText(html);

      if (text.length < 10) return 'Error: page returned no readable text content.';

      // Truncate to 8000 chars
      if (text.length > 8000) {
        text = text.substring(0, 8000) + '\n\n[Content truncated: ' + text.length + ' total chars, showing first 8000]';
      }

      return 'Fetched content from ' + url + ':\n\n--- BEGIN CONTENT ---\n' + text + '\n--- END CONTENT ---\n\nPlease use the prompt to analyze: ' + prompt;
    } catch (e) {
      return 'Error fetching URL: ' + (e.message || String(e));
    }
  }

  function _htmlToText(html) {
    // Simple HTML to plain text converter (Python: _html_to_text)
    // Remove scripts, styles, comments
    ['script', 'style', 'noscript', 'iframe'].forEach(function(tag) {
      html = html.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?</' + tag + '>', 'gi'), '');
    });
    html = html.replace(/<!--[\s\S]*?-->/g, '');

    // Replace block elements with newlines
    ['p', 'div', 'li', 'tr', 'br', 'article', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'blockquote', 'pre', 'table'].forEach(function(tag) {
      html = html.replace(new RegExp('</?' + tag + '[^>]*>', 'gi'), '\n');
    });
    // h1-h6
    html = html.replace(/<\/?h[1-6][^>]*>/gi, '\n');

    // Remove remaining tags
    html = html.replace(/<[^>]+>/g, '');

    // Decode common entities
    html = html.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    html = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");

    // Collapse whitespace
    var lines = html.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    return lines.join('\n');
  }

  // ── web_search (DuckDuckGo first, falls back to Bing) ──
  async function webSearch(args) {
    var query = args.query || '';
    var maxResults = Math.min(args.max_results || 5, 10);
    if (!query) return 'Error: query is required';

    var timeoutMs = 12000;

    // Fetch via CapacitorHttp (native, bypasses WKWebView CORS) or fetch+AbortController
    async function _fetch(url) {
      try {
        if (typeof CapacitorHttp !== 'undefined') {
          var resp = await CapacitorHttp.request({
            url: url, method: 'GET',
            connectTimeout: timeoutMs, readTimeout: timeoutMs,
          });
          if (resp.status >= 300) return '';
          return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function() { ctrl.abort(); }, timeoutMs) : null;
        try {
          var r = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
          if (!r.ok) return '';
          return await r.text();
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (e) {
        return '';
      }
    }

    function parseDDG(html) {
      var results = [];
      var titleRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      var snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/[a-z]/gi;
      var titleMatch, snippetMatch;
      while ((titleMatch = titleRegex.exec(html)) !== null && results.length < maxResults) {
        var href = titleMatch[1];
        var title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        var urlMatch = href.match(/uddg=([^&]+)/);
        if (urlMatch) href = decodeURIComponent(urlMatch[1]);
        snippetMatch = snippetRegex.exec(html);
        var body = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        results.push({ title: title, href: href, body: body });
      }
      return results;
    }

    function parseBing(html) {
      var results = [];
      var blockRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
      var linkRegex = /<a[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
      var snippetRegex = /<p[^>]*>([\s\S]*?)<\/p>/i;
      var blockMatch;
      while ((blockMatch = blockRegex.exec(html)) !== null && results.length < maxResults) {
        var block = blockMatch[1];
        var linkMatch = linkRegex.exec(block);
        if (!linkMatch) continue;
        var href = linkMatch[1];
        var title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
        var snippetMatch = snippetRegex.exec(block);
        var body = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        if (title) results.push({ title: title, href: href, body: body });
      }
      return results;
    }

    // Try DDG first (matches desktop); fall back to Bing where DDG is blocked
    var sources = [
      { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), parse: parseDDG },
      { url: 'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + (maxResults + 5), parse: parseBing },
    ];

    for (var si = 0; si < sources.length; si++) {
      var html = await _fetch(sources[si].url);
      if (!html) continue;
      var results = sources[si].parse(html);
      if (results.length) {
        var lines = ['Search results for: ' + query + '\n'];
        results.forEach(function(r, i) {
          lines.push((i + 1) + '. ' + r.title);
          lines.push('   ' + r.href);
          lines.push('   ' + r.body + '\n');
        });
        return lines.join('\n');
      }
    }
    return 'No results found for: ' + query;
  }

  // ── count_chars (字符/词/行统计) ────────────────────────
  async function countChars(args) {
    var path = args.path || '';
    if (!path) return 'Error: path is required';
    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    var chars = content.length;
    var cjk = 0;
    for (var i = 0; i < content.length; i++) {
      var ch = content.charCodeAt(i);
      if ((ch >= 0x4E00 && ch <= 0x9FFF) || (ch >= 0x3000 && ch <= 0x303F)) cjk++;
    }
    var lines = content.split('\n').length;
    var words = content.trim().split(/\s+/).filter(Boolean).length;
    return path + ': ' + chars + ' chars, ' + cjk + ' CJK, ' + words + ' words, ' + lines + ' lines';
  }

  // ── parse_markdown (Markdown 标题结构解析) ──────────────
  async function parseMarkdown(args) {
    var path = args.path || '';
    if (!path) return 'Error: path is required';
    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    var lines = content.split('\n');
    var headings = [];
    lines.forEach(function(line, i) {
      var m = line.match(/^(#{1,6})\s+(.*)/);
      if (m) {
        headings.push({ level: m[1].length, title: m[2].trim(), line: i + 1 });
      }
    });

    if (!headings.length) return 'No headings found in ' + path;

    var result = 'Structure of ' + path + ':\n';
    headings.forEach(function(h) {
      var indent = '  '.repeat(h.level - 1);
      result += indent + 'H' + h.level + ': ' + h.title + ' (line ' + h.line + ')\n';
    });
    return result;
  }

  // ── parse_openapi (仅支持 JSON 格式，移动端无 YAML) ────
  async function parseOpenAPI(args) {
    var path = args.path || '';
    if (!path) return 'Error: path is required';
    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    var spec;
    try {
      spec = JSON.parse(content);
    } catch (e) {
      return 'Error: file is not valid JSON. YAML format is not supported on mobile.';
    }

    var lines = [];
    lines.push('OpenAPI: ' + (spec.info && spec.info.title || 'Unknown') + ' v' + (spec.info && spec.info.version || '?'));

    if (spec.paths) {
      Object.keys(spec.paths).forEach(function(pathKey) {
        var methods = spec.paths[pathKey];
        Object.keys(methods).forEach(function(method) {
          if (method === 'parameters') return;
          var op = methods[method];
          var summary = op.summary || '';
          lines.push('  ' + method.toUpperCase() + ' ' + pathKey + ' — ' + summary);
        });
      });
    }

    if (spec.components && spec.components.schemas) {
      lines.push('\nSchemas: ' + Object.keys(spec.components.schemas).join(', '));
    }

    return lines.join('\n');
  }

  // ── Expert system (翻译自 Python spawn_expert.py + kill_expert.py) ──
  // 专家是独立的子 Agent，拥有自己的上下文和系统 prompt，在后台运行。
  // JS 端利用 async/await 实现 Promise 并发，无需 Python 的 asyncio.Queue。

  // 专家类型定义 (翻译自 Python agent/sub_agents/*.md)
  var _EXPERT_TYPES = {
    'data-analysis-expert': {
      description: '资料分析出题批改专家',
      systemPrompt: '你是一位资料分析出题专家。根据给定的资料内容，生成高质量的资料分析题目。\n\n规则：\n1. 题目必须基于提供的资料，不能凭空编造数据\n2. 每道题都要有明确的计算过程和正确答案\n3. 选项设置要有迷惑性但不能有歧义\n4. 难度分为 ★★（基础计算）、★★★（比较分析）、★★★★（综合推断）\n5. 使用 write_questions 工具写入文件\n6. 完成后简要报告生成了多少题',
      allowedTools: ['read_file', 'write_file', 'list_files', 'web_search'],
      modelTier: 'fast',
    },
    'essay-expert': {
      description: '申论批改专家',
      systemPrompt: '你是一位申论批改专家。对用户的申论作答进行专业批改。\n\n规则：\n1. 从内容（论点明确性、论证充分性、逻辑性）和形式（结构完整度、语言规范性、字数）两个维度评分\n2. 每个维度给出具体得分和改进建议\n3. 提供范文对照，指出差距\n4. 使用 grade_practice 工具记录批改结果\n5. 批改要具体到段落，不能泛泛而谈',
      allowedTools: ['read_file', 'write_file', 'list_files', 'web_search'],
      modelTier: 'smart',
    },
    'practice-expert': {
      description: '行测出题专家',
      systemPrompt: '你是一位行测出题专家。根据知识点和难度要求，生成行测练习题。\n\n规则：\n1. 必须使用 write_questions 工具写入题目，绝不用 write_file 手动写练习文件\n2. 每批 10-15 道题\n3. 题目要覆盖指定知识点的各个方面\n4. 选项不能有明显排除项\n5. 每道题都要有完整的解题步骤和避坑提示\n6. 两阶段写作：先思考，后一次写定',
      allowedTools: ['read_file', 'write_file', 'list_files', 'web_search', 'write_questions'],
      modelTier: 'fast',
    },
    'grading-expert': {
      description: '练习批改专家',
      systemPrompt: '你是一位练习批改专家。批改用户的行测练习答案。\n\n规则：\n1. 必须使用 grade_practice 工具进行批改，绝不手动批改\n2. 逐题比对用户答案与正确答案\n3. 错误题目要分类：概念性错误、理解性错误、执行性错误\n4. 每道错题都要给出正确解法和避坑提示\n5. 批改完成后简要报告正确率',
      allowedTools: ['read_file', 'write_file', 'list_files', 'grade_practice'],
      modelTier: 'fast',
    },
  };

  // 专家运行状态 (翻译自 Python ExpertTaskState)
  var _activeExperts = {};  // expertId → ExpertTaskState
  var _expertResultQueue = [];  // 完成结果队列 (替代 Python asyncio.Queue)
  var _unhandledFailure = false;  // 是否有未处理的专家失败

  // 专家子 Agent 最大轮数和超时 (翻译自 Python base.py)
  var _EXPERT_MAX_TURNS = 999;
  var _EXPERT_TOOL_TIMEOUT = 120000;  // ms
  var _EXPERT_LLM_MAX_RETRIES = 2;

  function _spawnExpertId(type) {
    return 'expert-' + type + '-' + Math.random().toString(36).substring(2, 8);
  }

  // ── 专家子 Agent 运行循环 (翻译自 Python base.py ExpertAgent._run) ──
  async function _runExpertLoop(expertId, expertType, task, systemPrompt, allowedTools) {
    var config;
    try { config = AEngine.getConfig(); } catch (e) {
      return { id: expertId, success: false, result: '无法读取 API 配置' };
    }
    if (!config.api_key) {
      return { id: expertId, success: false, result: 'API Key 未配置，专家无法运行' };
    }

    // Model routing: use fast_model / smart_model per expert's modelTier
    // Falls back to main model if tier-specific model not configured
    var typeDef = _EXPERT_TYPES[expertType] || {};
    var modelTier = typeDef.modelTier || 'fast';
    var expertModel = config.model;  // default: same as main
    if (modelTier === 'fast' && config.fast_model) {
      expertModel = config.fast_model;
    } else if (modelTier === 'smart' && config.smart_model) {
      expertModel = config.smart_model;
    }
    // Build a config override for this expert
    var expertConfig = Object.assign({}, config, { model: expertModel });

    var format = AEngine.detectFormat(expertConfig);
    var allTools = Tools.TOOL_DEFINITIONS;
    // Filter tools to allowed set
    var expertTools = allTools.filter(function(t) {
      return allowedTools.indexOf(t.function.name) >= 0;
    });

    // Build expert's own context
    var expertMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    var allOutput = [];
    var consecutiveLlmFailures = 0;
    var toolResults = [];  // ExpertToolResult list

    for (var turn = 0; turn < _EXPERT_MAX_TURNS; turn++) {
      if (_activeExperts[expertId] && _activeExperts[expertId].killed) break;
      try {
        // Build messages for API call
        var ctxMsgs = expertMessages;
        var systemParts = [];
        var nonSystemMsgs = [];
        for (var mi = 0; mi < ctxMsgs.length; mi++) {
          if (ctxMsgs[mi].role === 'system') {
            systemParts.push(ctxMsgs[mi].content || '');
          } else {
            nonSystemMsgs.push(ctxMsgs[mi]);
          }
        }
        var combinedSystem = systemParts.join('\n\n') || null;

        var openaiMsgs = AEngine.buildOpenAIMessages(null, nonSystemMsgs);
        if (combinedSystem) {
          openaiMsgs.unshift({ role: 'system', content: combinedSystem });
        }
        var anthropicMsgs = AEngine.buildAnthropicMessages(null, nonSystemMsgs);

        var textBuffer = '';
        var toolCallsAcc = [];
        var llmOk = false;

        // LLM retry loop
        for (var llmAttempt = 0; llmAttempt <= _EXPERT_LLM_MAX_RETRIES; llmAttempt++) {
          try {
            await new Promise(function(resolve, reject) {
              var handler = {
                onChunk: function(chunk) {
                  if (chunk.type === 'text') textBuffer += chunk.content;
                },
                onDone: function(res) {
                  textBuffer = res.content || textBuffer;
                  toolCallsAcc = (res.tool_calls || []).filter(function(tc) { return tc.id; });
                  resolve();
                },
                onError: reject,
              };
              if (format === 'anthropic') {
                AEngine.callAnthropic(expertConfig, combinedSystem, anthropicMsgs, expertTools, false,
                  handler.onChunk, handler.onDone, handler.onError, null);
              } else {
                AEngine.callOpenAI(expertConfig, openaiMsgs, expertTools, false,
                  handler.onChunk, handler.onDone, handler.onError, null);
              }
            });
            llmOk = true;
            break;
          } catch (e) {
            var errMsg = (e && e.message) ? e.message : String(e);
            if (AEngine._isTransientError(errMsg) && llmAttempt < _EXPERT_LLM_MAX_RETRIES) {
              await new Promise(function(r) { setTimeout(r, Math.pow(2, llmAttempt) * 1000); });
              continue;
            }
            allOutput.push('[' + expertType + '] LLM 错误 turn ' + turn + ': ' + errMsg.substring(0, 200));
            break;
          }
        }

        if (!llmOk && !toolCallsAcc.length) {
          consecutiveLlmFailures++;
          if (consecutiveLlmFailures >= 5) {
            return { id: expertId, success: false, result: 'LLM API 连续失败 ' + consecutiveLlmFailures + ' 次，已停止' };
          }
          continue;
        }
        consecutiveLlmFailures = 0;

        // No tool calls → expert done
        if (!toolCallsAcc.length) {
          if (textBuffer.trim()) {
            expertMessages.push({ role: 'assistant', content: textBuffer });
            allOutput.push(textBuffer.trim());
          }
          var text = allOutput.join('\n') || '(no output)';
          // Expert succeeds when model finishes naturally with output
          var hasSuccessfulOutput = toolResults.some(function(tr) { return tr.success && tr.category === 'output'; });
          return { id: expertId, success: hasSuccessfulOutput, result: text.substring(0, 500), toolResults: toolResults };
        }

        // Cap tool calls
        if (toolCallsAcc.length > 10) toolCallsAcc = toolCallsAcc.slice(0, 10);

        // Save assistant message
        var assistantMsg = {
          role: 'assistant',
          content: textBuffer.trim() || null,
          tool_calls: toolCallsAcc.map(function(tc) {
            var parsedArgs = {};
            try { parsedArgs = JSON.parse(tc.function.arguments); } catch (e) { parsedArgs = {}; }
            return {
              id: tc.id, type: 'function',
              function: { name: tc.function.name, arguments: JSON.stringify(parsedArgs) },
            };
          }),
        };
        expertMessages.push(assistantMsg);

        // Execute tools in parallel with timeout
        var toolPromises = toolCallsAcc.map(function(tc) {
          var args = {};
          try { args = JSON.parse(tc.function.arguments); } catch (e) { args = {}; }
          var toolName = tc.function.name;

          return (async function() {
            var success = true;
            try {
              var result = await new Promise(function(resolve, reject) {
                var timer = setTimeout(function() {
                  reject(new Error('Timeout: tool exceeded ' + (_EXPERT_TOOL_TIMEOUT / 1000) + 's limit'));
                }, _EXPERT_TOOL_TIMEOUT);
                Tools.execute(toolName, args).then(function(v) {
                  clearTimeout(timer); resolve(v);
                }, function(e) {
                  clearTimeout(timer); reject(e);
                });
              });
              if (result === null || result === undefined) result = 'done';
              if (typeof result !== 'string') result = String(result);
            } catch (e) {
              result = 'Error: ' + (e && e.message ? e.message : String(e));
              success = false;
            }
            if (success && typeof result === 'string' && result.indexOf('Error:') === 0) success = false;

            // Determine tool category for output tracking
            var outputTools = new Set(['write_file', 'write_questions', 'grade_practice', 'append_file',
              'export_json', 'export_excel', 'export_markdown', 'export_xmind', 'export_testrail_csv']);
            var category = outputTools.has(toolName) ? 'output' : '';
            var toolPath = '';
            if (category === 'output') {
              for (var key in args) {
                if (args.hasOwnProperty(key) && typeof args[key] === 'string' &&
                    (key === 'path' || key === 'file' || key === 'output' || key === 'output_path' || key === 'target')) {
                  toolPath = args[key];
                  break;
                }
              }
            }

            toolResults.push({
              name: toolName, success: success,
              summary: String(result).substring(0, 100),
              category: category, path: toolPath,
            });
            return { tc: tc, args: args, result: result };
          })();
        });

        var execResults = await Promise.all(toolPromises);

        for (var ri = 0; ri < execResults.length; ri++) {
          var er = execResults[ri];
          var resultStr = er.result;
          var maxChars = { 'read_file': 12000, 'analyze_code': 8000, 'parse_openapi': 8000 }[er.tc.function.name] || 3000;
          if (resultStr.length > maxChars) {
            var head = resultStr.substring(0, Math.floor(maxChars * 2 / 3));
            var tail = resultStr.substring(resultStr.length - Math.floor(maxChars / 3));
            resultStr = head + '\n...(' + resultStr.length + ' total chars)...\n' + tail;
          }
          expertMessages.push({ role: 'tool', tool_call_id: er.tc.id, content: resultStr });
          allOutput.push('[' + er.tc.function.name + ']: ' + String(er.result).substring(0, 500));
        }

      } catch (e) {
        allOutput.push('[' + expertType + '] Turn ' + turn + ' error: ' + (e && e.message ? e.message : String(e)));
        continue;
      }
    }

    // Max turns reached
    var text = allOutput.join('\n') || '(max turns reached)';
    return { id: expertId, success: false, result: text.substring(0, 500), toolResults: toolResults };
  }

  // ── spawn_expert (翻译自 Python spawn_expert.py) ─────────
  async function spawnExpert(args) {
    var expertType = args.type || '';
    var task = args.task || '';
    var taskId = args.task_id || '';

    if (!expertType || !task) return 'Error: type and task are required';

    var typeDef = _EXPERT_TYPES[expertType];
    if (!typeDef) {
      var available = Object.keys(_EXPERT_TYPES);
      return 'Unknown agent: ' + expertType + '. Available: ' + available.join(', ');
    }

    var config;
    try { config = AEngine.getConfig(); } catch (e) {
      return 'spawn_expert 不可用。诊断信息：无法读取 API 配置。请检查 API Key 配置。';
    }
    if (!config.api_key) {
      return 'spawn_expert 不可用。诊断信息：API Key 未配置。请检查 API Key 配置。不要重复调用 spawn_expert。';
    }

    var expertId = _spawnExpertId(expertType);
    var systemPrompt = typeDef.systemPrompt;
    var allowedTools = typeDef.allowedTools;

    // Auto-generate temp output file suffix to prevent parallel experts overwriting each other
    var suffix = Math.random().toString(36).substring(2, 10);
    var jsonlMatch = task.match(/([\w一-鿿\/._-]+\.jsonl)/);
    var modifiedTask;
    if (jsonlMatch) {
      var origPath = jsonlMatch[1];
      var base = origPath.replace(/\.jsonl$/, '');
      var tempPath = base + '_' + suffix + '.jsonl';
      modifiedTask = task.replace(origPath, tempPath, 1);
    } else {
      modifiedTask = task + '\n\n【将输出写入临时文件，文件名加后缀 _' + suffix + '】';
    }

    // Auto-create a task for this expert (Python: always auto-create for completion gate)
    var linkedTaskId = '';
    if (taskId && _tasks[taskId]) {
      // Link existing task
      _tasks[taskId].expertId = expertId;
      _tasks[taskId].owner = expertType;
      _tasks[taskId].status = 'in_progress';
      linkedTaskId = taskId;
    } else {
      // Auto-create implicit task
      _taskCounter++;
      linkedTaskId = _taskCounter + '-' + _sessionSlug;
      _tasks[linkedTaskId] = {
        id: linkedTaskId,
        subject: '[auto] ' + expertType + '专家: ' + task.substring(0, 40).replace(/\n/g, ' '),
        description: task.substring(0, 200),
        status: 'in_progress',
        owner: expertType,
        expertId: expertId,
        expertFailures: 0,
        resultSummary: '',
        blocks: [],
        blockedBy: [],
      };
    }

    // Create ExpertTaskState
    var expertState = {
      id: expertId,
      type: expertType,
      task: task,
      startTime: Date.now(),
      promise: null,  // set below
      result: null,
      success: null,  // null = running, bool = finished
      killed: false,
      taskId: linkedTaskId,
    };

    // Launch expert in background (Promise)
    expertState.promise = (async function() {
      var runResult;
      try {
        runResult = await _runExpertLoop(expertId, expertType, modifiedTask, systemPrompt, allowedTools);
      } catch (e) {
        runResult = { id: expertId, success: false, result: '[' + expertType + '-expert] Fatal: ' + (e && e.message ? e.message : String(e)) };
      }

      if (!expertState.killed) {
        expertState.success = runResult.success;
        // Extract output files from runResult (not from outer toolResults which may not be populated yet)
        var outputFiles = (runResult.toolResults || []).filter(function(tr) { return tr.success && tr.path; }).map(function(tr) { return tr.path; });
        var tidDisplay = linkedTaskId ? '[' + linkedTaskId + ']' : '[auto]';

        if (runResult.success) {
          var filesStr = outputFiles.length ? outputFiles.join(', ') : 'no files written';
          var summary = '[' + expertType + ' 专家完成] 任务 ' + tidDisplay + ' 成功。输出: ' + filesStr;
          // Report notable failures
          var failed = (runResult.toolResults || []).filter(function(tr) { return !tr.success; });
          if (failed.length) {
            summary += '。注意: ' + failed.slice(0, 3).map(function(tr) { return tr.name + ': ' + tr.summary; }).join(', ');
          }
          expertState.result = summary;
        } else {
          var failed2 = (runResult.toolResults || []).filter(function(tr) { return !tr.success; });
          var reason;
          if (failed2.length) {
            reason = '工具失败: ' + failed2.slice(0, 3).map(function(tr) { return tr.name; }).join(', ');
          } else {
            reason = runResult.result ? runResult.result.substring(0, 120) : '未产出有效结果';
          }
          expertState.result = '[' + expertType + ' 专家失败] 任务 ' + tidDisplay + ' 失败: ' + reason;
        }

        // Update linked task
        if (_tasks[linkedTaskId]) {
          if (runResult.success) {
            _tasks[linkedTaskId].status = 'done';
          } else {
            _tasks[linkedTaskId].expertFailures++;
          }
          _tasks[linkedTaskId].resultSummary = expertState.result;
        }

        // Push to result queue
        _expertResultQueue.push({
          id: expertId,
          result: expertState.result,
          success: runResult.success,
        });
        if (!runResult.success) {
          _unhandledFailure = true;
        }
      }
    })();

    _activeExperts[expertId] = expertState;

    var modelName = config.model || 'default';
    return (
      '✅ 已启动 ' + expertType + ' 专家（模型: ' + modelName + '）\n' +
      'Task ID: [' + linkedTaskId + '] ← 记住此ID，完成后需要验证\n' +
      '任务: ' + task.substring(0, 120) + '\n' +
      '结果将在完成后自动注入上下文。'
    );
  }

  // ── kill_expert (翻译自 Python spawn_expert.py kill_expert) ──
  function killExpert(args) {
    var taskId = args.task_id || '';
    if (!taskId) return 'Error: task_id is required';

    var task = _tasks[taskId];
    if (!task) return '任务 [' + taskId + '] 不存在。用 task_list 查看当前任务。';
    if (task.status === 'done') return '任务 [' + taskId + '] 已完成，无需终止。';

    var expertId = task.expertId || '';
    if (!expertId) return '任务 [' + taskId + '] 没有关联的专家进程。';

    var es = _activeExperts[expertId];
    if (!es) return '专家 [' + expertId + '] 未在运行（可能已完成或已终止）。';

    // 1. Mark killed FIRST
    es.killed = true;

    // 2. Push kill result to queue
    var killSummary = '[' + es.type + ' 专家已终止] 任务 [' + taskId + '] 被用户手动终止，未完成。';
    es.result = killSummary;
    es.success = false;
    _expertResultQueue.push({
      id: expertId,
      result: killSummary,
      success: false,
    });
    _unhandledFailure = true;

    // 3. Update Task state immediately
    task.status = 'pending';
    task.expertId = '';
    task.resultSummary = killSummary;

    // 4. Clean up expert state
    delete _activeExperts[expertId];

    return (
      '已终止专家 [' + expertId + ']（类型: ' + es.type + '）\n' +
      '任务 [' + taskId + '] 状态已重置为 pending，可重新分配。\n' +
      '任务描述: ' + task.subject.substring(0, 80)
    );
  }

  // ── Expert result collection (翻译自 Python spawn_expert.py collect_background_results) ──
  function _collectBackgroundResults() {
    var results = [];
    while (_expertResultQueue.length > 0) {
      var item = _expertResultQueue.shift();
      if (!item.success) _unhandledFailure = true;
      results.push(item);
    }
    return results;
  }

  // ── Check if any experts are still pending (翻译自 Python has_pending_tasks) ──
  function _hasPendingExperts() {
    for (var eid in _activeExperts) {
      if (!_activeExperts.hasOwnProperty(eid)) continue;
      var es = _activeExperts[eid];
      if (es.success === null && !es.killed) return true;
    }
    return false;
  }

  // ── Check unhandled failures (翻译自 Python has_unhandled_failures) ──
  function _hasUnhandledFailures() {
    return _unhandledFailure;
  }

  function _clearUnhandledFailures() {
    _unhandledFailure = false;
  }

  // ── Check exhausted expert retries (翻译自 Python _exhausted_expert_retries) ──
  function _exhaustedExpertRetries() {
    var result = [];
    for (var tid in _tasks) {
      if (!_tasks.hasOwnProperty(tid)) continue;
      var t = _tasks[tid];
      if (t.status === 'done' || t.expertFailures < 2) continue;
      if (t.expertFailures > 0 && t.owner && t.owner !== 'agent') {
        result.push({ taskId: tid, expertType: t.owner });
      }
    }
    return result;
  }

  // ── Cancel all running experts ──
  function _cancelAllExperts() {
    for (var eid in _activeExperts) {
      if (!_activeExperts.hasOwnProperty(eid)) continue;
      _activeExperts[eid].killed = true;
    }
    _activeExperts = {};
    _expertResultQueue = [];
    _unhandledFailure = false;
  }

  // ── Reset expert state for new session ──
  function _resetExperts() {
    _cancelAllExperts();
  }

  // ── Phase 7: 剩余工具 ──────────────────────────────────────

  // ── run_bash / run_script: 移动端不可用 (Python: 完整实现, JS: 不可用) ──
  function runBash(args) {
    var cmd = args.command || '';
    return 'Error: run_bash 不可用于移动端。请使用文件操作工具（read_file/write_file/edit/list_files/glob/grep）替代。' +
      (cmd ? '\n你尝试执行的命令: ' + cmd.substring(0, 100) : '');
  }

  function runScript(args) {
    var script = args.script || '';
    return 'Error: run_script 不可用于移动端。请使用文件操作工具（read_file/write_file/edit）替代。' +
      (script ? '\n你尝试执行的脚本: ' + script.substring(0, 100) : '');
  }

  // ── analyze_code: 简化版正则匹配 (Python: tree-sitter AST, JS: regex) ──
  async function analyzeCode(args) {
    var path = args.path || '';
    var query = args.query || 'structure';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    var lines = content.split('\n');
    var result = [];

    if (query === 'structure' || query === 'classes' || query === 'functions') {
      // Regex-based structure extraction (simplified from Python tree-sitter)
      // Match class definitions
      var classRegex = /(?:class|type|struct|interface)\s+(\w+)/g;
      // Match function definitions (Python, JS, TS, Java, Go, Rust)
      var funcRegex = /(?:function|def|func|fn|public|private|protected|static)\s+(\w+)\s*[<(]/g;
      // Match method definitions inside classes
      var methodRegex = /(\w+)\s*\([^)]*\)\s*\{/g;

      var classes = [];
      var funcs = [];
      var match;

      while ((match = classRegex.exec(content)) !== null) {
        var lineNum = content.substring(0, match.index).split('\n').length;
        classes.push({ name: match[1], line: lineNum });
      }

      while ((match = funcRegex.exec(content)) !== null) {
        var lineNum2 = content.substring(0, match.index).split('\n').length;
        funcs.push({ name: match[1], line: lineNum2 });
      }

      result.push('File: ' + path + ' (' + lines.length + ' lines)');
      if (classes.length) {
        result.push('\nClasses/Types:');
        classes.forEach(function(c) { result.push('  L' + c.line + ': ' + c.name); });
      }
      if (funcs.length) {
        result.push('\nFunctions/Methods:');
        funcs.slice(0, 50).forEach(function(f) { result.push('  L' + f.line + ': ' + f.name); });
        if (funcs.length > 50) result.push('  ... (' + funcs.length + ' total, showing first 50)');
      }
      if (!classes.length && !funcs.length) {
        result.push('\nNo class or function definitions found (regex-based analysis).');
      }
    } else {
      // Generic query: search for the pattern
      try {
        var searchRegex = new RegExp(query, 'g');
        var matches = [];
        var m;
        while ((m = searchRegex.exec(content)) !== null) {
          var ln = content.substring(0, m.index).split('\n').length;
          matches.push('  L' + ln + ': ' + m[0].substring(0, 80));
          if (matches.length >= 30) break;
        }
        result.push('Search "' + query + '" in ' + path + ':');
        if (matches.length) {
          result.push(matches.join('\n'));
        } else {
          result.push('  No matches found.');
        }
      } catch (e) {
        result.push('Error: invalid regex query: ' + query);
      }
    }

    return result.join('\n');
  }

  // ── 导出工具 (翻译自 Python export_*.py) ──────────────────

  // export_xmind: 生成 XMind XML 格式 (简化版)
  async function exportXmind(args) {
    var path = args.path || '';
    var outputPath = args.output_path || '';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    // Parse markdown headings into tree structure
    var lines = content.split('\n');
    var topics = [];
    lines.forEach(function(line) {
      var m = line.match(/^(#{1,6})\s+(.*)/);
      if (m) topics.push({ level: m[1].length, title: m[2].trim() });
    });

    if (!topics.length) topics = [{ level: 1, title: path.replace(/\.md$/, '') }];

    // Build XMind XML
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<xmap-content>\n';
    xml += '<sheet><topic id="root" timestamp="' + Date.now() + '">\n';
    xml += '<title>' + _xmlEscape(topics[0].title) + '</title>\n';

    // Add children (simplified: flat list under root)
    for (var i = 1; i < topics.length; i++) {
      xml += '<children><topics><topic id="t' + i + '"><title>' + _xmlEscape(topics[i].title) + '</title></topic></topics></children>\n';
    }

    xml += '</topic></sheet>\n</xmap-content>';

    var outPath = outputPath || path.replace(/\.md$/, '.xmind.xml');
    await API.Repository.writeFile(proj(), outPath, xml);
    return 'XMind exported: ' + outPath + ' (' + xml.length + ' chars)';
  }

  function _xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // export_excel: 降级为 CSV 格式 (移动端无 xlsx 库)
  async function exportExcel(args) {
    var path = args.path || '';
    var outputPath = args.output_path || '';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    // Try to parse as JSON array of objects → CSV
    var data;
    try {
      data = JSON.parse(content);
      if (!Array.isArray(data)) data = [data];
    } catch (e) {
      // Not JSON — treat as markdown table or plain text
      return await _exportMarkdownTableAsCsv(content, outputPath || path.replace(/\.\w+$/, '.csv'));
    }

    if (!data.length) return 'Error: no data to export';

    // Collect all keys
    var keys = [];
    data.forEach(function(row) {
      Object.keys(row).forEach(function(k) {
        if (keys.indexOf(k) < 0) keys.push(k);
      });
    });

    // Build CSV
    var csv = keys.map(function(k) { return _csvEscape(k); }).join(',') + '\n';
    data.forEach(function(row) {
      csv += keys.map(function(k) { return _csvEscape(String(row[k] || '')); }).join(',') + '\n';
    });

    var outPath = outputPath || path.replace(/\.json$/, '.csv');
    await API.Repository.writeFile(proj(), outPath, csv);
    return 'CSV exported: ' + outPath + ' (' + data.length + ' rows, ' + keys.length + ' columns)';
  }

  function _csvEscape(s) {
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  async function _exportMarkdownTableAsCsv(content, outPath) {
    // Parse markdown table rows
    var lines = content.split('\n').filter(function(l) { return l.trim().indexOf('|') === 0; });
    // Remove separator rows (|---|---|)
    lines = lines.filter(function(l) { return !/^\|[\s-|]+\|$/.test(l); });

    if (lines.length < 1) {
      // Not a table — just save as-is with .csv extension
      await API.Repository.writeFile(proj(), outPath, content);
      return 'CSV exported (plain text): ' + outPath;
    }

    var csv = lines.map(function(line) {
      var cells = line.split('|').slice(1, -1).map(function(c) { return _csvEscape(c.trim()); });
      return cells.join(',');
    }).join('\n');

    await API.Repository.writeFile(proj(), outPath, csv);
    return 'CSV exported: ' + outPath + ' (' + lines.length + ' rows)';
  }

  // export_markdown: 将内容导出为 Markdown 文件
  async function exportMarkdown(args) {
    var path = args.path || '';
    var outputPath = args.output_path || '';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    var outPath = outputPath || path.replace(/\.\w+$/, '.md');
    // If source is JSON, convert to markdown
    var output;
    try {
      var data = JSON.parse(content);
      output = _jsonToMarkdown(data);
    } catch (e) {
      output = content; // Already text, just copy
    }

    await API.Repository.writeFile(proj(), outPath, output);
    return 'Markdown exported: ' + outPath + ' (' + output.length + ' chars)';
  }

  function _jsonToMarkdown(data, depth) {
    depth = depth || 0;
    var prefix = '#'.repeat(Math.min(depth + 1, 6));
    var lines = [];

    if (Array.isArray(data)) {
      data.forEach(function(item, i) {
        if (typeof item === 'object' && item !== null) {
          var title = item.title || item.name || item.subject || ('Item ' + (i + 1));
          lines.push(prefix + ' ' + title + '\n');
          lines.push(_jsonToMarkdown(item, depth + 1));
        } else {
          lines.push('- ' + String(item));
        }
      });
    } else if (typeof data === 'object' && data !== null) {
      Object.keys(data).forEach(function(key) {
        var val = data[key];
        if (typeof val === 'object' && val !== null) {
          lines.push(prefix + ' ' + key + '\n');
          lines.push(_jsonToMarkdown(val, depth + 1));
        } else {
          lines.push('**' + key + '**: ' + String(val));
        }
      });
    } else {
      lines.push(String(data));
    }

    return lines.join('\n');
  }

  // export_json: 将内容导出为 JSON 文件
  async function exportJson(args) {
    var path = args.path || '';
    var outputPath = args.output_path || '';
    var data = args.data;
    if (!path && !data) return 'Error: path or data is required';

    var content;
    if (data) {
      content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } else {
      content = await API.Repository.readFile(proj(), path);
      if (content === null) return 'Error: file not found: ' + path;
      // Try to pretty-print JSON
      try { content = JSON.stringify(JSON.parse(content), null, 2); } catch (e) {}
    }

    var outPath = outputPath || (path ? path.replace(/\.\w+$/, '.json') : 'export.json');
    await API.Repository.writeFile(proj(), outPath, content);
    return 'JSON exported: ' + outPath + ' (' + content.length + ' chars)';
  }

  // export_testrail_csv: 导出 TestRail 格式 CSV
  async function exportTestrailCsv(args) {
    var path = args.path || '';
    var outputPath = args.output_path || '';
    if (!path) return 'Error: path is required';

    var content = await API.Repository.readFile(proj(), path);
    if (content === null) return 'Error: file not found: ' + path;

    // Parse as JSON test cases
    var data;
    try {
      data = JSON.parse(content);
      if (!Array.isArray(data)) data = [data];
    } catch (e) {
      return 'Error: source must be JSON array of test cases for TestRail CSV export';
    }

    // TestRail CSV format
    var csv = 'Title,Section,Type,Priority,Steps,Expected Result\n';
    data.forEach(function(tc) {
      var title = _csvEscape(tc.title || tc.name || tc.subject || '');
      var section = _csvEscape(tc.section || tc.module || '');
      var type = _csvEscape(tc.type || 'Manual');
      var priority = _csvEscape(tc.priority || 'Medium');
      var steps = _csvEscape(tc.steps ? (Array.isArray(tc.steps) ? tc.steps.join('\n') : tc.steps) : '');
      var expected = _csvEscape(tc.expected || tc.expected_result || '');
      csv += [title, section, type, priority, steps, expected].join(',') + '\n';
    });

    var outPath = outputPath || path.replace(/\.json$/, '.testrail.csv');
    await API.Repository.writeFile(proj(), outPath, csv);
    return 'TestRail CSV exported: ' + outPath + ' (' + data.length + ' test cases)';
  }

  // ── 技能管理 (硬编码，移动端不支持动态发现) ──────────────
  var _BUILTIN_SKILLS = [
    { name: 'exam-workflows', description: '公考辅导工作流（出题、批改、复习、模考）', loaded: true },
    { name: 'exam-formats', description: '题目格式规范（A1-A7格式）', loaded: true },
    { name: 'knowledge-base', description: '知识库管理（收集、搜索、语义搜索）', loaded: true },
  ];
  var _loadedSkills = new Set(['exam-workflows', 'exam-formats', 'knowledge-base']);

  function discoverSkills() {
    var lines = ['Available skills:'];
    _BUILTIN_SKILLS.forEach(function(s) {
      var status = _loadedSkills.has(s.name) ? '✅ loaded' : '⬜ available';
      lines.push('  ' + s.name + ' — ' + s.description + ' (' + status + ')');
    });
    return lines.join('\n');
  }

  function loadSkill(args) {
    var name = args.name || '';
    if (!name) return 'Error: name is required';
    var skill = _BUILTIN_SKILLS.find(function(s) { return s.name === name; });
    if (!skill) return 'Error: unknown skill: ' + name + '. Use discover_skills to see available skills.';
    if (_loadedSkills.has(name)) return 'Skill ' + name + ' is already loaded.';
    _loadedSkills.add(name);
    return '✅ Skill ' + name + ' loaded: ' + skill.description;
  }

  function unloadSkill(args) {
    var name = args.name || '';
    if (!name) return 'Error: name is required';
    if (!_loadedSkills.has(name)) return 'Skill ' + name + ' is not loaded.';
    _loadedSkills.delete(name);
    return 'Skill ' + name + ' unloaded.';
  }

  // ── knowledge tools (知识条目存 IndexedDB) ─────────────
  async function knowledgeCollect(args) {
    var topic = args.topic || '';
    var content = args.content || '';
    var source = args.source || '';
    if (!topic || !content) return 'Error: topic and content are required';

    var id = '知识/' + topic.replace(/[\/\\]/g, '_') + '.json';
    var existing = await API.Repository.readFile(proj(), id);
    var entries = existing ? JSON.parse(existing) : [];

    entries.push({
      topic: topic,
      content: content,
      source: source,
      collected: new Date().toISOString(),
    });

    await API.Repository.writeFile(proj(), id, JSON.stringify(entries, null, 2));
    return 'Knowledge collected: ' + topic + ' (' + entries.length + ' entries total)';
  }

  async function knowledgeSearch(args) {
    var query = (args.query || '').toLowerCase();
    if (!query) return 'Error: query is required';

    // List all knowledge files
    var files = await API.Repository.listFiles(proj(), '知识/');
    if (!files || !files.length) return 'No knowledge entries found';

    var results = [];
    for (var i = 0; i < files.length; i++) {
      var content = await API.Repository.readFile(proj(), files[i]);
      if (!content) continue;
      try {
        var entries = JSON.parse(content);
        entries.forEach(function(e) {
          if ((e.topic || '').toLowerCase().indexOf(query) >= 0 ||
              (e.content || '').toLowerCase().indexOf(query) >= 0) {
            results.push(e);
          }
        });
      } catch (e2) {}
    }

    if (!results.length) return 'No results for: ' + query;
    return 'Found ' + results.length + ' knowledge entries:\n' +
      results.slice(0, 10).map(function(r, i) {
        return (i + 1) + '. ' + r.topic + ' (from ' + (r.source || 'unknown') + '): ' + (r.content || '').substring(0, 100);
      }).join('\n');
  }

  // knowledge_semantic_search: 降级为关键词搜索（移动端无 embedding 模型）
  async function knowledgeSemanticSearch(args) {
    // Same as keyword search on mobile
    return await knowledgeSearch(args);
  }

  // ── format_questions (non-tool helper, for programmatic use) ──
  function formatQuestions(args) {
    const file = args.file;
    const moduleName = args.module || '';
    const date = args.date || API.getLocalDate();
    const questions = args.questions || [];
    const essay = args.essay;

    let content = '# ' + moduleName + ' | ' + date + '\n\n';
    content += '## 练习题\n\n';
    let startIdx = 1;

    const cleaned = questions.map(q => ({
      ...q,
      options: _cleanOptions(q.options || []),
    }));

    cleaned.forEach((q, i) => {
      content += _formatQuestion(q, startIdx + i);
    });

    if (essay) {
      content += _formatEssay(essay);
    }
    return content;
  }

  // ── 工具清单 (用于 function calling 定义) ────────────────
  // 参数定义与 Python 工具保持一致
  const TOOL_DEFINITIONS = [
    {
      type: 'function',
      function: {
        name: 'write_questions',
        description: '将生成的练习题目写入指定文件。支持行测题(A1格式)和申论题(A5格式)，可附带讲义。如果文件已存在会自动续写(编号接续)。CRITICAL: ALL question generation MUST use this tool. NEVER write practice files manually via write_file.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '目标文件路径，如 练习/判断推理/2026-07-04.md' },
            module: { type: 'string', description: '模块名称' },
            date: { type: 'string', description: '日期' },
            questions: {
              type: 'array', description: '题目列表',
              items: {
                type: 'object',
                properties: {
                  stem: { type: 'string', description: '题干' },
                  options: { type: 'array', items: { type: 'string' }, description: '选项列表(最多4个)' },
                  answer: { type: 'string', description: '正确答案，如 B' },
                  difficulty: { type: 'string', description: '难度，如 ★★' },
	                  knowledge_point: { type: 'string', description: '知识点名称' },
	                  kp_label: { type: 'string', description: '考点标签(显示在题号旁)' },
	                  source_type: { type: 'string', description: '题源类型: ai_generated/simulated/past_exam/user_imported' },
	                  source_name: { type: 'string', description: '题源说明，如 2025国考真题风格模拟' },
	                  quality_status: { type: 'string', description: '质量状态: unchecked/checked/needs_review' },
	                  steps: { type: 'array', items: { type: 'string' }, description: '解题步骤(有序列表)' },
                  tip: { type: 'string', description: '避坑提示' },
                },
                required: ['stem', 'options', 'answer'],
              },
            },
            essay: {
              type: 'object', description: '申论题',
              properties: {
                material: { type: 'string', description: '给定材料' },
                requirements: { type: 'string', description: '作答要求' },
                reference_answer: { type: 'string', description: '参考答案' },
              },
            },
            lecture: {
              type: 'object', description: '讲义内容',
              properties: {
                topic: { type: 'string', description: '讲义主题' },
                concept: { type: 'string', description: '概念定义' },
                steps_text: { type: 'string', description: '解题步骤' },
                types_text: { type: 'string', description: '常见题型' },
                pitfalls_text: { type: 'string', description: '易错陷阱' },
                examples_text: { type: 'string', description: '例题精讲' },
              },
	            },
	            is_review: { type: 'boolean', description: '是否为间隔复习' },
	            source_type: { type: 'string', description: '本批题目的默认题源类型' },
	            source_name: { type: 'string', description: '本批题目的默认题源说明' },
	          },
          required: ['file', 'module'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grade_practice',
        description: '批改练习答案。逐题比较用户答案与正确答案，插入 grading block 到练习文件，并自动更新所有统计数据（练习统计、能力画像、复习队列、每日评分、错题本）。CRITICAL: ALL grading MUST use this tool. Do NOT grade manually.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '练习文件路径' },
            module: { type: 'string', description: '模块名称' },
            date: { type: 'string', description: '日期' },
            total: { type: 'integer', description: '总题数' },
            correct: { type: 'integer', description: '正确题数' },
            mode: { type: 'string', description: '批改模式: practice/review/essay/mock_exam/diagnostic' },
            knowledge_points: { type: 'array', items: { type: 'string' }, description: '涉及的知识点列表' },
            grades: {
              type: 'array', description: '批改结果列表',
              items: {
                type: 'object',
                properties: {
                  q: { type: 'integer', description: '题号' },
                  correct: { type: 'boolean', description: '是否正确' },
                  your_answer: { type: 'string', description: '用户答案' },
                  correct_answer: { type: 'string', description: '正确答案' },
                  knowledge_point: { type: 'string', description: '知识点' },
                  difficulty: { type: 'string', description: '难度' },
                  error_type: { type: 'string', description: '错误类型: 概念性错误/理解性错误/执行性错误' },
                  error_detail: { type: 'string', description: '错误详情' },
                  correct_approach: { type: 'string', description: '正确解法' },
                  tips: { type: 'string', description: '解题技巧' },
                },
                required: ['q', 'correct'],
              },
            },
	            time_seconds: { type: 'integer', description: '答题用时(秒)' },
	            confidence: { type: 'string', description: '评分置信度: low/medium/high' },
	            evidence: { type: 'string', description: '评分依据摘要' },
	            review_points: { type: 'array', items: { type: 'string' }, description: '可复核点' },
	          },
          required: ['file', 'module', 'date', 'total', 'correct', 'grades'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grade_essay',
        description: '批改申论答案。插入 AI 批改块（Total/Coverage/Logic/Expression）到申论文件，并自动更新统计数据（练习统计、能力画像、每日评分）。CRITICAL: 申论批改必须使用此工具，不要用 grade_practice 或手动 write_file。',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '申论练习文件路径，如 练习/申论/2026-07-04.md' },
            date: { type: 'string', description: '日期 YYYY-MM-DD' },
            essay_type: { type: 'string', description: '申论题型：归纳概括/综合分析/提出对策/贯彻执行/申发论述' },
            scores: {
              type: 'object',
              description: '评分维度',
              properties: {
                total: { type: 'integer', description: '总分' },
                max_total: { type: 'integer', description: '满分，默认15' },
                coverage: { type: 'integer', description: '要点覆盖 0-5' },
                logic: { type: 'integer', description: '逻辑结构 0-3' },
                expression: { type: 'integer', description: '语言表达 0-4' },
                word_count_ok: { type: 'boolean', description: '字数是否达标' },
              },
              required: ['total', 'coverage', 'logic', 'expression'],
            },
	            missing_points: { type: 'array', items: { type: 'string' }, description: '遗漏的要点' },
	            highlights: { type: 'array', items: { type: 'string' }, description: '亮点' },
	            feedback: { type: 'string', description: '总体评语' },
	            time_seconds: { type: 'integer', description: '作答用时(秒)' },
	            confidence: { type: 'string', description: '评分置信度: low/medium/high' },
	            evidence: { type: 'string', description: '评分依据摘要' },
	            review_points: { type: 'array', items: { type: 'string' }, description: '可复核点' },
	          },
          required: ['file', 'essay_type', 'scores'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grade_interview',
        description: '面试模拟评分。根据作答内容给出内容/表达/逻辑评分（各1-5），保存到面试画像并更新统计数据（练习统计、能力画像、每日评分）。CRITICAL: 面试评分必须使用此工具。',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '日期 YYYY-MM-DD' },
            interview_type: { type: 'string', description: '面试类型：结构化/无领导小组' },
            question_count: { type: 'integer', description: '题目数量' },
            scores: {
              type: 'object',
              description: '评分维度',
              properties: {
                content: { type: 'integer', description: '内容 1-5' },
                expression: { type: 'integer', description: '表达 1-5' },
                logic: { type: 'integer', description: '逻辑 1-5' },
                total: { type: 'integer', description: '总分（不填则自动求和 content+expression+logic）' },
                max_total: { type: 'integer', description: '满分，默认15' },
              },
              required: ['content', 'expression', 'logic'],
	            },
	            feedback: { type: 'string', description: '总体评语' },
	            time_seconds: { type: 'integer', description: '作答用时(秒)' },
	            confidence: { type: 'string', description: '评分置信度: low/medium/high' },
	            evidence: { type: 'string', description: '评分依据摘要' },
	            review_points: { type: 'array', items: { type: 'string' }, description: '可复核点' },
	          },
          required: ['scores'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_project',
        description: '创建备考工程并初始化所有默认数据文件（备考计划、能力画像、练习统计、复习队列、知识体系、syllabus）。当读取 备考计划.json 不存在（首次使用）时调用。需先向用户询问考试类型/省份/日期等信息。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工程名称，不填用当前默认' },
            exam_type: { type: 'string', description: '考试类型：国考/省考/选调/事业编' },
            province: { type: 'string', description: '目标省份（省考必填）' },
            exam_date: { type: 'string', description: '考试日期 YYYY-MM-DD' },
            mock_exam_count: { type: 'integer', description: '模考题量，默认120' },
            position: { type: 'string', description: '目标岗位（可选）' },
            requirements: { type: 'string', description: '备考要求（可选）' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取项目中的文件内容。支持行范围读取和尾部字节读取。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            lines: { type: 'string', description: '行范围，如 "first_50", "last_30", "10-20"' },
            tail_bytes: { type: 'integer', description: '读取文件最后N个字节' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入文件内容。默认覆盖已有文件。设置overwrite=false可防止误覆盖。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' },
            overwrite: { type: 'boolean', description: '是否覆盖已有文件(默认true)' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: '列出某目录下的文件列表。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目录路径前缀' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'append_file',
        description: '追加文本到文件末尾。文件不存在时自动创建。适合大文件追加和 JSONL 记录。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '要追加的内容。如需与已有内容分隔，须包含前导换行符。' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: '用字符串替换编辑文件内容。容忍行尾空白差异。查找 old_string 并替换为 new_string。设置 replace_all=true 替换所有匹配，否则 old_string 必须唯一。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '要编辑的文件路径' },
            old_string: { type: 'string', description: '要查找并替换的文本。匹配时忽略每行行尾空白。' },
            new_string: { type: 'string', description: '替换文本。须与 old_string 不同。' },
            replace_all: { type: 'boolean', description: '替换所有匹配(默认false)。设为true用于全局重命名变量。' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'glob',
        description: '快速文件搜索。支持 ** 递归匹配（如 "src/**/*.ts"）。比 ls|grep 更快。用于在读取文件前定位文件位置。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob 匹配模式。支持 ** 递归。如 "**/*.py", "src/**/*.ts", "*.json"。' },
            path: { type: 'string', description: '搜索的基础目录。默认为项目根目录。' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: '使用正则表达式搜索文件内容。支持完整正则语法。可用 glob 模式过滤文件。比通过 bash grep 更快更精确。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: '正则表达式模式。如 "function\\s+\\w+" 或 "TODO|FIXME"。' },
            path: { type: 'string', description: '搜索的文件或目录。默认为项目根目录。' },
            glob: { type: 'string', description: '按 glob 模式过滤文件。如 "*.py", "**/*.{ts,tsx}"。' },
            output_mode: { type: 'string', description: '输出模式: content 显示匹配行, files_with_matches 显示文件路径, count 显示匹配数。默认: files_with_matches。' },
            '-i': { type: 'boolean', description: '忽略大小写搜索。默认: false。' },
            head_limit: { type: 'integer', description: '限制输出行数为前N行。默认: 200。' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '向用户提问并等待回复。当需要确认方案、澄清需求或请求信息时使用。返回带有标记的文本，前端会弹出输入框让用户回复。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '要向用户提问的问题' },
          },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'request_review',
        description: '请求用户审核内容。当需要用户确认方案、审查代码或检查结果时使用。返回带有标记的文本，前端会展示审核面板。',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '需要用户审核的内容摘要' },
          },
          required: ['content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_create',
        description: '创建任务追踪进度。在生成专家或开始复杂工作前使用。先规划后执行。',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: '简短任务标题(祈使句)' },
            description: { type: 'string', description: '需要做什么、预期输出' },
            blocks: { type: 'array', items: { type: 'string' }, description: '依赖此任务的 task_id 列表' },
            blocked_by: { type: 'array', items: { type: 'string' }, description: '此任务依赖的 task_id 列表' },
          },
          required: ['subject'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_update',
        description: '更新任务状态或依赖关系。开始时标记 in_progress，完成时标记 done。',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: '要更新的任务 ID' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '新状态' },
            add_blocks: { type: 'array', items: { type: 'string' }, description: '此任务现在阻塞的 task_id 列表' },
            add_blocked_by: { type: 'array', items: { type: 'string' }, description: '此任务现在依赖的 task_id 列表' },
          },
          required: ['task_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_list',
        description: '显示所有当前任务及其状态和依赖关系。在声称完成前务必检查。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: '获取 URL 内容并分析。抓取网页，将 HTML 转为纯文本，返回内容供分析。用于获取和分析网页内容。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要获取内容的 URL。必须是完整有效的 URL。' },
            prompt: { type: 'string', description: '描述要从页面提取什么信息的提示词。' },
          },
          required: ['url', 'prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '使用 DuckDuckGo 搜索互联网。返回每个结果的标题、URL 和摘要。用于查找新闻、文档、事实等训练数据之外的信息。免费，无需 API Key。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询字符串。要具体——包含关键词、日期或站点限制以获得更好结果。' },
            max_results: { type: 'integer', description: '最大返回结果数(默认5，最大10)。' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'count_chars',
        description: '统计文件的字符数、CJK 字符数、词数和行数。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'parse_markdown',
        description: '解析 Markdown 文件的标题结构。返回各级标题及其行号。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Markdown 文件路径' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'parse_openapi',
        description: '解析 OpenAPI 规范文件。仅支持 JSON 格式（移动端不支持 YAML）。返回 API 端点和 Schema 列表。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'OpenAPI JSON 文件路径' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'knowledge_collect',
        description: '收集知识条目并保存到知识库。用于保存从网页、文档等来源提取的重要信息。',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '知识主题' },
            content: { type: 'string', description: '知识内容' },
            source: { type: 'string', description: '来源（URL、文件名等）' },
          },
          required: ['topic', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'knowledge_search',
        description: '搜索知识库中的条目。按关键词匹配主题和内容。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spawn_expert',
        description: '委派后台专家子Agent执行任务。非阻塞，立即返回。类型: data-analysis-expert(资料分析出题批改), essay-expert(申论批改), practice-expert(行测出题), grading-expert(练习批改). 在task中包含项目路径和文件路径。',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: "Agent类型，如 'data-analysis-expert', 'essay-expert', 'practice-expert', 'grading-expert'" },
            task: { type: 'string', description: '任务指令，包含完整项目路径和精确文件路径。例如: "批改 练习/判断推理/2026-05-12.md 的 Q11-Q15"' },
            task_id: { type: 'string', description: '关联的任务ID（可选，不提供则自动创建）' },
          },
          required: ['type', 'task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kill_expert',
        description: '终止正在运行的专家任务。将关联任务重置为pending。仅用于活跃专家，不适用于已完成的。',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: "要终止的任务ID（如 '8-53bc'）。关联的专家将被终止。" },
          },
          required: ['task_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_bash',
        description: '运行 shell 命令。移动端不可用，返回错误并建议替代工具。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的 shell 命令' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_script',
        description: '运行脚本代码。移动端不可用，返回错误并建议替代工具。',
        parameters: {
          type: 'object',
          properties: {
            script: { type: 'string', description: '要执行的脚本代码' },
            language: { type: 'string', description: '脚本语言（如 python, javascript）' },
          },
          required: ['script'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_code',
        description: '分析代码文件结构。移动端使用正则匹配替代 tree-sitter AST。支持 structure/classes/functions 查询和自定义正则搜索。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            query: { type: 'string', description: '查询类型: structure, classes, functions, 或正则表达式。默认: structure' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_xmind',
        description: '将文件导出为 XMind 思维导图格式（XML）。Markdown 文件的标题层级转为思维导图节点。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '源文件路径' },
            output_path: { type: 'string', description: '输出文件路径（默认自动生成）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_excel',
        description: '将数据导出为 CSV 格式（移动端降级，不支持 xlsx）。JSON 数组或 Markdown 表格均可导出。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '源数据文件路径（JSON 或 Markdown 表格）' },
            output_path: { type: 'string', description: '输出 CSV 文件路径（默认自动生成）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_markdown',
        description: '将文件导出为 Markdown 格式。JSON 数据自动转为 Markdown 标题/列表结构。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '源文件路径' },
            output_path: { type: 'string', description: '输出 Markdown 文件路径（默认自动生成）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_json',
        description: '将数据导出为 JSON 文件。支持从路径读取或直接传入数据。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '源文件路径（与 data 二选一）' },
            data: { type: 'string', description: '直接传入的 JSON 数据（与 path 二选一）' },
            output_path: { type: 'string', description: '输出 JSON 文件路径（默认自动生成）' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_testrail_csv',
        description: '将测试用例导出为 TestRail 兼容的 CSV 格式。源文件需为 JSON 格式的测试用例数组。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '源 JSON 测试用例文件路径' },
            output_path: { type: 'string', description: '输出 CSV 文件路径（默认自动生成）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'discover_skills',
        description: '发现可用技能列表。移动端提供硬编码的技能列表。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_skill',
        description: '加载指定技能。加载后技能提供的工具和上下文可用于后续对话。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名称（用 discover_skills 查看可用技能）' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'unload_skill',
        description: '卸载指定技能。卸载后该技能的工具和上下文不再可用。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名称' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'knowledge_semantic_search',
        description: '语义搜索知识库（移动端降级为关键词搜索）。按语义相似度匹配知识条目。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询' },
          },
          required: ['query'],
        },
      },
    },
  ];

  // ── 工具执行调度 ───────────────────────────────────────
  async function execute(name, args) {
    switch (name) {
      case 'write_questions':       return await writeQuestions(args);
      case 'grade_practice':        return await gradePractice(args);
      case 'grade_essay':          return await gradeEssay(args);
      case 'grade_interview':      return await gradeInterview(args);
      case 'create_project':       return await createProject(args);
      case 'read_file':             return await readFile(args);
      case 'write_file':            return await writeFile(args);
      case 'list_files':            return await listFiles(args);
      case 'append_file':           return await appendFile(args);
      case 'edit':                  return await editFile(args);
      case 'glob':                  return await globFiles(args);
      case 'grep':                  return await grepFiles(args);
      case 'update_stats':          return await updateStats(args);
      case 'ask_user':              return askUser(args);
      case 'request_review':        return requestReview(args);
      case 'task_create':           return taskCreate(args);
      case 'task_update':           return taskUpdate(args);
      case 'task_list':             return taskList();
      case 'web_fetch':             return await webFetch(args);
      case 'web_search':            return await webSearch(args);
      case 'count_chars':           return await countChars(args);
      case 'parse_markdown':        return await parseMarkdown(args);
      case 'parse_openapi':         return await parseOpenAPI(args);
      case 'knowledge_collect':     return await knowledgeCollect(args);
      case 'knowledge_search':      return await knowledgeSearch(args);
      case 'knowledge_semantic_search': return await knowledgeSemanticSearch(args);
      case 'spawn_expert':          return await spawnExpert(args);
      case 'kill_expert':           return killExpert(args);
      case 'run_bash':              return runBash(args);
      case 'run_script':            return runScript(args);
      case 'analyze_code':          return await analyzeCode(args);
      case 'export_xmind':          return await exportXmind(args);
      case 'export_excel':          return await exportExcel(args);
      case 'export_markdown':       return await exportMarkdown(args);
      case 'export_json':           return await exportJson(args);
      case 'export_testrail_csv':   return await exportTestrailCsv(args);
      case 'discover_skills':       return discoverSkills();
      case 'load_skill':            return loadSkill(args);
      case 'unload_skill':          return unloadSkill(args);
      default:                      return 'Error: unknown tool ' + name;
    }
  }

  // ── 对外接口 ──────────────────────────────────────────
  return {
    TOOL_DEFINITIONS,
    execute,
    // Exposed for programmatic use
    writeQuestions,
    gradePractice,
    readFile,
    writeFile,
    formatQuestions,
    // Task system (for engine integration)
    _hasIncompleteTasks,
    _taskStatusSummary,
    resetTasks,
    // Expert system (for engine integration)
    _collectBackgroundResults,
    _hasPendingExperts,
    _hasUnhandledFailures,
    _clearUnhandledFailures,
    _exhaustedExpertRetries,
    _cancelAllExperts,
    _resetExperts,
    _activeExperts,
  };
})();
