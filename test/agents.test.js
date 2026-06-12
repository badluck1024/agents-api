const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAgentArgs } = require('../src/agentRunner');
const { createDefaultAgentsConfig, listAgentIds, normalizeAgentId } = require('../src/agents');

test('supported agent ids remain stable', () => {
  assert.deepEqual(listAgentIds(), ['codex', 'claude', 'gemini']);
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
    AGENTSAPI_GEMINI_COMMAND: '/bin/gemini-test',
  });

  assert.equal(config.codex.command, '/bin/codex-test');
  assert.equal(config.claude.command, '/bin/claude-test');
  assert.equal(config.gemini.command, '/bin/gemini-test');
});

test('buildAgentArgs constructs codex command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'codex',
      '--json --model gpt-5.5 -c model_reasoning_effort=\\"xhigh\\"',
      'Scrivi solo CIAO'
    ),
    [
      'exec',
      '--json',
      '--model',
      'gpt-5.5',
      '-c',
      'model_reasoning_effort="xhigh"',
      'Scrivi solo CIAO',
    ]
  );
});

test('buildAgentArgs constructs codex resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'codex',
      '--json --model gpt-5.5 --skip-git-repo-check',
      'Continua',
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
      'Continua',
    ]
  );
});

test('buildAgentArgs constructs claude command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'claude',
      '--output-format text --model claude-opus-4-8 --effort max',
      'Scrivi solo CIAO'
    ),
    [
      '-p',
      '--output-format',
      'text',
      '--model',
      'claude-opus-4-8',
      '--effort',
      'max',
      'Scrivi solo CIAO',
    ]
  );
});

test('buildAgentArgs constructs claude resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'claude',
      '--output-format json --model claude-opus-4-8 --effort max',
      'Continua',
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
      'Continua',
    ]
  );
});

test('buildAgentArgs constructs gemini command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'gemini',
      '--output-format stream-json --model gemini-3-pro-preview --approval-mode yolo',
      'Scrivi solo CIAO'
    ),
    [
      '--output-format',
      'stream-json',
      '--model',
      'gemini-3-pro-preview',
      '--approval-mode',
      'yolo',
      '--prompt',
      'Scrivi solo CIAO',
    ]
  );
});

test('buildAgentArgs constructs gemini resume command arguments', () => {
  assert.deepEqual(
    buildAgentArgs(
      'gemini',
      '--output-format stream-json --model gemini-3-pro-preview --approval-mode yolo',
      'Continua',
      { sessionId: 'gemini-session' }
    ),
    [
      '--resume',
      'gemini-session',
      '--output-format',
      'stream-json',
      '--model',
      'gemini-3-pro-preview',
      '--approval-mode',
      'yolo',
      '--prompt',
      'Continua',
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
