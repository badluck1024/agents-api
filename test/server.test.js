const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createServer } = require('../src/server');
const { defaultConfig, saveConfig } = require('../src/config');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-test-'));
}

function createFakeAgentCommand(directory, agentId) {
  const scriptPath = path.join(directory, `${agentId}-agent.js`);
  const script = `#!/usr/bin/env node
const fs = require('fs');
const agentId = ${JSON.stringify(agentId)};
const args = process.argv.slice(2);
const prompt = args[args.length - 1] === '-'
  ? fs.readFileSync(0, 'utf8')
  : args[args.length - 1] || '';
function optionValue(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || '';
  const inline = args.find((arg) => arg.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : '';
}
if (args.includes('--fail')) {
  console.error('fake failure');
  process.exit(2);
}
if (args.includes('--hang')) {
  setTimeout(() => {}, 60 * 1000);
  return;
}
function runFileText() {
  const line = prompt
    .split(String.fromCharCode(10))
    .map((value) => value.replace(/\\r$/, ''))
    .find((value) => value.trim().startsWith('Staged filesystem path to read: '));
  if (!line) return 'NO_FILE_PATH';
  const filePath = line.slice(line.indexOf(': ') + 2).trim().replace(/^"|"$/g, '');
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    return 'READ_ERROR:' + error.message;
  }
}
if (args.includes('--read-run-file')) {
  const text = 'FILE:' + runFileText();
  if (agentId === 'codex') {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 2 } }));
  } else {
    console.log(text);
  }
  process.exit(0);
}
if (agentId === 'codex') {
  console.error('Reading additional input from stdin...');
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ACK:' + prompt } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 2 } }));
  process.exit(0);
}
if (agentId === 'claude') {
  const outputFormat = optionValue('--output-format') || 'text';
  if (outputFormat === 'json') {
    console.log(JSON.stringify({ type: 'result', result: 'ACK:' + prompt, session_id: 'fake-claude', num_turns: 1 }));
  } else {
    console.log('ACK:' + prompt);
  }
  process.exit(0);
}
if (agentId === 'antigravity') {
  console.log('ACK:' + prompt);
  process.exit(0);
}
console.log('ACK:' + prompt);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  const commandPath = path.join(directory, `${agentId}-agent.cmd`);
  fs.writeFileSync(commandPath, `@echo off\r\n"%dp0%\\${path.basename(scriptPath)}" %*\r\n`, 'utf8');
  return commandPath;
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request({ port, path: requestPath, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += String(chunk || '');
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          text,
          json: text.trim() && res.headers['content-type'] && res.headers['content-type'].includes('application/json')
            ? JSON.parse(text)
            : null,
        });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function escapeMultipartValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createMultipartBody({ requestBody, files }) {
  const boundary = `agentsapi-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];

  function push(value) {
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
  }

  push(`--${boundary}\r\n`);
  push('Content-Disposition: form-data; name="request"\r\n');
  push('Content-Type: application/json\r\n\r\n');
  push(JSON.stringify(requestBody));
  push('\r\n');

  for (const file of files) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="files"; filename="${escapeMultipartValue(file.filename)}"\r\n`);
    push(`Content-Type: ${file.mimeType || 'application/octet-stream'}\r\n\r\n`);
    push(file.content);
    push('\r\n');
  }

  push(`--${boundary}--\r\n`);

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function multipartRequest({ port, path: requestPath, requestBody, files, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = createMultipartBody({ requestBody, files });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'Content-Type': payload.contentType,
        'Content-Length': payload.body.length,
        ...headers,
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += String(chunk || '');
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          text,
          json: text.trim() && res.headers['content-type'] && res.headers['content-type'].includes('application/json')
            ? JSON.parse(text)
            : null,
        });
      });
    });
    req.on('error', reject);
    req.end(payload.body);
  });
}

function parseSseEvents(text) {
  return String(text || '')
    .trim()
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split(/\n/).find((line) => line.startsWith('event: '));
      const dataLine = block.split(/\n/).find((line) => line.startsWith('data: '));
      return {
        event: eventLine ? eventLine.slice('event: '.length) : '',
        data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
      };
    });
}

function createProjectAgents() {
  return {
    codex: { config: '' },
    claude: { config: '' },
    antigravity: { config: '' },
  };
}

function writeConfig({
  directory,
  apiKey = '',
  agentId = 'codex',
  agentConfig = '',
  command,
  defaultAgent = '',
  includePrompt = true,
  loggingLevel = 'off',
  loggingRequests = false,
  projectId = '',
  projectWorkingDir = '',
}) {
  const restoreHome = withAgentsApiHome(directory);
  const config = defaultConfig();
  config.logging.level = loggingLevel;
  config.logging.requests = loggingRequests;
  config.logging.includePrompt = includePrompt;
  config.auth.apiKey = apiKey;
  config.defaultAgent = defaultAgent;
  config.agents[agentId].command = command;
  config.agents[agentId].config = agentConfig;
  if (projectId) {
    config.projects[projectId] = {
      id: projectId,
      workingDir: projectWorkingDir,
      agents: createProjectAgents(),
    };
  }
  saveConfig(config);
  return restoreHome;
}

async function captureConsoleLog(fn) {
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

test('POST /api/runs requires bearer auth when API key is configured', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    apiKey: 'test-token',
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const unauthorized = await request({
      port,
      path: '/api/runs',
      body: { agent: 'codex', prompt: 'HELLO' },
    });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await request({
      port,
      path: '/api/runs',
      headers: { Authorization: 'Bearer test-token' },
      body: { agent: 'codex', prompt: 'HELLO' },
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.json.output, 'ACK:HELLO');
    assert.equal(authorized.json.sessionId, 'fake-thread');
    assert.equal(authorized.json.usage.output_tokens, 2);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs uses configured default agent when request omits agent and provider', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
    defaultAgent: 'codex',
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { prompt: 'HELLO' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.agent, 'codex');
    assert.equal(response.json.output, 'ACK:HELLO');
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs requires agent, provider, or configured default agent', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { prompt: 'HELLO' },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /defaultAgent/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs returns normalized claude json output', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'claude');
  const restoreHome = writeConfig({
    directory,
    agentId: 'claude',
    agentConfig: '--output-format json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { agent: 'claude', prompt: 'HELLO' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.output, 'ACK:HELLO');
    assert.equal(response.json.sessionId, 'fake-claude');
    assert.equal(response.json.usage.num_turns, 1);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs passes sessionId to codex resume command', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: {
        agent: 'codex',
        prompt: 'Continue',
        sessionId: '019-session',
        responseMode: 'raw',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.sessionId, '019-session');
    assert.deepEqual(response.json.args, ['exec', '--json', 'resume', '019-session', 'Continue']);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs rejects invalid sessionId', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { agent: 'codex', prompt: 'HELLO', sessionId: '' },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /sessionId/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs terminates agent after timeoutMs', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'antigravity');
  const restoreHome = writeConfig({
    directory,
    agentId: 'antigravity',
    agentConfig: '--hang',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: {
        agent: 'antigravity',
        prompt: 'HELLO',
        timeoutMs: 25,
        responseMode: 'raw',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.timedOut, true);
    assert.match(response.json.stderr, /timed out/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs rejects invalid timeoutMs', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { agent: 'codex', prompt: 'HELLO', timeoutMs: 0 },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /timeoutMs/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs terminates silent agent after idleTimeoutMs', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'antigravity');
  const restoreHome = writeConfig({
    directory,
    agentId: 'antigravity',
    agentConfig: '--hang',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: {
        agent: 'antigravity',
        prompt: 'HELLO',
        idleTimeoutMs: 25,
        responseMode: 'raw',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.idleTimedOut, true);
    assert.match(response.json.stderr, /no output/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs rejects invalid idleTimeoutMs', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: { agent: 'codex', prompt: 'HELLO', idleTimeoutMs: 0 },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /idleTimeoutMs/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs accepts files and passes them to the agent command', async () => {
  const directory = createTempDir();
  const projectDir = createTempDir();
  const command = createFakeAgentCommand(directory, 'claude');
  const restoreHome = writeConfig({
    directory,
    agentId: 'claude',
    agentConfig: '--output-format text',
    command,
    projectId: 'demo',
    projectWorkingDir: projectDir,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: {
        agent: 'claude',
        project: 'demo',
        prompt: 'Summarize',
        responseMode: 'raw',
        files: [
          {
            path: 'notes.txt',
            content: 'hello',
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.files[0].path, 'notes.txt');
    assert.equal(response.json.files[0].size, 5);
    const addDirArg = response.json.args.find((arg) => arg.startsWith('--add-dir='));
    assert.equal(addDirArg, undefined);
    assert.match(response.json.args.at(-1), /Uploaded request files saved locally for this run:/);
    assert.match(response.json.args.at(-1), /Staged filesystem path to read:/);
    assert.match(response.json.args.at(-1), /notes\.txt/);
    assert.match(response.json.files[0].runPath, /attachment-1\.txt$/);
    assert.equal(fs.existsSync(path.join(projectDir, 'agents-api-run-files')), false);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('POST /api/runs debug logs include the full agent prompt', async () => {
  const directory = createTempDir();
  const projectDir = createTempDir();
  const command = createFakeAgentCommand(directory, 'claude');
  const restoreHome = writeConfig({
    directory,
    agentId: 'claude',
    agentConfig: '--output-format text',
    command,
    loggingLevel: 'debug',
    projectId: 'demo',
    projectWorkingDir: projectDir,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const logs = await captureConsoleLog(async () => {
      const response = await request({
        port,
        path: '/api/runs',
        body: {
          agent: 'claude',
          project: 'demo',
          prompt: 'Summarize',
          files: [
            {
              path: 'notes.txt',
              content: 'hello',
            },
          ],
        },
      });

      assert.equal(response.statusCode, 200);
    });

    const text = logs.join('\n');
    assert.match(text, /DEBUG\s+Agent prompt/);
    assert.match(text, /promptTransport=argument/);
    assert.match(text, /Uploaded request files saved locally for this run:/);
    assert.match(text, /Staged filesystem path to read:/);
    assert.match(text, /User prompt:/);
    assert.match(text, /Summarize/);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('POST /api/runs rejects unsafe file paths', async () => {
  const directory = createTempDir();
  const projectDir = createTempDir();
  const command = createFakeAgentCommand(directory, 'codex');
  const restoreHome = writeConfig({
    directory,
    agentId: 'codex',
    agentConfig: '--json',
    command,
    projectId: 'demo',
    projectWorkingDir: projectDir,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs',
      body: {
        agent: 'codex',
        project: 'demo',
        prompt: 'HELLO',
        files: [
          {
            path: '../secret.txt',
            content: 'x',
          },
        ],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /Run file paths/);
    assert.equal(fs.existsSync(path.join(projectDir, 'agents-api-run-files')), false);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function fileReadConfig(agentId) {
  if (agentId === 'codex') {
    return '--json --read-run-file';
  }

  if (agentId === 'claude') {
    return '--output-format text --read-run-file';
  }

  return '--read-run-file';
}

for (const agentId of ['codex', 'claude', 'antigravity']) {
  test(`POST /api/runs multipart files are readable by ${agentId}`, async () => {
    const directory = createTempDir();
    const projectDir = createTempDir();
    const sourcePath = path.join(directory, `${agentId}-source.txt`);
    const fileText = `attached text for ${agentId}`;
    fs.writeFileSync(sourcePath, fileText, 'utf8');
    fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'docs', 'input.txt'), `wrong local text for ${agentId}`, 'utf8');
    const command = createFakeAgentCommand(directory, agentId);
    const restoreHome = writeConfig({
      directory,
      agentId,
      agentConfig: fileReadConfig(agentId),
      command,
      projectId: 'demo',
      projectWorkingDir: projectDir,
    });
    const server = createServer();

    try {
      const port = await listen(server);
      const response = await multipartRequest({
        port,
        path: '/api/runs',
        requestBody: {
          agent: agentId,
          project: 'demo',
          prompt: 'Read the attached text file.',
          responseMode: 'normalized',
        },
        files: [
          {
            filename: 'docs/input.txt',
            content: fs.readFileSync(sourcePath),
            mimeType: 'text/plain',
          },
        ],
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json.output, `FILE:${fileText}`);
      assert.equal(response.json.files[0].path, path.join('docs', 'input.txt'));
      assert.match(response.json.files[0].runPath, /attachment-1\.txt$/);
      assert.equal(response.json.files[0].size, Buffer.byteLength(fileText));
      assert.equal(fs.existsSync(path.join(projectDir, 'agents-api-run-files')), false);
    } finally {
      await closeServer(server);
      restoreHome();
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
}

test('POST /api/runs/stream returns normalized antigravity text output', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'antigravity');
  const restoreHome = writeConfig({
    directory,
    agentId: 'antigravity',
    agentConfig: '',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs/stream',
      body: { agent: 'antigravity', prompt: 'HELLO' },
    });
    const events = parseSseEvents(response.text);

    assert.equal(response.statusCode, 200);
    assert.equal(events[0].event, 'start');
    assert.deepEqual(
      events.filter((entry) => entry.event === 'output').map((entry) => entry.data.text.trim()),
      ['ACK:HELLO']
    );
    assert.equal(events.at(-1).event, 'exit');
    assert.equal(events.at(-1).data.output, 'ACK:HELLO');
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs/stream includes requested sessionId', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'claude');
  const restoreHome = writeConfig({
    directory,
    agentId: 'claude',
    agentConfig: '--output-format text',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs/stream',
      body: {
        agent: 'claude',
        prompt: 'Continue',
        sessionId: 'claude-session',
        responseMode: 'raw',
      },
    });
    const events = parseSseEvents(response.text);

    assert.equal(response.statusCode, 200);
    assert.equal(events[0].event, 'start');
    assert.equal(events[0].data.sessionId, 'claude-session');
    assert.deepEqual(events[0].data.args, [
      '-p',
      '--resume',
      'claude-session',
      '--output-format',
      'text',
      'Continue',
    ]);
    assert.equal(events.at(-1).event, 'exit');
    assert.equal(events.at(-1).data.sessionId, 'claude-session');
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
