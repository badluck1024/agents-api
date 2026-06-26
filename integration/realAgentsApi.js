const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { checkAgentReady } = require('../src/agentHealth');
const { createServer } = require('../src/server');
const { defaultConfig, saveConfig } = require('../src/config');

const DEFAULT_TIMEOUT_MS = Number(process.env.AGENTSAPI_REAL_TEST_TIMEOUT_MS || 120000);
const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.AGENTSAPI_REAL_TEST_IDLE_TIMEOUT_MS || 60000);
const CLIENT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS + 30000;

const AGENT_CASES = [
  { agentId: 'codex', noFileConfig: '--json --skip-git-repo-check', uploadConfig: '--json --skip-git-repo-check' },
  { agentId: 'claude', noFileConfig: '--output-format json', uploadConfig: '--output-format json' },
  { agentId: 'antigravity', noFileConfig: '', uploadConfig: '' },
];

const API_CASES = [
  { name: 'non-stream JSON request without files', endpoint: '/api/runs', stream: false, upload: false },
  { name: 'non-stream multipart request with file upload', endpoint: '/api/runs', stream: false, upload: true },
  { name: 'stream JSON request without files', endpoint: '/api/runs/stream', stream: true, upload: false },
  { name: 'stream multipart request with file upload', endpoint: '/api/runs/stream', stream: true, upload: true },
];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-real-'));
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

function createProjectAgents() {
  return {
    codex: { config: '' },
    claude: { config: '' },
    antigravity: { config: '' },
  };
}

function windowsAntigravityFallback() {
  if (process.platform !== 'win32') {
    return '';
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const executable = path.join(localAppData, 'agy', 'bin', 'agy.exe');
  return fs.existsSync(executable) ? executable : '';
}

function voltaCommand(command) {
  if (process.platform === 'win32') {
    return '';
  }

  const executable = path.join(os.homedir(), '.volta', 'bin', command);
  return fs.existsSync(executable) ? executable : '';
}

function resolveRealAgentCommand(agentId) {
  const config = defaultConfig();
  const configured = config.agents[agentId].command;
  const volta = voltaCommand(configured);
  if (volta) {
    return volta;
  }

  if (agentId === 'antigravity' && configured === 'agy') {
    return windowsAntigravityFallback() || configured;
  }
  return configured;
}

async function assertRealAgentReady(agentId, command, cwd) {
  const status = await checkAgentReady(agentId, { command }, {
    cwd,
    timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, 30000),
  });

  assert.equal(
    status.ready,
    true,
    [
      `${agentId} is not ready for real integration tests.`,
      `command: ${command}`,
      `installed: ${status.installed}`,
      `authenticated: ${status.authenticated}`,
      `version: ${status.version || ''}`,
      `error: ${status.error || ''}`,
    ].join('\n')
  );

  return status;
}

function writeConfig({ directory, commandByAgent, projectDir }) {
  const restoreHome = withAgentsApiHome(directory);
  const config = defaultConfig();
  config.logging.level = 'off';
  config.logging.requests = false;
  for (const [agentId, command] of Object.entries(commandByAgent)) {
    config.agents[agentId].command = command;
    config.agents[agentId].config = '';
  }
  config.projects.real = {
    id: 'real',
    workingDir: projectDir,
    agents: createProjectAgents(),
  };
  saveConfig(config);
  return restoreHome;
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

function jsonRequest({ port, endpoint, body }) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return httpRequest({
    port,
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
    },
    payload,
  });
}

function escapeMultipartValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createMultipartBody({ requestBody, files }) {
  const boundary = `agentsapi-real-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
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

function multipartRequest({ port, endpoint, requestBody, files }) {
  const multipart = createMultipartBody({ requestBody, files });
  return httpRequest({
    port,
    endpoint,
    headers: {
      'Content-Type': multipart.contentType,
      'Content-Length': multipart.body.length,
    },
    payload: multipart.body,
  });
}

function httpRequest({ port, endpoint, headers, payload }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: endpoint,
      method: 'POST',
      headers,
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
          json: text.trim() && String(res.headers['content-type'] || '').includes('application/json')
            ? JSON.parse(text)
            : null,
        });
      });
    });

    req.setTimeout(CLIENT_TIMEOUT_MS, () => {
      req.destroy(new Error(`HTTP request timed out after ${CLIENT_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function parseSseEvents(text) {
  return String(text || '')
    .trim()
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/);
      const eventLine = lines.find((line) => line.startsWith('event: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      return {
        event: eventLine ? eventLine.slice('event: '.length) : '',
        data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
      };
    });
}

function assertContainsMarker(text, marker, context) {
  assert.match(
    String(text || ''),
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${context} did not include expected marker ${marker}. Output:\n${text}`
  );
}

function assertDoesNotContainWorkspaceMarker(text, workspaceMarker, context) {
  assert.equal(
    String(text || '').includes(workspaceMarker),
    false,
    `${context} included workspace-only marker ${workspaceMarker}. Output:\n${text}`
  );
}

function assertRunResponse(response, marker, workspaceMarker, { upload }) {
  assert.equal(response.statusCode, 200, response.text);
  assert.equal(response.headers['content-type'].includes('application/json'), true);
  assert.equal(response.json.ok, true, JSON.stringify(response.json, null, 2));
  assert.equal(response.json.timedOut, false);
  assert.equal(response.json.idleTimedOut, false);
  assertContainsMarker(response.json.output, marker, 'normalized /api/runs output');

  if (upload) {
    assertDoesNotContainWorkspaceMarker(response.json.output, workspaceMarker, 'normalized /api/runs output');
    assert.equal(response.json.files.length, 1);
    assert.equal(response.json.files[0].path, path.join('docs', 'real-brief.txt'));
    assert.equal(response.json.files[0].stagedPath, 'attachment-1.txt');
  } else {
    assert.equal(response.json.files, undefined);
  }
}

function assertStreamResponse(response, marker, workspaceMarker, { upload }) {
  assert.equal(response.statusCode, 200, response.text);
  assert.equal(response.headers['content-type'].includes('text/event-stream'), true);

  const events = parseSseEvents(response.text);
  assert.equal(events[0].event, 'start');
  assert.equal(events.at(-1).event, 'exit');
  assert.equal(events.at(-1).data.ok, true, JSON.stringify(events.at(-1).data, null, 2));
  assert.equal(events.at(-1).data.timedOut, false);
  assert.equal(events.at(-1).data.idleTimedOut, false);
  assertContainsMarker(events.at(-1).data.output, marker, 'normalized /api/runs/stream exit output');

  if (upload) {
    assertDoesNotContainWorkspaceMarker(
      events.at(-1).data.output,
      workspaceMarker,
      'normalized /api/runs/stream exit output'
    );
  }
}

async function callRunApi({ port, apiCase, agentCase, marker }) {
  const config = apiCase.upload ? agentCase.uploadConfig : agentCase.noFileConfig;
  const prompt = apiCase.upload
    ? 'Read docs/real-brief.txt from the uploaded files and return only the exact file content.'
    : `Return only this exact token: ${marker}`;

  const requestBody = {
    agent: agentCase.agentId,
    project: 'real',
    config,
    prompt,
    responseMode: 'normalized',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  };

  if (!apiCase.upload) {
    return jsonRequest({
      port,
      endpoint: apiCase.endpoint,
      body: requestBody,
    });
  }

  return multipartRequest({
    port,
    endpoint: apiCase.endpoint,
    requestBody,
    files: [
      {
        filename: 'docs/real-brief.txt',
        content: Buffer.from(marker, 'utf8'),
        mimeType: 'text/plain',
      },
    ],
  });
}

test('real agent CLIs are installed and authenticated', async (t) => {
  const projectDir = createTempDir();

  try {
    for (const agentCase of AGENT_CASES) {
      const command = resolveRealAgentCommand(agentCase.agentId);
      const status = await assertRealAgentReady(agentCase.agentId, command, projectDir);
      t.diagnostic(`${agentCase.agentId}: ${status.version}`);
    }
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

for (const agentCase of AGENT_CASES) {
  for (const apiCase of API_CASES) {
    test(`real API matrix: ${agentCase.agentId} ${apiCase.name}`, async () => {
      const stateDir = createTempDir();
      const projectDir = createTempDir();
      const commandByAgent = Object.fromEntries(
        AGENT_CASES.map((item) => [item.agentId, resolveRealAgentCommand(item.agentId)])
      );
      const restoreHome = writeConfig({ directory: stateDir, commandByAgent, projectDir });
      const server = createServer();

      try {
        await assertRealAgentReady(agentCase.agentId, commandByAgent[agentCase.agentId], projectDir);

        const workspaceMarker = `WORKSPACE_SHOULD_NOT_BE_USED_${agentCase.agentId.toUpperCase()}`;
        fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'docs', 'real-brief.txt'), workspaceMarker, 'utf8');

        const port = await listen(server);
        const marker = [
          'AGENTSAPI_REAL',
          agentCase.agentId.toUpperCase(),
          apiCase.stream ? 'STREAM' : 'RUN',
          apiCase.upload ? 'UPLOAD' : 'NOFILE',
          Date.now().toString(36),
        ].join('_');
        const response = await callRunApi({ port, apiCase, agentCase, marker });

        if (apiCase.stream) {
          assertStreamResponse(response, marker, workspaceMarker, { upload: apiCase.upload });
        } else {
          assertRunResponse(response, marker, workspaceMarker, { upload: apiCase.upload });
        }

        assert.equal(fs.existsSync(path.join(projectDir, 'agents-api-run-files')), false);
      } finally {
        await closeServer(server);
        restoreHome();
        fs.rmSync(stateDir, { recursive: true, force: true });
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  }
}
