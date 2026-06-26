const LEVELS = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  off: Number.POSITIVE_INFINITY,
};

const LEVEL_ALIASES = {
  warn: 'warning',
  warnings: 'warning',
  errors: 'error',
  none: 'off',
  false: 'off',
  disabled: 'off',
};

const MESSAGE_LABELS = {
  agent_run_completed: 'Run completed',
  agent_run_details: 'Run details',
  agent_run_failed: 'Run failed',
  agent_run_prompt: 'Agent prompt',
  agent_run_received: 'Run received',
  agent_status: 'Agent status',
  agent_stream_completed: 'Stream completed',
  agent_stream_error: 'Stream error',
  agent_stream_failed: 'Stream failed',
  agents_preflight_completed: 'Agent preflight completed',
  agents_preflight_started: 'Agent preflight started',
  http_auth_failed: 'HTTP auth failed',
  http_auth_ok: 'HTTP auth ok',
  http_request_completed: 'HTTP request completed',
  http_request_received: 'HTTP request received',
  server_started: 'Server started',
};

const FIELD_LABELS = {
  apiAuthEnabled: 'auth',
  apiAuthSource: 'authSource',
  configLength: 'config',
  durationMs: 'duration',
  exitCode: 'exit',
  filesCount: 'files',
  idleTimeoutMs: 'idleTimeout',
  idleTimedOut: 'idleTimedOut',
  promptLength: 'prompt',
  remoteAddress: 'remote',
  requestId: 'request',
  responseMode: 'mode',
  stderrLength: 'stderr',
  stdoutLength: 'stdout',
  statusCode: 'status',
  timeoutMs: 'timeout',
};

function normalizeLogLevel(value) {
  const normalized = String(value || 'info').trim().toLowerCase();
  const level = LEVEL_ALIASES[normalized] || normalized;
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
}

function normalizeLogFormat(value) {
  const normalized = String(value || 'text').trim().toLowerCase();
  return normalized === 'json' ? 'json' : 'text';
}

function serializeLogPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function messageLabel(message) {
  const raw = String(message || '').trim();
  if (MESSAGE_LABELS[raw]) {
    return MESSAGE_LABELS[raw];
  }

  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) {
    return String(ms);
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 3 : 1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - (minutes * 60);
  return `${minutes}m${remainingSeconds.toFixed(1).padStart(4, '0')}s`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) {
    return String(bytes);
  }

  if (value < 1024) {
    return `${value}B`;
  }

  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib < 10 ? 1 : 0)}KiB`;
  }

  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)}MiB`;
}

function quoteText(value) {
  const text = String(value);
  if (text === '') {
    return '""';
  }

  if (/[\s="'\\]/.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

function formatFieldValue(key, value) {
  if (value === null) {
    return 'null';
  }

  if (key === 'durationMs' || key === 'timeoutMs' || key === 'idleTimeoutMs') {
    return formatDuration(value);
  }

  if (key === 'stdoutLength' || key === 'stderrLength' || key === 'contentLength') {
    return formatBytes(value);
  }

  if (key === 'promptLength' || key === 'configLength') {
    return `${value}chars`;
  }

  if (typeof value === 'string') {
    return quoteText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return quoteText(JSON.stringify(value));
}

function formatTextLogLine({ timestamp, level, message, payload }) {
  const fields = [];
  const blocks = [];

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'prompt' && typeof value === 'string') {
      blocks.push(['prompt', value]);
      continue;
    }

    if (key === 'config' && typeof value === 'string' && value.includes('\n')) {
      blocks.push(['config', value]);
      continue;
    }

    fields.push(`${FIELD_LABELS[key] || key}=${formatFieldValue(key, value)}`);
  }

  const firstLine = [
    timestamp,
    level.toUpperCase().padEnd(7),
    messageLabel(message),
    ...fields,
  ].filter(Boolean).join(' ');

  if (blocks.length === 0) {
    return firstLine;
  }

  return [
    firstLine,
    ...blocks.flatMap(([label, value]) => [
      `  ${label}:`,
      ...String(value).split(/\r?\n/).map((line) => `    ${line}`),
    ]),
  ].join('\n');
}

function formatJsonLogLine({ timestamp, level, message, payload }) {
  return JSON.stringify({
    timestamp,
    level: level.toUpperCase(),
    message,
    ...payload,
  });
}

function createLogger(options = {}) {
  const level = normalizeLogLevel(process.env.AGENTSAPI_LOG_LEVEL || options.level || 'info');
  const format = normalizeLogFormat(process.env.AGENTSAPI_LOG_FORMAT || options.format || 'text');
  const threshold = LEVELS[level];

  function enabled(nextLevel) {
    return LEVELS[nextLevel] >= threshold;
  }

  function write(nextLevel, message, payload) {
    if (!enabled(nextLevel)) {
      return;
    }

    const event = {
      timestamp: new Date().toISOString(),
      level: nextLevel,
      message,
      payload: serializeLogPayload(payload),
    };
    const line = format === 'json' ? formatJsonLogLine(event) : formatTextLogLine(event);

    if (nextLevel === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
    enabled,
    format,
    level,
    debug: (message, payload) => write('debug', message, payload),
    info: (message, payload) => write('info', message, payload),
    warning: (message, payload) => write('warning', message, payload),
    error: (message, payload) => write('error', message, payload),
  };
}

module.exports = {
  LEVELS,
  createLogger,
  formatTextLogLine,
  normalizeLogFormat,
  normalizeLogLevel,
};
