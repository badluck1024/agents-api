const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAgentArgs, buildAgentInvocation } = require('../src/agentRunner');
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

test('buildAgentInvocation sends multiline codex prompts through stdin', () => {
  const invocation = buildAgentInvocation('codex', '--json', 'Line one\nLine two');

  assert.deepEqual(invocation.args, ['exec', '--json', '-']);
  assert.equal(invocation.agentPrompt, 'Line one\nLine two');
  assert.equal(invocation.promptTransport, 'stdin');
  assert.equal(invocation.stdin, 'Line one\nLine two');
});

test('buildAgentArgs adds run files to codex command arguments', () => {
  const runFiles = {
    directory: '/tmp/agents-api-run',
    files: [
      {
        absolutePath: '/tmp/agents-api-run/diagram.png',
        agentPath: '/tmp/agents-api-run/diagram.png',
        isImage: true,
        path: 'diagram.png',
        runPath: 'agents-api-run-files/run-1/diagram.png',
        size: 3,
      },
    ],
  };
  const invocation = buildAgentInvocation('codex', '--json', 'Inspect the diagram', { runFiles });

  assert.deepEqual(invocation.args, [
    'exec',
    '--json',
    '--image=/tmp/agents-api-run/diagram.png',
    '-',
  ]);
  assert.equal(invocation.agentPrompt, invocation.stdin);
  assert.equal(invocation.promptTransport, 'stdin');
  assert.match(invocation.stdin, /^Uploaded request files saved locally for this run:/);
  assert.match(invocation.stdin, /User prompt:\nInspect the diagram$/);
  assert.match(invocation.stdin, /Alias from request: "diagram\.png"/);
  assert.match(invocation.stdin, /Staged filesystem path to read: "\/tmp\/agents-api-run\/diagram\.png"/);
});

test('buildAgentArgs adds run files to claude command arguments', () => {
  const runFiles = {
    directory: '/tmp/agents-api-run',
    files: [
      {
        absolutePath: '/tmp/agents-api-run/notes.txt',
        agentPath: '/tmp/agents-api-run/notes.txt',
        isImage: false,
        path: 'notes.txt',
        runPath: 'agents-api-run-files/run-1/notes.txt',
        size: 5,
      },
    ],
  };
  const args = buildAgentArgs('claude', '--output-format text', 'Summarize', { runFiles });

  assert.deepEqual(args.slice(0, -1), [
    '-p',
    '--output-format',
    'text',
  ]);
  assert.match(args.at(-1), /Alias from request: "notes\.txt"/);
  assert.match(args.at(-1), /Staged filesystem path to read: "\/tmp\/agents-api-run\/notes\.txt"/);
});

test('buildAgentArgs adds run files to antigravity command arguments', () => {
  const runFiles = {
    directory: '/tmp/agents-api-run',
    files: [
      {
        absolutePath: '/tmp/agents-api-run/spec.md',
        agentPath: '/tmp/agents-api-run/spec.md',
        isImage: false,
        path: 'spec.md',
        runPath: 'agents-api-run-files/run-1/spec.md',
        size: 8,
      },
    ],
  };
  const args = buildAgentArgs('antigravity', '--model gemini-3.5-flash', 'Review', { runFiles });

  assert.deepEqual(args.slice(0, -1), [
    '--model',
    'gemini-3.5-flash',
    '--print',
  ]);
  assert.match(args.at(-1), /Alias from request: "spec\.md"/);
  assert.match(args.at(-1), /Staged filesystem path to read: "\/tmp\/agents-api-run\/spec\.md"/);
});

test('buildAgentArgs keeps codex resume file args compatible', () => {
  const runFiles = {
    directory: '/tmp/agents-api-run',
    files: [
      {
        absolutePath: '/tmp/agents-api-run/notes.txt',
        agentPath: '/tmp/agents-api-run/notes.txt',
        isImage: false,
        path: 'notes.txt',
        runPath: 'agents-api-run-files/run-1/notes.txt',
        size: 5,
      },
    ],
  };
  const invocation = buildAgentInvocation('codex', '--json', 'Continue', {
    sessionId: '019-session',
    runFiles,
  });

  assert.deepEqual(invocation.args, ['exec', '--json', 'resume', '019-session', '-']);
  assert.equal(invocation.promptTransport, 'stdin');
  assert.match(invocation.stdin, /Alias from request: "notes\.txt"/);
  assert.match(invocation.stdin, /Staged filesystem path to read: "\/tmp\/agents-api-run\/notes\.txt"/);
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
