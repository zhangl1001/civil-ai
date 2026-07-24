// ===== AI Engine — LLM API 调用 + Function Calling 循环 =====
// 通过原生 SSE Plugin 发送请求，支持 OpenAI/Claude 双格式
// 实现多轮工具调用循环

const AEngine = (() => {
  // ── 错误分类函数 (翻译自 Python engine.py line 48-95) ──────────

  function _isContextLengthError(errMsg) {
    var msg = String(errMsg).toLowerCase();
    return ['context_length_exceeded', 'context length', 'too long',
      'maximum context', 'max_tokens', 'reduce the length',
      'exceeds token', 'token limit', 'too many tokens',
      'token budget', 'token count'
    ].some(function(kw) { return msg.indexOf(kw) >= 0; });
  }

  function _isTransientError(errMsg) {
    var msg = String(errMsg).toLowerCase();
    return ['rate limit', 'rate_limit', 'too many requests', '429',
      'timeout', 'timed out', 'connection reset', 'connection error',
      'server error', '503', '502', 'internal server',
      'overloaded', 'capacity', 'service unavailable', 'bad gateway',
      'try again', 'retry'
    ].some(function(kw) { return msg.indexOf(kw) >= 0; });
  }

  function _isRateLimitError(errMsg) {
    var msg = String(errMsg).toLowerCase();
    return ['rate limit', 'rate_limit', 'too many requests', '429',
      'quota', 'requests per minute', 'tokens per minute', 'retry-after'
    ].some(function(kw) { return msg.indexOf(kw) >= 0; });
  }

  function _retryAfterMs(errMsg) {
    var msg = String(errMsg || '');
    var match = msg.match(/retry-after[=:]\s*(\d+)/i);
    if (!match) match = msg.match(/retry after\s*(\d+)/i);
    return match ? Math.max(1000, parseInt(match[1], 10) * 1000) : 0;
  }

  function _isAuthError(errMsg) {
    var msg = String(errMsg).toLowerCase();
    return ['401', '403', 'invalid_api_key', 'invalid api key',
      'invalid access token', 'token expired', 'unauthorized',
      'authentication', 'forbidden', 'permission'
    ].some(function(kw) { return msg.indexOf(kw) >= 0; });
  }

  function _isBadRequest(errMsg) {
    var msg = String(errMsg).toLowerCase();
    return ['400', 'bad_request', 'invalid_request_error',
      'tool_use', 'tool_result'
    ].some(function(kw) { return msg.indexOf(kw) >= 0; });
  }

  // ── 紧急截断保护 tool_use/tool_result 配对 (Python line 410-442) ──
  function _safeTail(msgs, keep) {
    var tail = msgs.slice(-keep);
    // Collect all tool_call_ids in tail's assistant messages
    var toolIdsInTail = new Set();
    tail.forEach(function(m) {
      if (m.role === 'assistant' && m.tool_calls) {
        m.tool_calls.forEach(function(tc) { toolIdsInTail.add(tc.id); });
      }
    });
    // Check if any tool_result in tail references a tool_call NOT in tail
    var orphaned = false;
    for (var i = 0; i < tail.length; i++) {
      if (tail[i].role === 'tool' && tail[i].tool_call_id) {
        if (!toolIdsInTail.has(tail[i].tool_call_id)) { orphaned = true; break; }
      }
    }
    if (!orphaned) return tail;
    // Walk back to find the assistant that holds the orphaned tool_use
    var startIdx = msgs.length - keep;
    for (var idx = startIdx - 1; idx >= 0; idx--) {
      var m = msgs[idx];
      if (m.role === 'assistant' && m.tool_calls) {
        for (var ti = 0; ti < m.tool_calls.length; ti++) {
          var tcId = m.tool_calls[ti].id;
          for (var tj = 0; tj < tail.length; tj++) {
            if (tail[tj].role === 'tool' && tail[tj].tool_call_id === tcId) {
              return msgs.slice(idx);
            }
          }
        }
      }
    }
    return tail; // fallback
  }

  // ── 常量 (翻译自 Python engine.py) ──────────────────────────
  var MAX_TURNS = 100;
  var MAX_TOOL_CALLS_PER_TURN = 20;
  var TOOL_TIMEOUT = 120000;       // Per-tool timeout (2 min); most tools <1s (Python: 120s)
  var LLM_MAX_RETRIES = 3;        // Max LLM retry attempts per turn (Python: 3)
  var RETRY_BACKOFF_WAIT = 1000;  // ms between truncated turn retries (Python: 1s)
  var EMERGENCY_TAIL_TURNS = 4;   // Messages to keep during emergency truncation (Python: 4)

  // ── _addToolResult: 翻译自 Python engine.py _add_tool_result ──
  // Truncate large outputs to prevent context bloat.
  // Skip duplicate results: same tool + same args + same result → don't add again.
  var _TOOL_RESULT_LIMITS = {
    'read_file': 12000,
    'analyze_code': 8000,
    'parse_openapi': 8000,
  };
  var _DEFAULT_RESULT_LIMIT = 3000;
  var _MAX_RESULT_CACHE = 50;
  var _lastToolSig = new Set();
  var _lastToolResult = {};

  function _addToolResult(messages, tcId, toolName, result, args) {
    // Force result to string (Python line 786: str(result) if result is not None else "done")
    if (result === null || result === undefined) result = 'done';
    if (typeof result !== 'string') result = String(result);

    // Dedup: skip if same tool + same args + same result as last time (Python line 867-869)
    // Use sort_keys=True equivalent to match Python (Python line 867)
    var sig = toolName + ':' + JSON.stringify(args || {}, Object.keys(args || {}).sort());
    if (_lastToolSig.has(sig) && _lastToolResult[sig] === result) {
      return; // duplicate — skip adding to context
    }
    _lastToolSig.delete(sig);  // Python line 870: remove old position

    var maxChars = _TOOL_RESULT_LIMITS[toolName] || _DEFAULT_RESULT_LIMIT;
    // Never truncate image data — base64 must stay intact for vision models (Python line 874)
    if (result.indexOf('[image:') < 0 && result.length > maxChars) {
      var head = result.substring(0, Math.floor(maxChars * 2 / 3));
      var tail = result.substring(result.length - Math.floor(maxChars / 3));
      result = head + '\n...(' + result.length + ' total chars)...\n' + tail;
    }
    messages.push({ role: 'tool', tool_call_id: tcId, content: result });
    _lastToolSig = new Set([sig]);  // Python line 884: only track most recent
    _lastToolResult[sig] = result;
    // Evict oldest entries to prevent unbounded memory growth (Python line 886-889)
    var keys = Object.keys(_lastToolResult);
    while (keys.length > _MAX_RESULT_CACHE) {
      delete _lastToolResult[keys.shift()];
    }
  }

  // ── _contextArgs: 翻译自 Python engine.py _context_args ──
  // Strip inline heredoc data from context — the data is already on disk.
  function _contextArgs(args) {
    if (!args || typeof args !== 'object') return args;
    var result = {};
    for (var k in args) {
      if (!args.hasOwnProperty(k)) continue;
      var v = args[k];
      if (typeof v === 'string') {
        var heredoc = v.indexOf('<<');
        if (heredoc >= 0) {
          v = v.substring(0, heredoc).trim() + '  # (heredoc body stripped, content written to file)';
        }
      }
      result[k] = v;
    }
    return result;
  }

  // ── _fixOrphanedToolUses: 翻译自 Python engine.py _fix_orphaned_tool_uses ──
  // Remove ALL orphaned tool messages in both directions.
  // Case A: assistant has tool_calls but no matching tool_results → remove assistant
  // Case B: tool_result has no matching tool_use → remove tool_result
  function _fixOrphanedToolUses(messages) {
    var fixed = false;

    // ── Case A: orphaned tool_uses (assistant without results) ──
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = messages.length - 1; i >= 0; i--) {
        var m = messages[i];
        if (m.role !== 'assistant' || !m.tool_calls) continue;
        var tcIds = new Set(m.tool_calls.map(function(tc) { return tc.id; }));
        var foundIds = new Set();
        for (var j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool') {
            var tid = messages[j].tool_call_id || '';
            if (tcIds.has(tid)) foundIds.add(tid);
          } else {
            break;
          }
        }
        if (foundIds.size !== tcIds.size) {
          messages.splice(i, 1);
          fixed = true;
          changed = true;
        }
      }
    }

    // ── Case B: orphaned tool_results (result without tool_use) ──
    // Build set of all tool_call IDs from assistant messages
    var allTcIds = new Set();
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'assistant' && m.tool_calls) {
        m.tool_calls.forEach(function(tc) { allTcIds.add(tc.id); });
      }
    }
    // Remove any tool message whose tool_call_id is not in the set
    // (if allTcIds is empty, ALL tool messages are orphans)
    changed = true;
    while (changed) {
      changed = false;
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'tool') {
          var tid = messages[i].tool_call_id || '';
          if (!allTcIds.has(tid)) {
            messages.splice(i, 1);
            fixed = true;
            changed = true;
          }
        }
      }
    }

    return fixed;
  }

  // ── _toolSig: 翻译自 Python _tool_sig ──
  // Compact signature: tool name + first 80 chars of args. Used to detect repeat calls.
  function _toolSig(tc) {
    var argsStr = JSON.stringify(tc.arguments || {}, Object.keys(tc.arguments || {}).sort());
    return tc.name + ':' + argsStr.substring(0, 80);
  }

  // ── 配置读取 ──────────────────────────────────────────────
  function getConfig() {
    if (window.API && API.SecureConfig) return API.SecureConfig.current();
    try {
      return JSON.parse(localStorage.getItem('zhangl-ai-config') || '{}');
    } catch (e) { return {}; }
  }

  function detectFormat(config) {
    if (config.provider === 'anthropic') return 'anthropic';
    const base = (config.api_base || '').toLowerCase();
    if (base.includes('anthropic.com') || base.includes('claude')) return 'anthropic';
    return 'openai'; // Default: OpenAI compatible (DeepSeek, 通义千问, Kimi, 智谱 etc.)
  }

  // ── OpenAI 格式消息构建 ────────────────────────────────────
  // Translation of Python openai_provider.py: _strip_thinking + direct pass-through
  function buildOpenAIMessages(systemPrompt, history) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    (history || []).forEach(m => {
      // Strip thinking blocks from assistant messages (Python: _strip_thinking)
      // OpenAI-style APIs don't support thinking blocks in content
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        var textBlocks = m.content.filter(function(b) {
          return !b || b.type !== 'thinking';
        });
        if (textBlocks.length === 0) return; // skip message with only thinking
        messages.push(Object.assign({}, m, { content: textBlocks }));
        return;
      }
      if (m.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
      } else if (m.role === 'assistant' && m.tool_calls) {
        messages.push({ role: 'assistant', tool_calls: m.tool_calls, content: m.content || null });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    });
    return messages;
  }

  // ── Anthropic 格式消息构建 ──────────────────────────────────
  // 1:1 translation of Python anthropic_provider.py chat() lines 60-88
  // Key: merge consecutive tool messages into one user message (Anthropic requirement)
  function buildAnthropicMessages(systemPrompt, history) {
    var chatMessages = [];
    var i = 0;
    while (i < (history || []).length) {
      var m = history[i];

      // Merge consecutive tool messages into one user message.
      // Anthropic protocol requires all tool_results after an assistant
      // message with multiple tool_use blocks to be in a single message.
      if (m.role === 'tool') {
        var toolBlocks = [];
        while (i < history.length && history[i].role === 'tool') {
          var tm = history[i];
          toolBlocks.push({
            type: 'tool_result',
            tool_use_id: tm.tool_call_id || 'call_unknown',
            content: String(tm.content || ''),
          });
          i++;
        }
        chatMessages.push({ role: 'user', content: toolBlocks });
        continue;
      }

      // Convert other message types
      if (m.role === 'assistant' && m.tool_calls) {
        var contentBlocks = [];
        if (m.content) contentBlocks.push({ type: 'text', text: String(m.content) });
        m.tool_calls.forEach(function(tc) {
          var input = {};
          try { input = JSON.parse(tc.function.arguments); } catch (e) {}
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id || '',
            name: (tc.function && tc.function.name) || '',
            input: (typeof input === 'object' && input !== null) ? input : {},
          });
        });
        chatMessages.push({ role: 'assistant', content: contentBlocks });
      } else if (m.role === 'assistant') {
        chatMessages.push({
          role: 'assistant',
          content: [{ type: 'text', text: String(m.content || '') }],
        });
      } else if (m.role === 'user') {
        chatMessages.push({
          role: 'user',
          content: [{ type: 'text', text: String(m.content || '') }],
        });
      }
      // Skip system messages (handled separately via systemPrompt param)

      i++;
    }

    // Validate: every tool_use must have a matching tool_result
    // (safety net in case _fixOrphanedToolUses missed something)
    var toolUseIds = new Set();
    var toolResultIds = new Set();
    for (var j = 0; j < chatMessages.length; j++) {
      var msg = chatMessages[j];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        msg.content.forEach(function(b) {
          if (b.type === 'tool_use' && b.id) toolUseIds.add(b.id);
        });
      }
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        msg.content.forEach(function(b) {
          if (b.type === 'tool_result' && b.tool_use_id) toolResultIds.add(b.tool_use_id);
        });
      }
    }
    if (toolUseIds.size > 0) {
      var orphanIds = new Set();
      toolUseIds.forEach(function(id) {
        if (!toolResultIds.has(id)) orphanIds.add(id);
      });
      if (orphanIds.size > 0) {
        console.log('[AEngine] buildAnthropicMessages: removing ' + orphanIds.size + ' orphaned tool_use blocks');
        for (var j = 0; j < chatMessages.length; j++) {
          var msg = chatMessages[j];
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            msg.content = msg.content.filter(function(b) {
              return b.type !== 'tool_use' || !orphanIds.has(b.id);
            });
            if (msg.content.length === 0) {
              msg.content = [{ type: 'text', text: '(tool call removed)' }];
            }
          }
        }
      }
    }

    // Ensure first message is user role (Anthropic requirement)
    if (chatMessages.length > 0 && chatMessages[0].role !== 'user') {
      chatMessages.unshift({ role: 'user', content: [{ type: 'text', text: '(start)' }] });
    }

    return chatMessages;
  }

  // ── OpenAI tools → Anthropic tools 转换 ──────────────────
  function convertToolsToAnthropic(openaiTools) {
    return (openaiTools || []).map(t => {
      const func = t.function;
      return {
        name: func.name,
        description: func.description,
        input_schema: func.parameters,
      };
    });
  }

  // ── API URL 规范化 ───────────────────────────────────────
  function _apiUrl(config, path) {
    var base = (config.api_base || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return base + '/' + path.replace(/^\/+/, '');
  }

  // ── Ensure arguments is a JSON string (type guard for CapacitorHttp auto-parsing) ──
  function _ensureArgsString(args) {
    if (typeof args === 'string') return args;
    try { return JSON.stringify(args || {}); } catch (e) { return '{}'; }
  }

  // ── OpenAI 格式 API 调用 (非流式 + 流式降级) ────────────
  async function callOpenAI(config, messages, tools, stream, onChunk, onDone, onError, signal) {
    const url = _apiUrl(config, 'chat/completions');
    const body = {
      model: config.model || 'gpt-4o',
      messages,
      stream: !!stream,
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Authorization': 'Bearer ' + (config.api_key || ''),
      'Content-Type': 'application/json',
    };

    // Prefer fetch SSE streaming for real-time output (if stream requested).
    // CapacitorHttp does NOT support SSE, so it's only a non-stream fallback.
    if (stream) {
      try {
        const result = await _streamOpenAI(url, headers, body, onChunk, signal);
        onDone(result);
        return;
      } catch (e) {
        console.warn('[AEngine] fetch streaming failed, falling back to non-stream:', e.message);
        // fall through to non-stream path
      }
    }

    // Non-streaming path: CapacitorHttp (bypasses CORS) preferred, else fetch
    const nonStreamBody = { ...body, stream: false };
    if (typeof CapacitorHttp !== 'undefined') {
      try {
        const opts = {
          url, method: 'POST', headers,
          data: nonStreamBody,
          connectTimeout: 30000,
          readTimeout: 120000,
        };
        const resp = await CapacitorHttp.request(opts);
        console.log('[AEngine] CapacitorHttp status=' + resp.status + ' data type=' + typeof resp.data);
        if (resp.status >= 200 && resp.status < 300) {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
          const choice = (data.choices || [])[0] || {};
          console.log('[AEngine] CapacitorHttp choice: finish_reason=' + choice.finish_reason + ' has_tool_calls=' + !!(choice.message && choice.message.tool_calls && choice.message.tool_calls.length) + ' content_len=' + ((choice.message && choice.message.content) || '').length);
          const content = choice.message?.content || '';
          // CapacitorHttp may auto-parse JSON strings in arguments back to objects.
          // OpenAI API requires arguments to be a JSON STRING, not an object.
          // Force it back to string to match Python: json.dumps(self._context_args(tc), ensure_ascii=False)
          const toolCalls = choice.message?.tool_calls || [];
          if (content && onChunk) onChunk({ type: 'text', content });
          onDone({
            content,
            finish_reason: choice.finish_reason || 'stop',
            tool_calls: toolCalls.map(tc => ({
              id: tc.id, type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: _ensureArgsString(tc.function?.arguments),
              },
            })),
          });
          return;
        }
        throw new Error('HTTP ' + resp.status + ': ' + JSON.stringify(resp.data).substring(0, 200));
      } catch (e) {
        // Fall back to regular fetch
        console.warn('[AEngine] CapacitorHttp failed, falling back to fetch:', e.message);
      }
    }

    // Final fallback: regular fetch (non-stream)
    try {
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(nonStreamBody), signal });
      if (!resp.ok) {
        const retryAfter = resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '';
        const text = await resp.text();
        throw new Error('HTTP ' + resp.status + (retryAfter ? ' retry-after=' + retryAfter : '') + ': ' + text.substring(0, 200));
      }
      const data = await resp.json();
      const choice = (data.choices || [])[0] || {};
      const content = choice.message?.content || '';
      if (content && onChunk) onChunk({ type: 'text', content });
      onDone({
        content,
        finish_reason: choice.finish_reason || 'stop',
        tool_calls: (choice.message?.tool_calls || []).map(tc => ({
          id: tc.id, type: 'function',
          function: { name: tc.function?.name || '', arguments: _ensureArgsString(tc.function?.arguments) },
        })),
      });
    } catch (e) { onError(e); }
  }

  // ── OpenAI SSE streaming with regular fetch ─────────────
  function _streamOpenAI(url, headers, body, onChunk, signal) {
    let fullContent = '';
    let toolCalls = {};
    let finishReason = '';

    return _fetchSSE(url, { method: 'POST', headers, body: JSON.stringify(body) }, (line) => {
      if (!line || !line.startsWith('data: ')) return;
      const json = line.slice(6);
      if (json === '[DONE]') return;
      try {
        const payload = JSON.parse(json);
        if (payload.choices && payload.choices[0]) {
          const delta = payload.choices[0].delta || {};
          if (delta.content) {
            fullContent += delta.content;
            if (onChunk) onChunk({ type: 'text', content: delta.content });
          }
          if (delta.tool_calls) {
            delta.tool_calls.forEach(tc => {
              const idx = tc.index;
              if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || '', function: { name: '', arguments: '' } };
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function) {
                if (tc.function.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            });
          }
          if (payload.choices[0].finish_reason) finishReason = payload.choices[0].finish_reason;
        }
      } catch (e) { /* skip malformed JSON */ }
    }, signal).then(() => ({
      content: fullContent,
      finish_reason: finishReason,
      tool_calls: Object.values(toolCalls).filter(tc => tc.id),
    }));
  }

  // ── Anthropic 格式 API 调用 ──────────────────────────────
  async function callAnthropic(config, systemPrompt, messages, tools, stream, onChunk, onDone, onError, signal) {
    const url = _apiUrl(config, 'messages');
    const anthropicTools = tools ? convertToolsToAnthropic(tools) : undefined;
    // Dynamic max_tokens: large models (opus/sonnet) → 8192, smaller models → 4096
    // User can override via config.max_tokens
    var maxTokens = config.max_tokens || 8192;
    var modelStr = (config.model || '').toLowerCase();
    if (!config.max_tokens) {
      if (modelStr.includes('haiku') || modelStr.includes('flash') || modelStr.includes('mini')) {
        maxTokens = 4096;
      }
    }
    const body = {
      model: config.model || 'claude-opus-4-8',
      max_tokens: maxTokens,
      messages,
    };
    if (systemPrompt) body.system = systemPrompt;
    if (anthropicTools && anthropicTools.length) body.tools = anthropicTools;

    const headers = {
      'x-api-key': config.api_key || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };

    // Try CapacitorHttp first (bypasses CORS in Capacitor app)
    if (typeof CapacitorHttp !== 'undefined') {
      try {
        const opts = { url, method: 'POST', headers,
          data: { ...body, stream: false },
          connectTimeout: 30000, readTimeout: 120000,
        };
        const resp = await CapacitorHttp.request(opts);
        if (resp.status >= 200 && resp.status < 300) {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
          const textBlocks = (data.content || []).filter(b => b.type === 'text');
          const content = textBlocks.map(b => b.text).join('');
          const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
          if (content && onChunk) onChunk({ type: 'text', content });
          onDone({
            content,
            finish_reason: toolUses.length > 0 ? 'tool_calls' : 'stop',
            tool_calls: toolUses.map(tu => ({
              id: tu.id, type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            })),
          });
          return;
        }
        throw new Error('HTTP ' + resp.status + ': ' + JSON.stringify(resp.data).substring(0, 200));
      } catch (e) {
        console.warn('[AEngine] CapacitorHttp failed, falling back to fetch:', e.message);
      }
    }

    // Fallback: regular fetch with SSE streaming
    if (stream) {
      try {
        const result = await _streamAnthropic(url, headers, body, onChunk, signal);
        onDone(result);
      } catch (e) { onError(e); }
    } else {
      try {
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: false }), signal });
        if (!resp.ok) {
          const retryAfter = resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '';
          const text = await resp.text();
          throw new Error('HTTP ' + resp.status + (retryAfter ? ' retry-after=' + retryAfter : '') + ': ' + text.substring(0, 200));
        }
        const data = await resp.json();
        const textBlocks = (data.content || []).filter(b => b.type === 'text');
        const content = textBlocks.map(b => b.text).join('');
        if (content && onChunk) onChunk({ type: 'text', content });
        const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
        onDone({
          content,
          finish_reason: toolUses.length > 0 ? 'tool_calls' : 'stop',
          tool_calls: toolUses.map(tu => ({
            id: tu.id, type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          })),
        });
      } catch (e) { onError(e); }
    }
  }

  // ── Anthropic SSE streaming ──────────────────────────────
  function _streamAnthropic(url, headers, body, onChunk, signal) {
    let fullContent = '';
    let toolUseBlocks = {};
    let currentBlockType = '';
    let currentBlockIndex = -1;

    return _fetchSSE(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) }, (line) => {
      if (!line || !line.startsWith('data: ')) return;
      const json = line.slice(6);
      try {
        const event = JSON.parse(json);
        switch (event.type) {
          case 'content_block_start':
            currentBlockType = event.content_block?.type || '';
            currentBlockIndex = event.index;
            if (currentBlockType === 'tool_use' && event.content_block) {
              toolUseBlocks[currentBlockIndex] = {
                id: event.content_block.id,
                name: event.content_block.name,
                input_json: '',
              };
            }
            break;
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta') {
              fullContent += delta.text;
              if (onChunk) onChunk({ type: 'text', content: delta.text });
            } else if (delta?.type === 'input_json_delta') {
              if (toolUseBlocks[currentBlockIndex]) {
                toolUseBlocks[currentBlockIndex].input_json += delta.partial_json;
              }
            }
            break;
          }
        }
      } catch (e) { /* skip */ }
    }, signal).then(() => ({
      content: fullContent,
      finish_reason: Object.keys(toolUseBlocks).length > 0 ? 'tool_calls' : 'stop',
      tool_calls: Object.values(toolUseBlocks).map(tb => ({
        id: tb.id, type: 'function',
        function: { name: tb.name, arguments: tb.input_json },
      })),
    }));
  }

  // ── fetch SSE 辅助 (非 Capacitor 环境降级) ─────────────
  async function _fetchSSE(url, options, onLine, signal) {
    if (signal) options.signal = signal;
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const retryAfter = resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '';
      const text = await resp.text();
      throw new Error('HTTP ' + resp.status + (retryAfter ? ' retry-after=' + retryAfter : '') + ': ' + text.substring(0, 200));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
    if (buf.trim()) onLine(buf);
  }

  // ── 核心：多轮循环 (翻译自 agent/engine.py AgentEngine.run) ──
  async function runLoop(systemPrompt, userMessage, history, onChunk, opts) {
    const config = getConfig();
    if (!config.api_key) throw new Error('请先配置 AI API Key');
    if (!config.api_base) throw new Error('请先配置 API 地址');

    const format = detectFormat(config);
    const tools = (opts && opts.tools) || Tools.TOOL_DEFINITIONS;
    const signal = (opts && opts.signal) || null;
    console.log('[AEngine] runLoop: format=' + format + ' tools=' + tools.length + ' model=' + (config.model||'default') + ' api_base=' + (config.api_base||''));

    // Reset expert and task state for foreground sessions. Background workers can
    // run in parallel, so they must not reset the shared expert/task registries.
    if (!(opts && opts.skipToolReset)) {
      Tools._resetExperts();
      Tools.resetTasks();
    }

    // ── ContextManager: manages messages + compression ──
    var ctx = new ContextManager(systemPrompt, history || []);
    ctx.addMessage({ role: 'user', content: userMessage });

    let aborted = false;
    if (signal) signal.addEventListener('abort', () => { aborted = true; });

    // ── DEBUG ──
    var dbg = [];
    dbg.push('fmt=' + format + ' hist=' + (history || []).length + ' tools=' + tools.length);

    let productiveTurns = 0;
    let recentSigs = new Set();
    var consecutiveLlmFailures = 0;
    var notifiedExperts = new Set();  // Track expert IDs already notified
    var waitingYielded = false;       // Whether we've shown "专家工作中..." message

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (aborted) break;

      // ── Collect completed background expert results (Python line 311-339) ──
      var collected = Tools._collectBackgroundResults();
      for (var ci = 0; ci < collected.length; ci++) {
        var bg = collected[ci];
        var eid = bg.id || '';
        if (notifiedExperts.has(eid)) continue;
        notifiedExperts.add(eid);
        var bgOk = bg.success;
        var bgStatus = bgOk ? '成功' : '失败';
        var bgResult = bg.result || '';
        ctx.addMessage({
          role: 'user',
          content: '[后台任务 ' + eid + ' ' + bgStatus + ']\n\n' + bgResult,
        });
        if (bgOk) {
          if (onChunk) onChunk({ type: 'text', content: '\n> 子任务完成\n' });
        } else {
          if (onChunk) onChunk({ type: 'text', content: '\n> ⚠️ 子任务执行失败，请重试\n' });
        }
      }

      // ── Safety net: approaching turn limit (Python line 291-293) ──
      if (productiveTurns === MAX_TURNS - 10) {
        ctx.addMessage({
          role: 'user',
          content: '\n\n[注意：已接近步骤上限，请在当前回合内完成任务或简化方案，不要重复之前失败的操作。]'
        });
      }

      try {
        // ── Proactive compression before each turn (Python line 342) ──
        await ctx.maybeCompress(config, format, tools, onChunk);

        // ── Fix orphaned tool messages BEFORE each LLM call (Python line 347) ──
        _fixOrphanedToolUses(ctx.messages);

        var messages = ctx.getMessages();

        let textBuffer = '';
        let toolCallsAcc = [];

        // ── LLM call with retry (Python line 362-523) ──
        var llmOk = false;
        var lastErr = '';

        for (var llmAttempt = 0; llmAttempt <= LLM_MAX_RETRIES; llmAttempt++) {
          try {
            // Rebuild messages from context for each attempt (compression may change them)
            // ContextManager may prepend a summary system message; extract it for Anthropic
            var ctxMsgs = ctx.getMessages();
            // For Anthropic: extract system messages into a combined systemPrompt
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
            var openaiMsgs = buildOpenAIMessages(null, nonSystemMsgs);
            // Prepend system messages to OpenAI messages (buildOpenAIMessages with null won't add system)
            if (combinedSystem) {
              openaiMsgs.unshift({ role: 'system', content: combinedSystem });
            }
            var anthropicMsgs = buildAnthropicMessages(null, nonSystemMsgs);

            // DEBUG: show exact message structure
            var apiMsgs = format === 'anthropic' ? anthropicMsgs : openaiMsgs;
            var msgRoles = apiMsgs.map(function(m){ return m.role; }).join(',');
            dbg.push('T' + turn + 'A' + llmAttempt + ' [' + msgRoles + ']');

            await new Promise((resolve, reject) => {
              const handler = {
                onChunk: (chunk) => {
                  if (chunk.type === 'text') {
                    textBuffer += chunk.content;
                    if (onChunk) onChunk(chunk);
                  }
                },
                onDone: (res) => {
                  textBuffer = res.content || textBuffer;
                  toolCallsAcc = (res.tool_calls || []).filter(tc => tc.id);
                  console.log('[AEngine] T' + turn + ' onDone: content=' + (textBuffer||'').substring(0,60) + ' tool_calls=' + toolCallsAcc.length + ' finish_reason=' + res.finish_reason);
                  if (toolCallsAcc.length > 0) {
                    console.log('[AEngine] tool_calls:', toolCallsAcc.map(function(tc) { return tc.function.name + '(' + (tc.function.arguments||'').substring(0,50) + ')'; }).join(', '));
                  }
                  resolve();
                },
                onError: reject,
              };

              if (format === 'anthropic') {
                callAnthropic(config, combinedSystem, anthropicMsgs, tools, true,
                  handler.onChunk, handler.onDone, handler.onError, signal);
              } else {
                callOpenAI(config, openaiMsgs, tools, true,
                  handler.onChunk, handler.onDone, handler.onError, signal);
              }
            });

            llmOk = true;
            break; // success — exit retry loop

          } catch (e) {
            // If user manually aborted, re-throw immediately — don't classify as transient/auth/etc.
            if (aborted || (e && e.name === 'AbortError')) {
              throw e;
            }
            lastErr = (e && e.message) ? e.message : String(e);
            dbg.push('T' + turn + 'A' + llmAttempt + ' ERR=' + lastErr.substring(0, 80));

            // ── Context length error: compress → emergency truncate → ultra truncate → fatal ──
            if (_isContextLengthError(lastErr)) {
              if (onChunk) onChunk({ type: 'text', content: '\n\n> 上下文过长，正在自动压缩...\n\n' });
              var compressed = await ctx.maybeCompress(config, format, tools, onChunk, true /* force */);
              if (compressed) {
                messages = ctx.getMessages();
                if (onChunk) onChunk({ type: 'text', content: '[压缩完成，正在重试...]\n' });
                continue;
              }

              // Compression didn't help — emergency hard truncation (Python line 405-452)
              var sysMsgs = ctx.messages.filter(function(m) { return m.role === 'system'; });
              var nonSys = ctx.messages.filter(function(m) { return m.role !== 'system'; });

              if (nonSys.length > EMERGENCY_TAIL_TURNS) {
                var safeTailMsgs = _safeTail(nonSys, EMERGENCY_TAIL_TURNS);
                ctx.messages = sysMsgs.concat(safeTailMsgs);
                ctx._summary = '';
                messages = ctx.getMessages();
                if (onChunk) onChunk({ type: 'text', content: '[截断旧消息，1s 后重试...]\n' });
                await new Promise(function(r) { setTimeout(r, RETRY_BACKOFF_WAIT); });
                continue;
              }

              // Still too long — ultra truncation: system + last 1 only (Python line 455-461)
              if (nonSys.length > 1) {
                ctx.messages = sysMsgs.concat([nonSys[nonSys.length - 1]]);
                ctx._summary = '';
                messages = ctx.getMessages();
                if (onChunk) onChunk({ type: 'text', content: '[深度截断，1s 后重试...]\n' });
                await new Promise(function(r) { setTimeout(r, RETRY_BACKOFF_WAIT); });
                continue;
              }

              // Even system + last message too long → fatal (Python line 464-466)
              if (onChunk) onChunk({ type: 'text', content: '\n\n> 上下文无法进一步压缩，上下文过长。请精简系统提示词或减少单次任务的数据量。\n\n' });
              throw new Error('上下文超长，无法继续：' + lastErr.substring(0, 200));
            }

            // ── Auth errors (401, 403) — stop immediately (Python line 469-471) ──
            if (_isAuthError(lastErr)) {
              if (onChunk) onChunk({ type: 'text', content: '\n\n> API 认证失败，请检查 API Key 是否正确或已过期。\n\n' });
              throw new Error('API 认证失败：' + lastErr.substring(0, 200));
            }

            // ── Bad request (400) — fix orphaned and retry (Python line 476-484) ──
            if (_isBadRequest(lastErr)) {
              if (_fixOrphanedToolUses(ctx.messages)) {
                messages = ctx.getMessages();
                if (onChunk) onChunk({ type: 'text', content: '\n\n> 遇到中断残留，正在恢复上下文...\n\n' });
                await new Promise(function(r) { setTimeout(r, RETRY_BACKOFF_WAIT); });
                continue;
              }
              if (onChunk) onChunk({ type: 'text', content: '\n\n> 请求格式错误，无法继续。请调整任务描述或简化请求后重试。\n\n' });
              throw new Error('请求错误：' + lastErr.substring(0, 200));
            }

            // ── Transient error: exponential backoff retry (Python line 487-491) ──
            if (_isTransientError(lastErr) && llmAttempt < LLM_MAX_RETRIES) {
              var wait = Math.pow(2, llmAttempt);
              if (onChunk) onChunk({ type: 'text', content: '\n\n> AI 服务暂时不可用，' + wait + 's 后重试...\n\n' });
              await new Promise(function(r) { setTimeout(r, wait * 1000); });
              continue;
            }

            // Non-retriable error — fall through to error injection
            break;
          }
        }

        // ── Handle LLM failure (Python line 496-523) ──
        if (!llmOk) {
          consecutiveLlmFailures++;
          if (consecutiveLlmFailures >= 5) {
            if (onChunk) onChunk({ type: 'text', content: '\n\n> AI 服务连续响应失败 ' + consecutiveLlmFailures + ' 次，已停止。请检查 API 配置或网络连接。\n\n' });
            throw new Error('AI 服务连续失败 ' + consecutiveLlmFailures + ' 次：' + lastErr.substring(0, 200));
          }
          // Inject progressively stronger hints with each failure (Python line 503-517)
          var hint;
          if (consecutiveLlmFailures === 1) {
            hint = '[系统提示] AI 调用失败：' + lastErr.substring(0, 200) +
              '。请根据此错误调整策略——减少并发工具调用、简化任务。';
          } else if (consecutiveLlmFailures === 2) {
            hint = '[系统提示] AI 调用再次失败（第2次）：' + lastErr.substring(0, 200) +
              '。请认真检查任务规划——可能存在重复调用或无效工具使用。';
          } else {
            hint = '[系统提示] AI 调用持续失败（第' + consecutiveLlmFailures + '次）：' + lastErr.substring(0, 200) +
              '。强烈建议：放弃当前方案，尝试完全不同的途径，或向用户说明遇到的问题。';
          }
          ctx.addMessage({ role: 'user', content: hint });
          var waitS = Math.min(Math.pow(2, consecutiveLlmFailures - 1), 10);
          if (onChunk) onChunk({ type: 'text', content: '\n\n> AI 服务暂不可用，' + waitS + 's 后重试...\n\n' });
          await new Promise(function(r) { setTimeout(r, waitS * 1000); });
          continue;
        }
        consecutiveLlmFailures = 0;

        // ── No tools → check completion gates before finishing (Python line 525-689) ──
        if (toolCallsAcc.length === 0) {
          // ── Gate 1: Pending background experts (Python line 529-633) ──
          if (Tools._hasPendingExperts()) {
            // Drain any newly-completed results first
            var gate1Collected = Tools._collectBackgroundResults();
            var gate1GotResults = false;
            for (var gi = 0; gi < gate1Collected.length; gi++) {
              var g1bg = gate1Collected[gi];
              var g1eid = g1bg.id || '';
              if (notifiedExperts.has(g1eid)) continue;
              notifiedExperts.add(g1eid);
              var g1ok = g1bg.success;
              var g1status = g1ok ? '成功' : '失败';
              ctx.addMessage({
                role: 'user',
                content: '[后台任务 ' + g1eid + ' ' + g1status + ']\n\n' + (g1bg.result || ''),
              });
              if (g1ok) {
                if (onChunk) onChunk({ type: 'text', content: '\n> 后台专家 ' + g1eid + ' 已完成\n' });
              } else {
                if (onChunk) onChunk({ type: 'text', content: '\n> ⚠️ 后台专家 ' + g1eid + ' 执行失败！请检查并重试\n' });
              }
              gate1GotResults = true;
            }
            if (gate1GotResults) {
              // Don't finish — let LLM process the new results
              if (textBuffer.trim()) ctx.addMessage({ role: 'assistant', content: textBuffer });
              continue;
            }

            // No results yet — poll WITHOUT calling LLM (Python line 546-633)
            if (!waitingYielded) {
              if (onChunk) onChunk({ type: 'text', content: '\n> 后台专家正在工作中...\n' });
              waitingYielded = true;
            }

            // Staggered polling: 10x3s + 10x6s + 4x15s + 10x60s = ~12 min total
            var pollSchedule = [
              [3, 10],   // 10 × 3s = 30s, fast phase
              [6, 10],   // 10 × 6s = 60s, medium phase
              [15, 4],   //  4 × 15s = 60s, slow phase
              [60, 10],  // 10 × 60s = 600s, idle phase
            ];
            var pollGotResults = false;

            for (var psi = 0; psi < pollSchedule.length; psi++) {
              var interval = pollSchedule[psi][0];
              var count = pollSchedule[psi][1];
              for (var pci = 0; pci < count; pci++) {
                if (!Tools._hasPendingExperts()) break;
                await new Promise(function(r) { setTimeout(r, interval * 1000); });
                // Collect any completed results during poll
                var pollCollected = Tools._collectBackgroundResults();
                for (var pli = 0; pli < pollCollected.length; pli++) {
                  var pbg = pollCollected[pli];
                  var peid = pbg.id || '';
                  if (notifiedExperts.has(peid)) continue;
                  notifiedExperts.add(peid);
                  var pok = pbg.success;
                  var pstatus = pok ? '成功' : '失败';
                  ctx.addMessage({
                    role: 'user',
                    content: '[后台任务 ' + peid + ' ' + pstatus + ']\n\n' + (pbg.result || ''),
                  });
                  if (pok) {
                    if (onChunk) onChunk({ type: 'text', content: '\n> 后台专家已完成\n' });
                  } else {
                    if (onChunk) onChunk({ type: 'text', content: '\n> ⚠️ 后台专家执行失败！请检查并重试\n' });
                  }
                  pollGotResults = true;
                }
              }
              if (pollGotResults || !Tools._hasPendingExperts()) break;
            }

            if (pollGotResults) {
              waitingYielded = false;
              if (textBuffer.trim()) ctx.addMessage({ role: 'assistant', content: textBuffer });
              continue;
            }

            // Final sweep — catch anything that arrived after last poll
            var finalCollected = Tools._collectBackgroundResults();
            for (var fli = 0; fli < finalCollected.length; fli++) {
              var fbg = finalCollected[fli];
              var feid = fbg.id || '';
              if (notifiedExperts.has(feid)) continue;
              notifiedExperts.add(feid);
              var fok = fbg.success;
              var fstatus = fok ? '成功' : '失败';
              ctx.addMessage({
                role: 'user',
                content: '[后台任务 ' + feid + ' ' + fstatus + ']\n\n' + (fbg.result || ''),
              });
              if (fok) {
                if (onChunk) onChunk({ type: 'text', content: '\n> 后台专家 ' + feid + ' 已完成\n' });
              } else {
                if (onChunk) onChunk({ type: 'text', content: '\n> ⚠️ 后台专家 ' + feid + ' 执行失败！请检查并重试\n' });
              }
              pollGotResults = true;
            }
            if (pollGotResults) {
              waitingYielded = false;
              if (textBuffer.trim()) ctx.addMessage({ role: 'assistant', content: textBuffer });
              continue;
            }

            // Long wait exhausted — let LLM know (Python line 626-633)
            if (Tools._hasPendingExperts()) {
              ctx.addMessage({
                role: 'user',
                content: '[系统提示] 后台专家任务仍在执行中。请简短回复用户当前进度，不要声称完成。',
              });
            }
            waitingYielded = false;
            continue;
          }

          // No pending tasks — reset waiting flag
          waitingYielded = false;

          // ── Gate 2: Expert failures unhandled (Python line 638-661) ──
          if (Tools._hasUnhandledFailures()) {
            var exhausted = Tools._exhaustedExpertRetries();
            var gate2Hint;
            if (exhausted.length > 0) {
              // Experts failed twice — tell agent to handle it directly
              var failDetails = exhausted.map(function(e) {
                return '  Task [' + e.taskId + '] (' + e.expertType + '专家): 已失败2次，专家无法完成。你必须自行完成此任务，不要再 spawn_expert！';
              }).join('\n');
              gate2Hint = (
                '[系统提示] 以下专家任务已失败2次，不能再使用专家重试：\n' + failDetails + '\n' +
                '请你自己（主 agent）直接完成这些任务：阅读需求、分析代码、生成用例，' +
                '用 write_file 写入结果，然后标记对应 task 为 done。'
              );
            } else {
              gate2Hint = (
                '[系统提示] 有后台专家执行失败！你必须采取行动：' +
                '1) 重新 spawn_expert 重试，或 2) 自行完成。'
              );
            }
            ctx.addMessage({ role: 'user', content: gate2Hint });
            if (onChunk) onChunk({ type: 'text', content: '\n> 子任务失败，尝试重试或自行完成...\n' });
            continue;
          }

          // ── Gate 3: Incomplete tasks (Python line 663-688) ──
          if (Tools._hasIncompleteTasks()) {
            // Only auto-done if the agent has already responded with text
            if (!textBuffer.trim()) {
              var taskSummary = Tools._taskStatusSummary();
              ctx.addMessage({
                role: 'user',
                content: '[系统提示] 仍有未完成的任务：\n' + taskSummary + '\n请使用工具完成工作或更新任务状态。',
              });
              if (onChunk) onChunk({ type: 'text', content: '\n> 有未完成任务，继续处理...\n' });
              continue;
            }
            // Agent chose to respond with text only — accept its decision, auto-done remaining tasks
            // (This is handled by the task system — we just let the loop end)
          }

          // All gates passed — save text and finish
          dbg.push('T' + turn + ' done text=' + (textBuffer||'').substring(0,30));
          if (textBuffer.trim()) {
            ctx.addMessage({ role: 'assistant', content: textBuffer });
          }
          break;
        }

        // ── Cap excessive tool calls in one turn (Python line 728-729) ──
        if (toolCallsAcc.length > MAX_TOOL_CALLS_PER_TURN) {
          toolCallsAcc = toolCallsAcc.slice(0, MAX_TOOL_CALLS_PER_TURN);
        }

        // ── Productive turn counting (Python line 734-737) ──
        var turnSigs = new Set(toolCallsAcc.map(function(tc) {
          var args = {};
          try { args = JSON.parse(tc.function.arguments); } catch (e) {}
          return _toolSig({ name: tc.function.name, arguments: args });
        }));
        var hasNew = false;
        turnSigs.forEach(function(s) { if (!recentSigs.has(s)) { hasNew = true; recentSigs.add(s); } });
        if (hasNew) productiveTurns++;
        if (productiveTurns >= MAX_TURNS) break;

        // ── Save assistant + tool_calls (Python: engine.py line 749-760) ──
        var assistantWithCalls = {
          role: 'assistant',
          content: textBuffer.trim() || null,
          tool_calls: toolCallsAcc.map(tc => {
            var parsedArgs = {};
            try { parsedArgs = JSON.parse(tc.function.arguments); } catch (e) { parsedArgs = {}; }
            return {
              id: tc.id, type: 'function',
              function: {
                name: tc.function.name,
                arguments: JSON.stringify(_contextArgs(parsedArgs)),
              },
            };
          }),
        };
        ctx.addMessage(assistantWithCalls);

        // ── Execute tools in parallel with timeout + semaphore (Python line 764-816) ──
        // Semaphore for file-write tools to prevent contention
        var _semaphoreCount = 0;
        var _semaphoreMax = 4;  // Python: FILE_WRITE_CONCURRENCY = 4
        var _semaphoreQueue = [];

        function _acquireSemaphore() {
          return new Promise(function(resolve) {
            if (_semaphoreCount < _semaphoreMax) {
              _semaphoreCount++;
              resolve();
            } else {
              _semaphoreQueue.push(resolve);
            }
          });
        }

        function _releaseSemaphore() {
          _semaphoreCount--;
          if (_semaphoreQueue.length > 0) {
            _semaphoreCount++;
            _semaphoreQueue.shift()();
          }
        }

        var _fileWriteTools = new Set([
          'write_file', 'append_file', 'edit', 'write_questions', 'grade_practice', 'grade_essay', 'grade_interview', 'export_json',
          'export_excel', 'export_markdown', 'export_xmind', 'export_testrail_csv',
        ]);

        function _withTimeout(promise, ms) {
          return new Promise(function(resolve, reject) {
            var timer = setTimeout(function() {
              reject(new Error('Timeout: exceeded ' + (ms / 1000) + 's limit'));
            }, ms);
            promise.then(function(v) { clearTimeout(timer); resolve(v); },
                         function(e) { clearTimeout(timer); reject(e); });
          });
        }

        // Run each tool in parallel
        console.log('[AEngine] T' + turn + ' executing ' + toolCallsAcc.length + ' tools:', toolCallsAcc.map(function(tc) { return tc.function.name; }).join(', '));
        // Notify UI: tool execution starting
        if (onChunk) {
          toolCallsAcc.forEach(function(tc) {
            var args = {};
            try { args = JSON.parse(tc.function.arguments); } catch (e) {}
            var label = '';
            if (tc.function.name === 'read_file') label = args.file || args.path || '';
            else if (tc.function.name === 'write_file') label = args.file || args.path || '';
            else if (tc.function.name === 'write_questions') label = args.file || '';
            else if (tc.function.name === 'grade_practice') label = args.file || '';
            else if (tc.function.name === 'glob') label = args.pattern || '';
            else if (tc.function.name === 'grep') label = args.pattern || '';
            else if (tc.function.name === 'list_files') label = args.path || '';
            else if (tc.function.name === 'task_create') label = args.subject || '';
            else if (tc.function.name === 'spawn_expert') label = args.task || '';
            else if (tc.function.name === 'web_search') label = args.query || '';
            onChunk({ type: 'tool_start', name: tc.function.name, label: label });
          });
        }
        var toolPromises = toolCallsAcc.map(function(tc) {
          var args = {};
          try { args = JSON.parse(tc.function.arguments); } catch (e) { args = {}; }
          var toolName = tc.function.name;
          var needsSem = _fileWriteTools.has(toolName);

          return (async function() {
            if (needsSem) await _acquireSemaphore();
            try {
              var result = await _withTimeout(Tools.execute(toolName, args), TOOL_TIMEOUT);
              if (result === null || result === undefined) result = 'done';
              if (typeof result !== 'string') result = String(result);
              return { tc: tc, args: args, result: result };
            } catch (e) {
              var errMsg = 'Error: ' + (e && e.message ? e.message : String(e));
              return { tc: tc, args: args, result: errMsg };
            } finally {
              if (needsSem) _releaseSemaphore();
            }
          })();
        });

        var toolResults = await Promise.all(toolPromises);
        console.log('[AEngine] T' + turn + ' tool results:', toolResults.map(function(tr) { return tr.tc.function.name + '=' + String(tr.result).substring(0, 60); }).join('; '));
        // Notify UI: tool execution done
        if (onChunk) onChunk({ type: 'tool_done' });

        // Add all results to context
        for (var ri = 0; ri < toolResults.length; ri++) {
          var tr = toolResults[ri];
          _addToolResult(ctx.messages, tr.tc.id, tr.tc.function.name, tr.result, tr.args);
          dbg.push('T' + turn + ' result ' + tr.tc.id + '=' + String(tr.result).substring(0, 30));
        }

        // ── Output tool clears unhandled expert failures (Python line 817-820) ──
        var _outputTools = new Set(['write_file', 'write_questions', 'grade_practice', 'append_file',
          'export_json', 'export_excel', 'export_markdown', 'export_xmind', 'export_testrail_csv']);
        var outputToolCalled = toolCallsAcc.some(function(tc) {
          return _outputTools.has(tc.function.name);
        });
        if (outputToolCalled && Tools._hasUnhandledFailures()) {
          Tools._clearUnhandledFailures();
        }

      } catch (e) {
        // Outer catch — fatal errors from LLM retry logic
        if (aborted) {
          // Re-throw AbortError so _aiSend can display "已停止" instead of error
          var abortErr = new Error('用户停止对话');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        dbg.push('T' + turn + ' FATAL=' + (e && e.message ? e.message : String(e)).substring(0, 80));
        break;
      }
    }

    // ── Cancel any remaining experts on loop exit ──
    Tools._cancelAllExperts();

    // ── Show debug log ──
    setTimeout(function() { API.toast(dbg.join(' | '), 5000); }, 100);

    var lastAssistant = ctx.messages.filter(function(m) { return m.role === 'assistant'; }).pop();
    return { text: (lastAssistant && lastAssistant.content) || '', messages: ctx.messages };
  }

  // ── 会话持久化 ──────────────────────────────────────────
  async function saveSession(sessionId, messages) {
    if (!sessionId) return;
    const proj = API._activeProject();
    const session = await API.Repository.getSession(sessionId);
    if (session) {
      session.messages = messages
        .filter(function(m) { return m.role !== 'system'; })
        .map(function(m) {
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            var tb = m.content.filter(function(b) { return !b || b.type !== 'thinking'; });
            return Object.assign({}, m, { content: tb.length > 0 ? tb : '' });
          }
          return m;
        });
      session.updated = new Date().toISOString();
      await API.Repository.saveSession(session);
    }
  }

  // ── 对外接口 ────────────────────────────────────────────
  return {
    getConfig,
    detectFormat,
    runLoop,
    saveSession,
    _fixOrphanedToolUses,
    _isContextLengthError,
    _isTransientError,
    _isRateLimitError,
    _retryAfterMs,
    _isAuthError,
    _isBadRequest,
    _safeTail,
    // Exposed for external use
    buildOpenAIMessages,
    buildAnthropicMessages,
    callOpenAI,
    callAnthropic,
  };
})();
