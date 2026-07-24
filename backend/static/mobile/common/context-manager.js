// ===== Context Manager — 上下文管理与压缩 =====
// 翻译自 Python context/manager.py + context/compressor.py
// 管理 conversation context window，包括 token 估算、压缩触发、摘要生成

// ── 常量 (翻译自 Python manager.py + compressor.py) ──────────
var KEEP_RECENT_TURNS = 12;   // Keep last ~6 real turns (Python: 12)
var COMPRESSION_THRESHOLD = 0.7;  // Trigger when tokens > 70% of max (Python: 0.7)
var MAX_SUMMARY_CHARS = 6000;     // Cap summary to ~2K tokens (Python: 6000)
var MAX_TOOL_RESULT_CHARS = 2000; // For compression trimming (Python: 2000)

// ── ContextCompressor (翻译自 Python compressor.py) ──────────

var ContextCompressor = {
  // Strip thinking blocks from all assistant messages before compression (Python line 10-24)
  _stripThinking: function(messages) {
    var result = [];
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        var cleaned = msg.content.filter(function(b) {
          return !(typeof b === 'object' && b !== null && b.type === 'thinking');
        });
        if (cleaned.length > 0) {
          var m = Object.assign({}, msg, { content: cleaned });
          result.push(m);
        } else {
          result.push(Object.assign({}, msg, { content: [{ type: 'text', text: '(thinking removed)' }] }));
        }
      } else {
        result.push(msg);
      }
    }
    return result;
  },

  // Trim a single message to remove noise while keeping signal (Python line 26-62)
  _trimMessage: function(m) {
    var role = m.role || '';
    var content = m.content || '';

    if (role === 'tool') {
      var text = String(content);
      if (text.length > MAX_TOOL_RESULT_CHARS) {
        var head = text.substring(0, Math.floor(MAX_TOOL_RESULT_CHARS * 2 / 3));
        var tail = text.substring(text.length - Math.floor(MAX_TOOL_RESULT_CHARS / 3));
        text = head + '\n...(' + text.length + ' total)...\n' + tail;
      }
      return { role: role, content: text, tool_call_id: m.tool_call_id || '' };
    }

    if (role === 'assistant' && m.tool_calls) {
      var trimmedCalls = [];
      for (var i = 0; i < m.tool_calls.length; i++) {
        var tc = m.tool_calls[i];
        var func = (tc.function || {});
        var args = String(func.arguments || '');
        if (args.length > 500) args = args.substring(0, 500) + '...';
        trimmedCalls.push({
          id: tc.id || '',
          type: 'function',
          function: { name: func.name || '', arguments: args },
        });
      }
      var t = content ? String(content) : '';
      if (t.length > 1000) t = t.substring(0, 1000) + '...';
      return { role: role, content: t || null, tool_calls: trimmedCalls };
    }

    // User/assistant text: keep as-is, but preserve more context
    if (typeof content === 'string' && content.length > 4000) {
      if (role === 'user') {
        content = content.substring(0, 5000) + '...';  // Preserve more of user requests
      } else {
        content = content.substring(0, 4000) + '...';
      }
    }
    return { role: role, content: content };
  },

  // Split messages at user-message boundaries (Python line 94-136)
  _splitAtTurns: function(messages, targetParts) {
    if (!messages.length) return [];

    // Find all turn boundaries (indices where a user message starts)
    var boundaries = [];
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user' && i > 0) {
        boundaries.push(i);
      }
    }

    if (!boundaries.length || boundaries.length + 1 <= targetParts) {
      // Not enough turns to split at target granularity.
      // Chunk at safe boundaries (user messages) to avoid cutting tool pairs.
      var chunkSize = Math.max(1, Math.floor(messages.length / targetParts));
      var chunks = [];
      var start = 0;
      while (start < messages.length) {
        var end = Math.min(start + chunkSize, messages.length);
        if (end < messages.length) {
          var safe = end;
          while (safe > start && messages[safe - 1].role !== 'user') { safe--; }
          if (safe > start) end = safe;
        }
        chunks.push(messages.slice(start, end));
        start = end;
      }
      return chunks.length > 1 ? chunks : [messages];
    }

    // Pick boundary indices that divide turns evenly
    var totalTurns = boundaries.length + 1;
    var step = Math.max(1, Math.floor(totalTurns / targetParts));
    var picked = [];
    for (var pi = 1; pi < targetParts; pi++) {
      var bi = pi * step - 1;
      if (bi < boundaries.length) picked.push(boundaries[bi]);
    }

    var chunks2 = [];
    var start2 = 0;
    for (var pj = 0; pj < picked.length; pj++) {
      chunks2.push(messages.slice(start2, picked[pj]));
      start2 = picked[pj];
    }
    chunks2.push(messages.slice(start2));
    return chunks2.filter(function(c) { return c.length > 0; });
  },

  // Build conversation text from messages for compression prompt
  _buildConversationText: function(messages, maxLineLen) {
    maxLineLen = maxLineLen || 600;
    var trimmed = messages.map(this._trimMessage.bind(this));
    var lines = [];
    for (var i = 0; i < trimmed.length; i++) {
      var m = trimmed[i];
      var role = m.role;
      var content = String(m.content || '');
      if (!content.trim()) {
        var tcs = m.tool_calls || [];
        if (tcs.length) {
          var names = tcs.map(function(tc) { return (tc.function || {}).name || '?'; });
          lines.push('[' + role + ']: called ' + names.join(', '));
        }
        continue;
      }
      lines.push('[' + role + ']: ' + content.substring(0, maxLineLen));
    }
    return lines.join('\n');
  },

  // Call LLM for compression (no tools, no streaming)
  async _callLLMForCompression(config, format, messages) {
    // Use non-streaming call for compression
    if (format === 'anthropic') {
      return await this._callAnthropicForCompression(config, messages);
    } else {
      return await this._callOpenAIForCompression(config, messages);
    }
  },

  async _callOpenAIForCompression(config, messages) {
    var url = ((config.api_base || 'https://api.openai.com/v1').replace(/\/+$/, '')) + '/chat/completions';
    var body = JSON.stringify({
      model: config.model || 'gpt-4o',
      messages: messages,
      stream: false,
    });
    var headers = {
      'Authorization': 'Bearer ' + (config.api_key || ''),
      'Content-Type': 'application/json',
    };

    // Try CapacitorHttp first
    if (typeof CapacitorHttp !== 'undefined') {
      try {
        var resp = await CapacitorHttp.request({
          url: url, method: 'POST', headers: headers, data: JSON.parse(body),
          connectTimeout: 30000, readTimeout: 60000,
        });
        if (resp.status >= 200 && resp.status < 300) {
          var data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
          var choice = (data.choices || [])[0] || {};
          return (choice.message && choice.message.content) || '';
        }
        throw new Error('HTTP ' + resp.status);
      } catch (e) {
        console.warn('[ContextCompressor] CapacitorHttp failed:', e.message);
      }
    }

    // Fallback: fetch
    try {
      var resp2 = await fetch(url, { method: 'POST', headers: headers, body: body });
      var data2 = await resp2.json();
      var choice2 = (data2.choices || [])[0] || {};
      return (choice2.message && choice2.message.content) || '';
    } catch (e) {
      console.warn('[ContextCompressor] fetch failed:', e.message);
      return '';
    }
  },

  async _callAnthropicForCompression(config, messages) {
    var url = ((config.api_base || 'https://api.anthropic.com/v1').replace(/\/+$/, '')) + '/messages';
    // Anthropic format: system is a top-level field
    var systemContent = '';
    var apiMessages = [];
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system') {
        systemContent = messages[i].content || '';
      } else {
        apiMessages.push(messages[i]);
      }
    }
    var compMaxTokens = config.max_tokens ? Math.min(config.max_tokens, 4096) : 4096;
    var bodyObj = {
      model: config.model || 'claude-opus-4-8',
      max_tokens: compMaxTokens,
      messages: apiMessages,
    };
    if (systemContent) bodyObj.system = systemContent;
    var headers = {
      'x-api-key': config.api_key || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };

    if (typeof CapacitorHttp !== 'undefined') {
      try {
        var resp = await CapacitorHttp.request({
          url: url, method: 'POST', headers: headers,
          data: Object.assign({}, bodyObj, { stream: false }),
          connectTimeout: 30000, readTimeout: 60000,
        });
        if (resp.status >= 200 && resp.status < 300) {
          var data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
          var textBlocks = (data.content || []).filter(function(b) { return b.type === 'text'; });
          return textBlocks.map(function(b) { return b.text; }).join('');
        }
        throw new Error('HTTP ' + resp.status);
      } catch (e) {
        console.warn('[ContextCompressor] CapacitorHttp failed:', e.message);
      }
    }

    try {
      var resp2 = await fetch(url, {
        method: 'POST', headers: headers,
        body: JSON.stringify(Object.assign({}, bodyObj, { stream: false })),
      });
      var data2 = await resp2.json();
      var textBlocks2 = (data2.content || []).filter(function(b) { return b.type === 'text'; });
      return textBlocks2.map(function(b) { return b.text; }).join('');
    } catch (e) {
      console.warn('[ContextCompressor] fetch failed:', e.message);
      return '';
    }
  },

  // Single-pass full compression (Python line 138-185)
  async _compressFull(messages, config, format) {
    var convText = this._buildConversationText(messages, 600);
    // Limit to last 80 lines (Python: lines[-80:])
    var lines = convText.split('\n');
    if (lines.length > 80) lines = lines.slice(-80);
    convText = lines.join('\n');

    var summaryPrompt = [
      { role: 'system', content: (
        'Summarize the conversation below in a structured format. Output XML:\n' +
        '<analysis>bullet points of key facts</analysis>\n' +
        '<summary>\n' +
        '  <request>All user requests and intents (verbatim where possible)</request>\n' +
        '  <concepts>Key technical concepts discussed</concepts>\n' +
        '  <files>Files examined, modified, or created</files>\n' +
        '  <errors>Errors encountered and fixes applied</errors>\n' +
        '  <user_messages>ALL user messages (non-tool-result)</user_messages>\n' +
        '  <pending>Tasks explicitly requested but not yet done</pending>\n' +
        '  <current>What the agent was doing immediately before this summary</current>\n' +
        '</summary>\n' +
        'Only the <summary> will be kept. Be specific — include file paths, module names, counts.'
      )},
      { role: 'user', content: convText },
    ];

    try {
      var raw = await this._callLLMForCompression(config, format, summaryPrompt);
      raw = (raw || '').trim();
      if (raw) {
        var match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
        return match ? match[1].trim() : raw;
      }
    } catch (e) {
      console.warn('[ContextCompressor] _compressFull failed:', e.message);
    }
    return null;
  },

  // Compress with bridging — sequential chunks (Python line 187-242)
  async _compressWithBridge(chunks, config, format) {
    var bridge = '';
    var summaries = [];
    var total = chunks.length;

    for (var ci = 0; ci < chunks.length; ci++) {
      var chunkText = this._buildConversationText(chunks[ci], 300);
      if (bridge) {
        chunkText = '[Earlier summary]\n' + bridge + '\n\n[Current segment]\n' + chunkText;
      }

      var chunkPrompt = [
        { role: 'system', content: (
          'Summarize conversation segment ' + (ci + 1) + '/' + total + '. ' +
          'If earlier summary is provided, use it as context — do NOT repeat it, ' +
          'only add NEW information from the current segment. ' +
          'List: user requests, files, tools, errors, decisions. 3-5 sentences. English.'
        )},
        { role: 'user', content: chunkText },
      ];

      try {
        var text = await this._callLLMForCompression(config, format, chunkPrompt);
        text = (text || '').trim();
        if (!text) return null;
        summaries.push(text);
        bridge = text;  // carry forward as context for next chunk
      } catch (e) {
        return null;
      }
    }

    if (summaries.length <= 1) {
      return summaries[0] || null;
    }
    return summaries.map(function(s, i) {
      return '[' + (i + 1) + '/' + total + '] ' + s;
    }).join('\n');
  },

  // Main compress entry point (Python line 70-92)
  async compress(messages, config, format) {
    if (!messages || !messages.length) return '';

    // Strip thinking blocks — huge and only useful for current turn
    messages = this._stripThinking(messages);

    // Phase 1: try full compression (up to 2 attempts)
    for (var attempt = 0; attempt < 2; attempt++) {
      var result = await this._compressFull(messages, config, format);
      if (result) return result;
    }

    // Phase 2: progressive turn-boundary split — 2, 4, 8, 16 parts
    var partsList = [2, 4, 8, 16];
    for (var pi = 0; pi < partsList.length; pi++) {
      var chunks = this._splitAtTurns(messages, partsList[pi]);
      if (chunks.length <= 1) break;
      var result2 = await this._compressWithBridge(chunks, config, format);
      if (result2) return result2;
    }

    return this.fallbackCompress(messages);
  },

  // Rule-based summary when LLM compression isn't available (Python line 244-274)
  fallbackCompress: function(messages) {
    messages = this._stripThinking(messages);
    if (!messages.length) return '';

    var userMsgs = [];
    var toolCalls = new Set();
    var errors = [];

    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var role = m.role || '';
      var content = String(m.content || '');
      if (role === 'user' && content.trim()) {
        userMsgs.push(content.substring(0, 100));
      }
      if (role === 'assistant' && m.tool_calls) {
        for (var j = 0; j < m.tool_calls.length; j++) {
          var tc = m.tool_calls[j];
          toolCalls.add((tc.function || {}).name || '');
        }
      }
      if (role === 'tool' && content.toLowerCase().indexOf('error') >= 0) {
        errors.push(content.substring(0, 80));
      }
    }

    var parts = [];
    if (userMsgs.length) {
      parts.push('User: ' + userMsgs.slice(-3).join('; '));
    }
    if (toolCalls.size) {
      var sorted = Array.from(toolCalls).sort().slice(0, 8);
      parts.push('Tools: ' + sorted.join(', '));
    }
    if (errors.length) {
      parts.push('Errors: ' + errors.slice(-2).join('; '));
    }

    var nTurns = messages.filter(function(m) { return m.role === 'user'; }).length;
    return parts.length
      ? '[' + nTurns + ' turns] ' + parts.join(' | ')
      : nTurns + ' prior turns.';
  },
};


// ── ContextManager (翻译自 Python context/manager.py) ──────────

function ContextManager(systemPrompt, history) {
  this.messages = [];
  this.maxTokens = 128000;    // Modern models: DeepSeek V4 128K, Qwen 3 128K+ (Python: 128000)
  this._summary = '';
  this._summarizedCount = 0;

  // Init: add system prompt as first message (Python line 245-257)
  if (systemPrompt) {
    this.messages.push({ role: 'system', content: systemPrompt });
  }
  // Load history
  if (history && history.length) {
    for (var i = 0; i < history.length; i++) {
      this.messages.push(history[i]);
    }
  }
}

// Add message (Python line 28-48)
ContextManager.prototype.addMessage = function(message) {
  // Strip thinking blocks — they're huge and only useful for the current turn.
  // Never persist them into context (causes unbounded context growth).
  if (message.role === 'assistant' && Array.isArray(message.content)) {
    var textBlocks = message.content.filter(function(b) { return !b || b.type !== 'thinking'; });
    message = Object.assign({}, message, { content: textBlocks.length > 0 ? textBlocks : '' });
  }
  this.messages.push(message);
};

// Get current messages. If summary exists, prepend it (Python line 50-85)
ContextManager.prototype.getMessages = function() {
  var result = [];
  if (this._summary) {
    result.push({
      role: 'system',
      content: '[Previous conversation summary]\n' + this._summary,
    });
  }

  for (var i = 0; i < this.messages.length; i++) {
    result.push(this.messages[i]);
  }
  return result;
};

// Rough token estimation (Python line 87-110)
// CJK ~1 char/token, ASCII ~4 chars/token (= ascii/3)
ContextManager.prototype.estimateTokens = function() {
  var total = 0;
  for (var i = 0; i < this.messages.length; i++) {
    var m = this.messages[i];
    var contentRaw = m.content || '';
    var content;
    if (Array.isArray(contentRaw)) {
      // Filter out thinking blocks for token count (Python: they're in _thinking)
      content = String(contentRaw.filter(function(b) {
        return !(typeof b === 'object' && b !== null && b.type === 'thinking');
      }));
    } else {
      content = String(contentRaw);
    }
    // Count CJK characters (higher token density) vs ASCII
    var cjk = 0;
    for (var ci = 0; ci < content.length; ci++) {
      var ch = content.charCodeAt(ci);
      if ((ch >= 0x4E00 && ch <= 0x9FFF) || (ch >= 0x3000 && ch <= 0x303F)) {
        cjk++;
      }
    }
    var asciiChars = content.length - cjk;
    total += cjk + Math.floor(asciiChars / 3);
    // Count tool_calls arguments — can be large JSON objects
    if (m.tool_calls) {
      for (var ti = 0; ti < m.tool_calls.length; ti++) {
        var args = (m.tool_calls[ti].function || {}).arguments || '';
        total += Math.floor(args.length / 3);
      }
    }
  }
  if (this._summary) {
    total += Math.floor(this._summary.length / 3);
  }
  return total;
};

// Check if compression is needed (Python line 112-114)
ContextManager.prototype.shouldCompress = function() {
  return this.estimateTokens() > this.maxTokens * COMPRESSION_THRESHOLD;
};

// Compress old messages if token limit is approaching (Python line 116-212)
// config, format: for LLM compression call
// force: true when called from error handler (context too long)
// onChunk: optional, for streaming progress messages
ContextManager.prototype.maybeCompress = async function(config, format, tools, onChunk, force) {
  if (!force && !this.shouldCompress()) return false;

  var nonSystem = this.messages.filter(function(m) { return m.role !== 'system'; });
  // Always preserve the last 8 messages — they carry the freshest context
  var KEEP_LAST = 8;
  var keepCount = force ? KEEP_LAST : KEEP_RECENT_TURNS;

  if (nonSystem.length <= keepCount + 2) {
    if (!force) return false;
    keepCount = Math.max(0, nonSystem.length - 4);
  }

  var toCompress = keepCount > 0 ? nonSystem.slice(0, -keepCount) : nonSystem;
  var toKeep = keepCount > 0 ? nonSystem.slice(-keepCount) : [];

  // ── Protect tool_use/tool_result pairs from being split across the
  // compression boundary (Python line 137-179) ──

  // Case 1: front-boundary protection
  // If toKeep starts with a tool_result → pull back its preceding assistant
  while (toKeep.length > 0 && toKeep[0].role === 'tool' && toCompress.length > 0) {
    toKeep.unshift(toCompress.pop());
  }

  // Case 2: build a set of tool_call_ids still present in toCompress,
  // then scan toKeep for tool_results that reference them.
  if (toCompress.length > 0) {
    var toolUseIdsInCompress = new Set();
    for (var i = 0; i < toCompress.length; i++) {
      var m = toCompress[i];
      if (m.role === 'assistant' && m.tool_calls) {
        for (var j = 0; j < m.tool_calls.length; j++) {
          toolUseIdsInCompress.add(m.tool_calls[j].id);
        }
      }
    }

    if (toolUseIdsInCompress.size > 0) {
      // Find all tool_call_ids referenced by tool_results in toKeep
      var referencedIds = new Set();
      for (var k = 0; k < toKeep.length; k++) {
        if (toKeep[k].role === 'tool' && toKeep[k].tool_call_id) {
          referencedIds.add(toKeep[k].tool_call_id);
        }
      }

      var orphanIds = new Set();
      referencedIds.forEach(function(id) {
        if (toolUseIdsInCompress.has(id)) orphanIds.add(id);
      });

      if (orphanIds.size > 0) {
        // Find the last assistant message in toCompress that holds any orphaned tool_use
        var lastOrphanIdx = -1;
        for (var idx = 0; idx < toCompress.length; idx++) {
          var mm = toCompress[idx];
          if (mm.role === 'assistant' && mm.tool_calls) {
            for (var ti = 0; ti < mm.tool_calls.length; ti++) {
              if (orphanIds.has(mm.tool_calls[ti].id)) {
                lastOrphanIdx = idx;
              }
            }
          }
        }

        if (lastOrphanIdx >= 0) {
          toKeep = toCompress.slice(lastOrphanIdx).concat(toKeep);
          toCompress = toCompress.slice(0, lastOrphanIdx);
        }
      }
    }
  }

  var systemMsgs = this.messages.filter(function(m) { return m.role === 'system'; });

  // Try LLM compression, fallback to rule-based
  var newSummary;
  try {
    newSummary = await ContextCompressor.compress(toCompress, config, format);
  } catch (e) {
    newSummary = ContextCompressor.fallbackCompress(toCompress);
  }

  if (this._summary) {
    // Cap old summary before appending (Python line 190-196)
    var old = this._summary;
    if (old.length > MAX_SUMMARY_CHARS) {
      old = old.substring(old.length - (MAX_SUMMARY_CHARS - 500));
      old = '[... older context truncated ...]\n' + old;
    }
    this._summary = old + '\n' + newSummary;
  } else {
    this._summary = newSummary;
  }

  // Hard cap: if summary exceeds limit after append, trim the front (Python line 199-201)
  if (this._summary.length > MAX_SUMMARY_CHARS * 2) {
    this._summary = '[... older context truncated ...]\n' +
      this._summary.substring(this._summary.length - (MAX_SUMMARY_CHARS * 2 - 50));
  }

  this._summarizedCount += toCompress.length;
  this.messages = systemMsgs.concat(toKeep);

  // If forced, token estimate was wrong — reduce max_tokens to match reality (Python line 207-210)
  if (force) {
    var currentEst = this.estimateTokens();
    if (currentEst > 0) {
      this.maxTokens = Math.max(currentEst + 4096, 16000);
    }
  }

  return true;
};
