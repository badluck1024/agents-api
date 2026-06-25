const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAgentArgs } = require('../src/agentRunner');
const { createDefaultAgentsConfig, listAgentIds, normalizeAgentId } = require('../src/agents');

test('supported agent ids remain stable', () => {
  assert.deepEqual(listAgentIds(), ['codex', 'claude', 'antigravity']);
});

test('normalizeAgentId accepts known agents only', () => {
  assert.equal(normalizeAgentId('CODEX'), 'codex');
  assert.equal(normalizeAgentId('claude'), 'claude');
  assert.equal(normalizeAgentId('missing', 'codex'), 'codex');
  assert.equal(normalizeAgentId('missing', null), null);
});

test('createDefaultAgentsConfig uses command environment overrides', () => {
  const config = createDefaultAgentsConfig({
    AGENTSAPI_CODEX_COMMAND: '/bin/codex-test',
    AGENTSAPI_CLAUDE_COMMAND: '/bin/claude-test',
    AGENTSAPI_ANTIGRAVITY_COMMAND: '/bin/agy-test',
  });

  assert.equal(config.codex.command, '/bin/codex-test');
  assert.equal(config.claude.command, '/bin/claude-test');
  assert.equal(config.antigravity.command, '/bin/agy-test');
});

test('buildAgentArgs constructs codex command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'codex',
      '--json --model gpt-5.5 -c model_reasoning_effort=\\"xhigh\\"',
      'Write only HELLO'
    ),
    [
      'exec',
      '--json',
      '--model',
      'gpt-5.5',
      '-c',
      'model_reasoning_effort="xhigh"',
      'Write only HELLO',
    ]
  );
});

test('buildAgentArgs constructs codex resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'codex',
      '--json --model gpt-5.5 --skip-git-repo-check',
      'Continue',
      { sessionId: '019-session' }
    ),
    [
      'exec',
      '--json',
      '--model',
      'gpt-5.5',
      '--skip-git-repo-check',
      'resume',
      '019-session',
      'Continue',
    ]
  );
});

test('buildAgentArgs constructs claude command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'claude',
      '--output-format text --model claude-opus-4-8 --effort max',
      'Write only HELLO'
    ),
    [
      '-p',
      '--output-format',
      'text',
      '--model',
      'claude-opus-4-8',
      '--effort',
      'max',
      'Write only HELLO',
    ]
  );
});

test('buildAgentArgs constructs claude resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'claude',
      '--output-format json --model claude-opus-4-8 --effort max',
      'Continue',
      { sessionId: 'claude-session' }
    ),
    [
      '-p',
      '--resume',
      'claude-session',
      '--output-format',
      'json',
      '--model',
      'claude-opus-4-8',
      '--effort',
      'max',
      'Continue',
    ]
  );
});

test('buildAgentArgs constructs antigravity command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'antigravity',
      '--model gemini-3.5-flash --dangerously-skip-permissions',
      'Write only HELLO'
    ),
    [
      '--model',
      'gemini-3.5-flash',
      '--dangerously-skip-permissions',
      '--print',
      'Write only HELLO',
    ]
  );
});

test('buildAgentArgs constructs antigravity resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'antigravity',
      '--model gemini-3.5-flash --dangerously-skip-permissions',
      'Continue',
      { sessionId: 'antigravity-session' }
    ),
    [
      '--conversation',
      'antigravity-session',
      '--model',
      'gemini-3.5-flash',
      '--dangerously-skip-permissions',
      '--print',
      'Continue',
    ]
  );
});

test('buildAgentArgs validates sessionId', () => {
  assert.throws(
    () => buildAgentArgs('codex', '--json', 'Prompt', { sessionId: '' }),
    /sessionId/
  );
  assert.throws(
    () => buildAgentArgs('codex', '--json', 'Prompt', { sessionId: 123 }),
    /sessionId/
  );
});
