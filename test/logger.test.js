const test = require('node:test');
const assert = require('node:assert/strict');

const { formatTextLogLine, normalizeLogFormat } = require('../src/logger');

test('normalizeLogFormat defaults to text and accepts json override', () => {
  assert.equal(normalizeLogFormat(), 'text');
  assert.equal(normalizeLogFormat('json'), 'json');
  assert.equal(normalizeLogFormat('unsupported'), 'text');
});

test('formatTextLogLine renders readable key value logs', () => {
  const line = formatTextLogLine({
    timestamp: '2026-06-26T11:09:52.546Z',
    level: 'info',
    message: 'server_started',
    payload: {
      url: 'http://127.0.0.1:7357',
      logLevel: 'info',
      apiAuthEnabled: false,
      apiAuthSource: 'none',
      durationMs: 96256,
    },
  });

  assert.equal(
    line,
    '2026-06-26T11:09:52.546Z INFO    Server started url=http://127.0.0.1:7357 logLevel=info auth=false authSource=none duration=1m36.3s'
  );
});

test('formatTextLogLine renders multiline prompts as an indented block', () => {
  const line = formatTextLogLine({
    timestamp: '2026-06-26T11:10:03.413Z',
    level: 'debug',
    message: 'agent_run_details',
    payload: {
      requestId: 'req-1',
      agent: 'codex',
      prompt: 'Read file\nSummarize it',
    },
  });

  assert.equal(
    line,
    [
      '2026-06-26T11:10:03.413Z DEBUG   Run details request=req-1 agent=codex',
      '  prompt:',
      '    Read file',
      '    Summarize it',
    ].join('\n')
  );
});
