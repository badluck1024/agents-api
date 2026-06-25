const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgentStreamNormalizer,
  detectOutputFormat,
  normalizeAgentResult,
  normalizeCodexLine,
} = require('../src/codexOutput');

test('detectOutputFormat reads output format from config string', () => {
  assert.equal(detectOutputFormat('--model sonnet --output-format stream-json'), 'stream-json');
  assert.equal(detectOutputFormat('--output-format=json --model sonnet'), 'json');
  assert.equal(detectOutputFormat('--model sonnet'), '');
});

test('normalizeAgentResult extracts codex JSONL output, session, and usage', () => {
  const normalized = normalizeAgentResult({
    agent: 'codex',
    provider: 'codex',
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'HELLO' } }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 2 } }),
    ].join('\n'),
    stderr: 'Reading additional input from stdin...',
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.output, 'HELLO');
  assert.equal(normalized.sessionId, 'thread-1');
  assert.equal(normalized.usage.output_tokens, 2);
});

test('normalizeCodexLine maps command execution events', () => {
  assert.deepEqual(
    normalizeCodexLine(JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'npm test',
        exit_code: 0,
        aggregated_output: 'ok',
      },
    })),
    [{ type: 'tool', command: 'npm test', exitCode: 0, output: 'ok' }]
  );
});

test('normalizeAgentResult extracts claude text and json output', () => {
  assert.equal(
    normalizeAgentResult({
      agent: 'claude',
      provider: 'claude',
      exitCode: 0,
      stdout: 'HELLO',
      stderr: '',
    }).output,
    'HELLO'
  );

  const normalizedJson = normalizeAgentResult({
    agent: 'claude',
    provider: 'claude',
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result',
      result: 'HELLO',
      session_id: 'claude-session',
      total_cost_usd: 0.01,
      duration_ms: 1200,
      num_turns: 1,
    }),
    stderr: '',
  });

  assert.equal(normalizedJson.output, 'HELLO');
  assert.equal(normalizedJson.sessionId, 'claude-session');
  assert.equal(normalizedJson.usage.total_cost_usd, 0.01);
});

test('createAgentStreamNormalizer extracts claude stream-json deltas', () => {
  const normalizer = createAgentStreamNormalizer('claude', '--output-format stream-json');

  assert.equal(
    normalizer.pushStdout(`${JSON.stringify({ type: 'system', session_id: 'claude-stream' })}\n`)[0].type,
    'session'
  );
  assert.equal(
    normalizer.pushStdout(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'HE' } },
    })}\n`)[0].text,
    'HE'
  );
  assert.equal(
    normalizer.pushStdout(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'LLO' } },
    })}\n`)[0].text,
    'LLO'
  );

  const done = normalizer.finish(0);
  assert.equal(done.output, 'HELLO');
  assert.equal(done.sessionId, 'claude-stream');
});

test('normalizeAgentResult extracts antigravity text output', () => {
  const normalized = normalizeAgentResult({
    agent: 'antigravity',
    provider: 'antigravity',
    exitCode: 0,
    stdout: 'HELLO',
    stderr: '',
  });

  assert.equal(normalized.output, 'HELLO');
  assert.equal(normalized.usage, null);
});

test('normalizeAgentResult treats empty antigravity output as a failed response', () => {
  const normalized = normalizeAgentResult({
    agent: 'antigravity',
    provider: 'antigravity',
    exitCode: 0,
    stdout: '',
    stderr: '',
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.errors[0], /produced no output/);
});

test('createAgentStreamNormalizer extracts antigravity text chunks', () => {
  const normalizer = createAgentStreamNormalizer('antigravity', '');

  normalizer.pushStdout('HE');
  normalizer.pushStdout('LLO');

  assert.equal(normalizer.finish(0).output, 'HELLO');
});

test('createAgentStreamNormalizer treats empty antigravity streams as failed responses', () => {
  const normalizer = createAgentStreamNormalizer('antigravity', '');
  const done = normalizer.finish(0);

  assert.equal(done.ok, false);
  assert.match(done.errors[0], /produced no output/);
});
