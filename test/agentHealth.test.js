const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkAgentReady } = require('../src/agentHealth');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-health-test-'));
}

function createFakeAntigravityCommand(directory) {
  const logPath = path.join(directory, 'antigravity-args.log');
  const scriptPath = path.join(directory, 'antigravity-agent.js');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, args.join(' ') + '\\n');
if (args.includes('--version')) {
  console.log('1.0.12');
  process.exit(0);
}
if (args[0] === 'models') {
  console.log('Gemini 3.5 Flash');
  process.exit(0);
}
process.exit(0);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return { command: scriptPath, logPath };
  }

  const commandPath = path.join(directory, 'antigravity-agent.cmd');
  fs.writeFileSync(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return { command: commandPath, logPath };
}

function createHangingAntigravityCommand(directory) {
  const scriptPath = path.join(directory, 'hanging-antigravity-agent.js');
  const script = `#!/usr/bin/env node
setTimeout(() => {}, 60 * 1000);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  const commandPath = path.join(directory, 'hanging-antigravity-agent.cmd');
  fs.writeFileSync(commandPath, '@echo off\r\nping -n 60 127.0.0.1 >nul\r\n', 'utf8');
  return commandPath;
}

test('checkAgentReady verifies Antigravity auth with models command', async () => {
  const directory = createTempDir();
  const { command, logPath } = createFakeAntigravityCommand(directory);
  const homeDir = createTempDir();
  const cwd = createTempDir();

  try {
    const status = await checkAgentReady('antigravity', { command }, {
      env: {},
      homeDir,
      cwd,
    });

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.ready, true);
    assert.equal(status.version, '1.0.12');
    assert.match(status.authStatus, /Gemini 3\.5 Flash/);
    assert.equal(fs.readFileSync(logPath, 'utf8').trim(), '--version\nmodels');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('checkAgentReady reports installed but unavailable Antigravity when version check times out', async () => {
  const directory = createTempDir();
  const command = createHangingAntigravityCommand(directory);
  const homeDir = createTempDir();
  const cwd = createTempDir();

  try {
    const status = await checkAgentReady('antigravity', { command }, {
      env: {},
      homeDir,
      cwd,
      timeoutMs: 25,
    });

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.ready, false);
    assert.equal(status.version, '');
    assert.match(status.error, /timed out/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
