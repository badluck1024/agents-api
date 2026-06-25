const { splitArgsString } = require('./argsString');
const { resolveParserProfile } = require('./compat/parserRegistry');

function parseJsonLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseJsonDocument(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function readOption(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1] || '';
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return '';
}

function detectOutputFormat(configString) {
  try {
    const args = splitArgsString(configString);
    return readOption(args, '--output-format').trim().toLowerCase();
  } catch {
    return '';
  }
}

function inferJsonOutputFormat(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return '';
  }

  if (parseJsonDocument(text) !== null) {
    return 'json';
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 0 && lines.every((line) => parseJsonLine(line) !== null)) {
    return 'stream-json';
  }

  return '';
}

function extractErrorMessage(event) {
  const message = event && event.error && typeof event.error.message === 'string'
    ? event.error.message
    : event && typeof event.message === 'string'
      ? event.message
      : '';
  return message.trim();
}

function extractText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.result === 'string') {
    return value.result;
  }

  if (typeof value.response === 'string') {
    return value.response;
  }

  if (value.delta) {
    return extractText(value.delta);
  }

  if (value.content) {
    return extractText(value.content);
  }

  if (value.message) {
    return extractText(value.message);
  }

  if (value.part) {
    return extractText(value.part);
  }

  if (value.parts) {
    return extractText(value.parts);
  }

  return '';
}

function extractCandidateText(event) {
  const candidates = Array.isArray(event && event.candidates) ? event.candidates : [];
  return candidates
    .map((candidate) => extractText(candidate && candidate.content ? candidate.content : candidate))
    .filter(Boolean)
    .join('\n');
}

function normalizeCodexLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return [];
  }

  const event = parseJsonLine(trimmed);
  if (!event) {
    return [{ type: 'message', text: trimmed }];
  }

  if (event.type === 'thread.started') {
    return typeof event.thread_id === 'string' && event.thread_id.trim()
      ? [{ type: 'session', sessionId: event.thread_id.trim() }]
      : [];
  }

  if (event.type === 'turn.started') {
    return [];
  }

  if (event.type === 'turn.completed') {
    return event.usage ? [{ type: 'usage', usage: event.usage }] : [];
  }

  if (event.type === 'turn.failed' || event.type === 'error') {
    const message = extractErrorMessage(event) || JSON.stringify(event);
    return [{ type: 'error', message }];
  }

  const item = event.item;
  if (!item) {
    return event.type ? [{ type: 'meta', eventType: event.type, event }] : [];
  }

  if (event.type === 'item.started' && item.type === 'command_execution') {
    return [{ type: 'tool_start', command: item.command || '' }];
  }

  if (event.type !== 'item.completed') {
    return event.type ? [{ type: 'meta', eventType: event.type, event }] : [];
  }

  if (item.type === 'agent_message') {
    return item.text ? [{ type: 'message', text: item.text }] : [];
  }

  if (item.type === 'reasoning') {
    return item.text ? [{ type: 'reasoning', text: item.text }] : [];
  }

  if (item.type === 'command_execution') {
    return [{
      type: 'tool',
      command: item.command || '',
      exitCode: item.exit_code,
      output: item.aggregated_output || '',
    }];
  }

  return item.text
    ? [{ type: 'message', text: item.text }]
    : [{ type: 'meta', eventType: item.type || event.type, event }];
}

function appendNormalizedEvent(summary, event) {
  const publicEvent = { ...event };
  delete publicEvent.appendMode;
  delete publicEvent.appendToOutput;
  summary.events.push(publicEvent);

  if (event.type === 'message' && event.text) {
    if (event.appendToOutput === 'fallback') {
      summary.fallbackOutput = event.text;
    } else if (event.appendMode === 'concat') {
      summary.output += event.text;
      summary.hasOutput = true;
    } else {
      summary.output += summary.output ? `\n${event.text}` : event.text;
      summary.hasOutput = true;
    }
  }

  if (event.type === 'result' && typeof event.text === 'string') {
    summary.fallbackOutput = event.text;
  }

  if (event.type === 'error' && event.message) {
    summary.errors.push(event.message);
  }

  if (event.type === 'session' && event.sessionId) {
    summary.sessionId = event.sessionId;
  }

  if (event.type === 'usage' && event.usage) {
    summary.usage = event.usage;
  }
}

function createSummary() {
  return {
    output: '',
    fallbackOutput: '',
    hasOutput: false,
    errors: [],
    events: [],
    sessionId: null,
    usage: null,
  };
}

function finalizeSummary(summary, { exitCode, stderr = '' } = {}) {
  const stderrText = String(stderr || '').trim();
  const errors = [...summary.errors];

  if (exitCode !== 0 && errors.length === 0 && stderrText) {
    errors.push(stderrText);
  }

  return {
    ok: exitCode === 0 && errors.length === 0,
    exitCode,
    output: (summary.hasOutput ? summary.output : summary.fallbackOutput).trim(),
    sessionId: summary.sessionId,
    usage: summary.usage,
    errors,
    events: summary.events,
  };
}

function collectUsage(event, fieldNames) {
  const usage = {};

  if (event && event.usage && typeof event.usage === 'object') {
    Object.assign(usage, event.usage);
  }

  if (event && event.stats && typeof event.stats === 'object') {
    usage.stats = event.stats;
  }

  if (event && event.usageMetadata && typeof event.usageMetadata === 'object') {
    usage.usageMetadata = event.usageMetadata;
  }

  for (const fieldName of fieldNames) {
    if (event && event[fieldName] !== undefined) {
      usage[fieldName] = event[fieldName];
    }
  }

  return Object.keys(usage).length > 0 ? usage : null;
}

function normalizeClaudeObject(value) {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeClaudeObject);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const events = [];
  const sessionId = value.session_id || value.sessionId;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    events.push({ type: 'session', sessionId: sessionId.trim() });
  }

  if (value.type === 'stream_event' && value.event && typeof value.event === 'object') {
    return [...events, ...normalizeClaudeObject(value.event)];
  }

  if (value.type === 'system') {
    const usage = collectUsage(value, ['attempt', 'max_retries', 'retry_delay_ms']);
    if (usage) {
      events.push({ type: 'usage', usage });
    }
    events.push({
      type: 'meta',
      eventType: value.subtype ? `system.${value.subtype}` : 'system',
      event: value,
    });
    return events;
  }

  const errorMessage = extractErrorMessage(value);
  if (value.type === 'error' || errorMessage) {
    events.push({ type: 'error', message: errorMessage || JSON.stringify(value) });
    return events;
  }

  const usage = collectUsage(value, [
    'total_cost_usd',
    'duration_ms',
    'duration_api_ms',
    'num_turns',
  ]);
  if (usage) {
    events.push({ type: 'usage', usage });
  }

  if (value.type === 'result' || Object.prototype.hasOwnProperty.call(value, 'result')) {
    const resultText = typeof value.result === 'string'
      ? value.result
      : value.structured_output !== undefined
        ? JSON.stringify(value.structured_output)
        : '';
    if (resultText) {
      events.push({ type: 'result', text: resultText });
    }
    if (value.is_error === true && resultText) {
      events.push({ type: 'error', message: resultText });
    }
    return events;
  }

  if (value.type === 'content_block_delta' && value.delta) {
    const text = extractText(value.delta);
    return text ? [...events, { type: 'message', text, appendMode: 'concat' }] : events;
  }

  if (value.type === 'message_delta') {
    return events.length > 0 ? events : [{ type: 'meta', eventType: value.type, event: value }];
  }

  if (value.type === 'content_block_start' && value.content_block && value.content_block.type === 'tool_use') {
    events.push({
      type: 'tool_start',
      name: value.content_block.name || '',
      input: value.content_block.input || null,
    });
    return events;
  }

  if (value.type === 'assistant') {
    const text = extractText(value.message || value);
    return text ? [...events, { type: 'message', text, appendToOutput: 'fallback' }] : events;
  }

  if (value.type === 'user') {
    events.push({ type: 'meta', eventType: 'user', event: value });
    return events;
  }

  const deltaText = value.delta ? extractText(value.delta) : '';
  if (deltaText) {
    return [...events, { type: 'message', text: deltaText, appendMode: 'concat' }];
  }

  const text = extractText(value);
  if (text) {
    return [...events, { type: 'message', text }];
  }

  if (value.type) {
    return [...events, { type: 'meta', eventType: value.type, event: value }];
  }

  return events;
}

function normalizeJsonAwareResult(result, normalizeObject) {
  const summary = createSummary();
  const stdout = String(result.stdout || '');
  const parsedDocument = parseJsonDocument(stdout);
  const events = parsedDocument !== null
    ? normalizeObject(parsedDocument)
    : stdout.split(/\r?\n/).flatMap((line) => {
        const parsedLine = parseJsonLine(line);
        if (!parsedLine) {
          const text = String(line || '').trim();
          return text ? [{ type: 'message', text }] : [];
        }
        return normalizeObject(parsedLine);
      });

  for (const event of events) {
    appendNormalizedEvent(summary, event);
  }

  return finalizeSummary(summary, {
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

function normalizeCodexResult(result, agentId = 'codex') {
  if (agentId !== 'codex') {
    return normalizeAgentResult({ ...result, agent: agentId });
  }

  const summary = createSummary();
  const lines = String(result.stdout || '').split(/\r?\n/);

  for (const line of lines) {
    for (const event of normalizeCodexLine(line)) {
      appendNormalizedEvent(summary, event);
    }
  }

  return finalizeSummary(summary, {
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

function normalizeGenericResult(result) {
  const output = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  const errors = result.exitCode !== 0 && stderr ? [stderr] : [];

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    output,
    sessionId: null,
    usage: null,
    errors,
    events: output ? [{ type: 'message', text: output }] : [],
  };
}

function createGenericStreamNormalizer() {
  const summary = createSummary();
  let stderr = '';

  return {
    pushStdout(chunk) {
      const text = String(chunk || '');
      const events = text ? [{ type: 'message', text, appendMode: 'concat' }] : [];
      for (const event of events) {
        appendNormalizedEvent(summary, event);
      }
      return events.map((event) => ({ type: event.type, text: event.text }));
    },
    pushStderr(chunk) {
      stderr += String(chunk || '');
    },
    finish(exitCode) {
      return finalizeSummary(summary, { exitCode, stderr });
    },
  };
}

function createRequiredOutputStreamNormalizer(errorMessage) {
  const normalizer = createGenericStreamNormalizer();
  return {
    pushStdout: normalizer.pushStdout,
    pushStderr: normalizer.pushStderr,
    finish(exitCode) {
      const normalized = normalizer.finish(exitCode);
      if (normalized.ok && !normalized.output) {
        return {
          ...normalized,
          ok: false,
          errors: [errorMessage],
        };
      }
      return normalized;
    },
  };
}

function createLineStreamNormalizer(normalizeLine) {
  const summary = createSummary();
  let stdoutBuffer = '';
  let stderr = '';

  function pushLine(line) {
    const events = normalizeLine(line);
    for (const event of events) {
      appendNormalizedEvent(summary, event);
    }
    return events;
  }

  function pushStdout(chunk) {
    stdoutBuffer += String(chunk || '');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    const events = [];

    for (const line of lines) {
      events.push(...pushLine(line));
    }

    return events;
  }

  function pushStderr(chunk) {
    stderr += String(chunk || '');
  }

  function finish(exitCode) {
    if (stdoutBuffer.trim()) {
      pushLine(stdoutBuffer);
      stdoutBuffer = '';
    }

    return finalizeSummary(summary, {
      exitCode,
      stderr,
    });
  }

  return {
    finish,
    pushStderr,
    pushStdout,
  };
}

function createCodexStreamNormalizer(agentId = 'codex') {
  if (agentId !== 'codex') {
    return createAgentStreamNormalizer(agentId);
  }

  return createLineStreamNormalizer(normalizeCodexLine);
}

function normalizeClaudeResult(result) {
  return normalizeJsonAwareResult(result, normalizeClaudeObject);
}

function normalizeAntigravityResult(result) {
  const normalized = normalizeGenericResult(result);
  if (normalized.ok && !normalized.output) {
    return {
      ...normalized,
      ok: false,
      errors: ['Antigravity CLI produced no output.'],
    };
  }
  return normalized;
}

function normalizeResultWithParser(result, parserProfile) {
  const parserId = parserProfile && parserProfile.parserId ? parserProfile.parserId : 'generic-text-v1';

  if (parserId === 'codex-jsonl-v1' || parserId === 'codex-text-v1') {
    return normalizeCodexResult(result, 'codex');
  }

  if (parserId === 'claude-json-v1' || parserId === 'claude-stream-json-v1') {
    return normalizeClaudeResult(result);
  }

  return normalizeGenericResult(result);
}

function normalizeAgentResult(result) {
  const agentId = result.agent || result.provider;
  if (agentId === 'antigravity') {
    return normalizeAntigravityResult(result);
  }
  const explicitOutputFormat = detectOutputFormat(result.config || '');
  const parserProfile = resolveParserProfile({
    agentId,
    version: result.agentVersion || '',
    configString: result.config || '',
    outputFormat: explicitOutputFormat || inferJsonOutputFormat(result.stdout),
  });
  return normalizeResultWithParser(result, parserProfile);
}

function createAgentStreamNormalizer(agentId = 'codex', configString = '', options = {}) {
  if (agentId === 'antigravity') {
    return createRequiredOutputStreamNormalizer('Antigravity CLI produced no output.');
  }

  const parserProfile = resolveParserProfile({
    agentId,
    version: options.agentVersion || '',
    configString,
  });
  const parserId = parserProfile.parserId;

  if (parserId === 'codex-jsonl-v1' || parserId === 'codex-text-v1') {
    return createLineStreamNormalizer(normalizeCodexLine);
  }

  if (parserId === 'claude-json-v1' || parserId === 'claude-stream-json-v1') {
    return createLineStreamNormalizer((line) => {
      const parsed = parseJsonLine(line);
      return parsed ? normalizeClaudeObject(parsed) : normalizeGenericLine(line);
    });
  }

  return createGenericStreamNormalizer();
}

function normalizeGenericLine(line) {
  const text = String(line || '').trim();
  return text ? [{ type: 'message', text }] : [];
}

function normalizeResponseMode(value) {
  const mode = String(value || 'normalized').trim().toLowerCase();
  if (mode === 'raw') {
    return 'raw';
  }
  return 'normalized';
}

module.exports = {
  createAgentStreamNormalizer,
  createCodexStreamNormalizer,
  detectOutputFormat,
  normalizeAntigravityResult,
  normalizeAgentResult,
  normalizeClaudeResult,
  normalizeCodexLine,
  normalizeCodexResult,
  normalizeResultWithParser,
  normalizeResponseMode,
  parseJsonLine,
};
