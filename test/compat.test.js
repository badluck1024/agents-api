const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAgentResult } = require('../src/codexOutput');
const { createOutputSignature } = require('../src/compat/outputSignature');
const { detectOutputFormatForAgent, resolveParserProfile } = require('../src/compat/parserRegistry');
const { compareVersions, extractVersionNumber, satisfiesVersionRange } = require('../src/compat/version');
const { compareBaseline, parseArgs } = require('../scripts/agent-compat/probe-agents');

test('compat probe argument parser ignores pnpm separator', () => {
  const options = parseArgs(['--', '--agent', 'codex', '--timeout-ms', '120000', '--idle-timeout-ms', '15000']);

  assert.deepEqual(options.agents, ['codex']);
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.idleTimeoutMs, 15000);
});

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

test('output signatures describe json, jsonl, and text shapes', () => {
  assert.equal(
    createOutputSignature({ stdout: JSON.stringify({ type: 'result', result: 'HELLO' }) }).kind,
    'json'
  );
  assert.equal(
    createOutputSignature({
      stdout: [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 1 } }),
      ].join('\n'),
    }).kind,
    'jsonl'
  );
  assert.equal(createOutputSignature({ stdout: 'HELLO' }).kind, 'text');
});

test('output signatures deduplicate jsonl line shapes', () => {
  const signature = createOutputSignature({
    stdout: [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 1 } }),
    ].join('\n'),
  });

  assert.equal(signature.kind, 'jsonl');
  assert.equal(signature.stdoutLineShapes.length, 2);
});

test('output signatures normalize dynamic model usage keys', () => {
  const modelUsageShape = {
    type: 'object',
    fields: {
      '<entry>': {
        type: 'object',
        fields: {
          costUSD: 'number',
          inputTokens: 'number',
          outputTokens: 'number',
        },
      },
    },
  };

  const jsonSignature = createOutputSignature({
    stdout: JSON.stringify({
      type: 'result',
      modelUsage: {
        'claude-sonnet-4-6': {
          costUSD: 0.01,
          inputTokens: 3,
          outputTokens: 13,
        },
      },
    }),
  });

  assert.deepEqual(jsonSignature.stdoutShape.fields.modelUsage, modelUsageShape);

  const jsonlSignature = createOutputSignature({
    stdout: [
      JSON.stringify({
        type: 'result',
        modelUsage: {
          'claude-haiku-4-5-20251001': {
            costUSD: 0.01,
            inputTokens: 3,
            outputTokens: 13,
          },
          'claude-sonnet-4-6': {
            costUSD: 0.02,
            inputTokens: 5,
            outputTokens: 17,
          },
        },
      }),
      JSON.stringify({
        type: 'result',
        modelUsage: {
          'claude-sonnet-4-6': {
            costUSD: 0.02,
            inputTokens: 5,
            outputTokens: 17,
          },
        },
      }),
    ].join('\n'),
  });

  assert.equal(jsonlSignature.kind, 'jsonl');
  assert.equal(jsonlSignature.stdoutLineShapes.length, 1);
  assert.deepEqual(jsonlSignature.stdoutLineShapes[0].fields.modelUsage, modelUsageShape);
});

test('compat baseline comparison ignores agents outside the current report', () => {
  const report = {
    agents: [
      {
        agent: 'codex',
        version: 'codex-cli 0.142.2',
        probes: [
          {
            id: 'text',
            parser: { parserId: 'codex-text-v1', promptMode: 'positional' },
            result: { signature: { kind: 'text', stdoutPresent: true, stderrPresent: true } },
          },
        ],
      },
    ],
  };
  const baseline = {
    entries: {
      'codex/text': {
        agent: 'codex',
        probe: 'text',
        version: 'codex-cli 0.142.2',
        parserId: 'codex-text-v1',
        promptMode: 'positional',
        signature: { kind: 'text', stdoutPresent: true, stderrPresent: true },
      },
      'claude/text': {
        agent: 'claude',
        probe: 'text',
        version: '2.1.191 (Claude Code)',
        parserId: 'generic-text-v1',
        promptMode: 'print-positional',
        signature: { kind: 'text', stdoutPresent: true, stderrPresent: false },
      },
    },
  };

  assert.deepEqual(compareBaseline(report, baseline), []);
});

test('compat baseline comparison tolerates missing optional jsonl shapes', () => {
  const report = {
    agents: [
      {
        agent: 'codex',
        version: 'codex-cli 0.142.2',
        probes: [
          {
            id: 'json',
            parser: { parserId: 'codex-jsonl-v1', promptMode: 'positional' },
            result: {
              signature: {
                kind: 'jsonl',
                stdoutLineShapes: [
                  { type: 'object', fields: { type: 'string' } },
                ],
                stderrPresent: true,
              },
            },
          },
        ],
      },
    ],
  };
  const baseline = {
    entries: {
      'codex/json': {
        agent: 'codex',
        probe: 'json',
        version: 'codex-cli 0.142.2',
        parserId: 'codex-jsonl-v1',
        promptMode: 'positional',
        signature: {
          kind: 'jsonl',
          stdoutLineShapes: [
            { type: 'object', fields: { item: 'object', type: 'string' } },
            { type: 'object', fields: { type: 'string' } },
          ],
          stderrPresent: true,
        },
      },
    },
  };

  assert.deepEqual(compareBaseline(report, baseline), []);
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
