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

function normalizeLogLevel(value) {
  const normalized = String(value || 'info').trim().toLowerCase();
  const level = LEVEL_ALIASES[normalized] || normalized;
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
}

function serializeLogPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function createLogger(options = {}) {
  const level = normalizeLogLevel(process.env.AGENTSAPI_LOG_LEVEL || options.level || 'info');
  const threshold = LEVELS[level];

  function enabled(nextLevel) {
    return LEVELS[nextLevel] >= threshold;
  }

  function write(nextLevel, message, payload) {
    if (!enabled(nextLevel)) {
      return;
    }

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: nextLevel.toUpperCase(),
      message,
      ...serializeLogPayload(payload),
    });

    if (nextLevel === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
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
  normalizeLogLevel,
};
