const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkAgentReady, readConfiguredGeminiAuth } = require('../src/agentHealth');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-health-test-'));
}

function createFakeGeminiCommand(directory) {
  const logPath = path.join(directory, 'gemini-args.log');
  const scriptPath = path.join(directory, 'gemini-agent.js');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, args.join(' ') + '\\n');
if (args.includes('--version')) {
  console.log('0.46.0');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.error('auth command should not be called');
  process.exit(9);
}
process.exit(0);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return { command: scriptPath, logPath };
  }

  const commandPath = path.join(directory, 'gemini-agent.cmd');
  fs.writeFileSync(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return { command: commandPath, logPath };
}

function createHangingGeminiCommand(directory) {
  const scriptPath = path.join(directory, 'hanging-gemini-agent.js');
  const script = `#!/usr/bin/env node
setTimeout(() => {}, 60 * 1000);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  const commandPath = path.join(directory, 'hanging-gemini-agent.cmd');
  fs.writeFileSync(commandPath, '@echo off\r\nping -n 60 127.0.0.1 >nul\r\n', 'utf8');
  return commandPath;
}

test('readConfiguredGeminiAuth detects environment auth methods', () => {
  const firstHome = createTempDir();
  const firstCwd = createTempDir();
  const secondHome = createTempDir();
  const secondCwd = createTempDir();

  try {
    assert.deepEqual(
      readConfiguredGeminiAuth({ env: { GEMINI_API_KEY: 'test-key' }, homeDir: firstHome, cwd: firstCwd }),
      { type: 'gemini-api-key', source: 'GEMINI_API_KEY' }
    );

    assert.deepEqual(
      readConfiguredGeminiAuth({ env: { GOOGLE_GENAI_USE_VERTEXAI: 'true' }, homeDir: secondHome, cwd: secondCwd }),
      { type: 'vertex-ai', source: 'GOOGLE_GENAI_USE_VERTEXAI' }
    );
  } finally {
    fs.rmSync(firstHome, { recursive: true, force: true });
    fs.rmSync(firstCwd, { recursive: true, force: true });
    fs.rmSync(secondHome, { recursive: true, force: true });
    fs.rmSync(secondCwd, { recursive: true, force: true });
  }
});

test('readConfiguredGeminiAuth detects Gemini settings auth method', () => {
  const directory = createTempDir();
  const cwd = createTempDir();
  const geminiDir = path.join(directory, '.gemini');
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(
    path.join(geminiDir, 'settings.json'),
    JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
    'utf8'
  );

  try {
    assert.deepEqual(
      readConfiguredGeminiAuth({ env: {}, homeDir: directory, cwd }),
      { type: 'oauth-personal', source: path.join(geminiDir, 'settings.json') }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('checkAgentReady uses configured Gemini auth without running auth status command', async () => {
  const directory = createTempDir();
  const { command, logPath } = createFakeGeminiCommand(directory);
  const homeDir = createTempDir();
  const cwd = createTempDir();

  try {
    const status = await checkAgentReady('gemini', { command }, {
      env: { GEMINI_API_KEY: 'test-key' },
      homeDir,
      cwd,
    });

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.ready, true);
    assert.equal(status.version, '0.46.0');
    assert.match(status.authStatus, /GEMINI_API_KEY/);
    assert.equal(fs.readFileSync(logPath, 'utf8').trim(), '--version');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('checkAgentReady evaluates configured Gemini auth when version check times out', async () => {
  const directory = createTempDir();
  const command = createHangingGeminiCommand(directory);
  const homeDir = createTempDir();
  const cwd = createTempDir();

  try {
    const status = await checkAgentReady('gemini', { command }, {
      env: { GEMINI_API_KEY: 'test-key' },
      homeDir,
      cwd,
      timeoutMs: 25,
    });

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.ready, true);
    assert.equal(status.version, '');
    assert.match(status.warning, /timed out/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
