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
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'CIAO' } }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 2 } }),
    ].join('\n'),
    stderr: 'Reading additional input from stdin...',
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.output, 'CIAO');
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
      stdout: 'CIAO',
      stderr: '',
    }).output,
    'CIAO'
  );

  const normalizedJson = normalizeAgentResult({
    agent: 'claude',
    provider: 'claude',
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result',
      result: 'CIAO',
      session_id: 'claude-session',
      total_cost_usd: 0.01,
      duration_ms: 1200,
      num_turns: 1,
    }),
    stderr: '',
  });

  assert.equal(normalizedJson.output, 'CIAO');
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
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'CI' } },
    })}\n`)[0].text,
    'CI'
  );
  assert.equal(
    normalizer.pushStdout(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'AO' } },
    })}\n`)[0].text,
    'AO'
  );

  const done = normalizer.finish(0);
  assert.equal(done.output, 'CIAO');
  assert.equal(done.sessionId, 'claude-stream');
});

test('normalizeAgentResult extracts gemini json output and usage', () => {
  const normalized = normalizeAgentResult({
    agent: 'gemini',
    provider: 'gemini',
    exitCode: 0,
    stdout: JSON.stringify({
      response: 'CIAO',
      stats: { models: { 'gemini-3-pro-preview': { tokens: { total: 10 } } } },
    }),
    stderr: '',
  });

  assert.equal(normalized.output, 'CIAO');
  assert.equal(normalized.usage.stats.models['gemini-3-pro-preview'].tokens.total, 10);
});

test('createAgentStreamNormalizer extracts gemini stream-json deltas', () => {
  const normalizer = createAgentStreamNormalizer('gemini', '--output-format stream-json');

  normalizer.pushStdout(`${JSON.stringify({ delta: { text: 'CI' } })}\n`);
  normalizer.pushStdout(`${JSON.stringify({ delta: { text: 'AO' } })}\n`);

  assert.equal(normalizer.finish(0).output, 'CIAO');
});
