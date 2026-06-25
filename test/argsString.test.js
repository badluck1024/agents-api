const test = require('node:test');
const assert = require('node:assert/strict');

const { joinRemainingArgs, splitArgsString } = require('../src/argsString');

test('splitArgsString splits whitespace-delimited arguments', () => {
  assert.deepEqual(
    splitArgsString('--json --model gpt-5.5 --skip-git-repo-check'),
    ['--json', '--model', 'gpt-5.5', '--skip-git-repo-check']
  );
});

test('splitArgsString preserves quoted values and escaped quotes', () => {
  assert.deepEqual(
    splitArgsString('--model "claude opus" -c model_reasoning_effort=\\"xhigh\\"'),
    ['--model', 'claude opus', '-c', 'model_reasoning_effort="xhigh"']
  );
});

test('splitArgsString throws on unclosed quotes', () => {
  assert.throws(
    () => splitArgsString('--model "gpt-5.5'),
    /Unclosed quote/
  );
});

test('joinRemainingArgs joins prompt fragments', () => {
  assert.equal(
    joinRemainingArgs(['--agent', 'codex', 'Write', 'only', 'HELLO'], 2),
    'Write only HELLO'
  );
});
