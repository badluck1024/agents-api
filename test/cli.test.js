const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCli } = require('../src/cli');
const { loadConfig } = require('../src/config');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-cli-test-'));
}

function withAgentsApiHome(directory) {
  const previous = process.env.AGENTSAPI_HOME;
  process.env.AGENTSAPI_HOME = directory;
  return () => {
    if (previous === undefined) {
      delete process.env.AGENTSAPI_HOME;
    } else {
      process.env.AGENTSAPI_HOME = previous;
    }
  };
}

async function captureStdout(fn) {
  const previousLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    await fn();
  } finally {
    console.log = previousLog;
  }

  return lines;
}

test('config default CLI commands manage fallback agent', async () => {
  const directory = createTempDir();
  const restoreHome = withAgentsApiHome(directory);

  try {
    await captureStdout(() => runCli(['config', 'default', 'set', 'claude']));
    assert.equal(loadConfig().defaultAgent, 'claude');

    const getLines = await captureStdout(() => runCli(['config', 'default', 'get']));
    assert.deepEqual(getLines, ['claude']);

    await captureStdout(() => runCli(['config', 'default', 'clear']));
    assert.equal(loadConfig().defaultAgent, '');
  } finally {
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
