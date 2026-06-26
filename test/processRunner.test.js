const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareCommand, runProcess } = require('../src/processRunner');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-process-'));
}

test('prepareCommand resolves Windows cmd shims that launch an executable directly', {
  skip: process.platform !== 'win32',
}, () => {
  const directory = createTempDir();

  try {
    const commandPath = path.join(directory, 'claude.cmd');
    const executablePath = path.join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');
    fs.writeFileSync(
      commandPath,
      [
        '@ECHO off',
        'SET dp0=%~dp0',
        '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
        '',
      ].join('\r\n'),
      'utf8'
    );

    assert.deepEqual(
      prepareCommand(commandPath, ['-p', 'line 1\nline 2'], process.env),
      {
        command: executablePath,
        args: ['-p', 'line 1\nline 2'],
      }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('prepareCommand resolves Windows npm cmd shims that launch JavaScript through node', {
  skip: process.platform !== 'win32',
}, () => {
  const directory = createTempDir();

  try {
    const commandPath = path.join(directory, 'codex.cmd');
    const scriptPath = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const nodePath = path.join(directory, 'node.exe');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '');
    fs.writeFileSync(nodePath, '');
    fs.writeFileSync(
      commandPath,
      [
        '@ECHO off',
        'SET dp0=%~dp0',
        '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        '',
      ].join('\r\n'),
      'utf8'
    );

    assert.deepEqual(
      prepareCommand(commandPath, ['exec', 'prompt'], process.env),
      {
        command: nodePath,
        args: [scriptPath, 'exec', 'prompt'],
      }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runProcess writes input to child stdin', async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ['-e', 'process.stdin.on("data", c => process.stdout.write("IN:" + c))'],
    input: 'hello\nworld',
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'IN:hello\nworld');
});
