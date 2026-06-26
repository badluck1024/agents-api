const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAgentResult } = require('../src/codexOutput');
const { detectOutputFormatForAgent, resolveParserProfile } = require('../src/compat/parserRegistry');
const { compareVersions, extractVersionNumber, satisfiesVersionRange } = require('../src/compat/version');

test('compat version helpers parse and compare agent version strings', () => {
  assert.equal(extractVersionNumber('codex-cli 0.137.0'), '0.137.0');
  assert.equal(extractVersionNumber('2.1.170 (Claude Code)'), '2.1.170');
  assert.equal(compareVersions('0.137.0', '0.136.9'), 1);
  assert.equal(satisfiesVersionRange('0.137.0', '>=0.100.0 <1.0.0'), true);
  assert.equal(satisfiesVersionRange('2.1.170', '<2.0.0'), false);
});

test('parser registry resolves parser profiles by agent, format, and version', () => {
  assert.equal(detectOutputFormatForAgent('codex', '--json --model gpt-5'), 'jsonl');
  assert.equal(detectOutputFormatForAgent('claude', '--output-format stream-json'), 'stream-json');
  assert.equal(detectOutputFormatForAgent('antigravity', '--model gemini-3.5-flash'), 'text');

  assert.equal(
    resolveParserProfile({
      agentId: 'codex',
      version: 'codex-cli 0.137.0',
      configString: '--json',
    }).parserId,
    'codex-jsonl-v1'
  );

  assert.equal(
    resolveParserProfile({
      agentId: 'claude',
      version: '2.1.170 (Claude Code)',
      configString: '--output-format json',
    }).parserId,
    'claude-json-v1'
  );

  assert.equal(
    resolveParserProfile({
      agentId: 'antigravity',
      version: '1.0.12',
      configString: '--model gemini-3.5-flash',
    }).parserId,
    'generic-text-v1'
  );
});

test('normalizeAgentResult uses parser registry with agentVersion metadata', () => {
  const normalized = normalizeAgentResult({
    agent: 'antigravity',
    provider: 'antigravity',
    agentVersion: '1.0.12',
    config: '',
    exitCode: 0,
    stdout: 'HELLO',
    stderr: '',
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.output, 'HELLO');
});
