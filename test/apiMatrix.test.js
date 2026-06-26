const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createServer } = require('../src/server');
const { defaultConfig, saveConfig } = require('../src/config');

const AGENT_CASES = [
  { agentId: 'codex', config: '--json' },
  { agentId: 'claude', config: '' },
  { agentId: 'antigravity', config: '' },
];

const API_CASES = [
  { name: 'non-stream JSON request without files', endpoint: '/api/runs', stream: false, upload: false },
  { name: 'non-stream multipart request with file upload', endpoint: '/api/runs', stream: false, upload: true },
  { name: 'stream JSON request without files', endpoint: '/api/runs/stream', stream: true, upload: false },
  { name: 'stream multipart request with file upload', endpoint: '/api/runs/stream', stream: true, upload: true },
];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-matrix-'));
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

function writeConfig({ directory, agentId, agentConfig, command, projectDir }) {
  const restoreHome = withAgentsApiHome(directory);
  const config = defaultConfig();
  config.logging.level = 'off';
  config.logging.requests = false;
  config.agents[agentId].command = command;
  config.agents[agentId].config = agentConfig;
  config.projects.matrix = {
    id: 'matrix',
    workingDir: projectDir,
    agents: createProjectAgents(),
  };
  saveConfig(config);
  return restoreHome;
}

function createFakeAgentCommand(directory, agentId) {
  const scriptPath = path.join(directory, `${agentId}-matrix-agent.js`);
  const script = `#!/usr/bin/env node
const fs = require('fs');
const agentId = ${JSON.stringify(agentId)};
const args = process.argv.slice(2);
const prompt = args[args.length - 1] === '-'
  ? fs.readFileSync(0, 'utf8')
  : args[args.length - 1] || '';

function readStagedFile() {
  const line = prompt
    .split(String.fromCharCode(10))
    .map((value) => value.replace(/\\r$/, '').trim())
    .find((value) => value.startsWith('Staged filesystem path to read: '));
  if (!line) return '';

  const rawValue = line.slice('Staged filesystem path to read: '.length).trim();
  let filePath = rawValue;
  try {
    filePath = JSON.parse(rawValue);
  } catch {
    filePath = rawValue.replace(/^"|"$/g, '');
  }

  return fs.readFileSync(filePath, 'utf8').trim();
}

const hasUpload = prompt.includes('Staged filesystem path to read: ');
const output = hasUpload ? 'FILE:' + readStagedFile() : 'ACK:' + prompt;

if (agentId === 'codex') {
  console.error('Reading additional input from stdin...');
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'matrix-codex-session' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: output } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 2 } }));
  process.exit(0);
}

process.stdout.write(output);
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  const commandPath = path.join(directory, `${agentId}-matrix-agent.cmd`);
  fs.writeFileSync(commandPath, `@echo off\r\n"%dp0%\\${path.basename(scriptPath)}" %*\r\n`, 'utf8');
  return commandPath;
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
  const boundary = `agentsapi-matrix-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
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

function assertNormalizedRunResponse(response, expectedOutput, { upload }) {
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'].includes('application/json'), true);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.output, expectedOutput);
  assert.equal(response.json.timedOut, false);
  assert.equal(response.json.idleTimedOut, false);

  if (upload) {
    assert.equal(response.json.files.length, 1);
    assert.equal(response.json.files[0].path, path.join('docs', 'brief.txt'));
    assert.equal(response.json.files[0].stagedPath, 'attachment-1.txt');
    assert.equal(response.json.files[0].mimeType, 'text/plain');
  } else {
    assert.equal(response.json.files, undefined);
  }
}

function assertNormalizedStreamResponse(response, expectedOutput) {
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'].includes('text/event-stream'), true);

  const events = parseSseEvents(response.text);
  assert.equal(events[0].event, 'start');
  assert.equal(events.at(-1).event, 'exit');
  assert.equal(events.at(-1).data.ok, true);
  assert.equal(events.at(-1).data.output, expectedOutput);
  assert.equal(events.at(-1).data.timedOut, false);
  assert.equal(events.at(-1).data.idleTimedOut, false);
  assert.equal(
    events.filter((entry) => entry.event === 'output').map((entry) => entry.data.text).join('').trim(),
    expectedOutput
  );
}

async function callRunApi({ port, apiCase, agentId, prompt, uploadedText }) {
  const requestBody = {
    agent: agentId,
    project: 'matrix',
    prompt,
    responseMode: 'normalized',
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
        filename: 'docs/brief.txt',
        content: Buffer.from(uploadedText, 'utf8'),
        mimeType: 'text/plain',
      },
    ],
  });
}

for (const agentCase of AGENT_CASES) {
  for (const apiCase of API_CASES) {
    test(`API matrix: ${agentCase.agentId} ${apiCase.name}`, async () => {
      const directory = createTempDir();
      const projectDir = createTempDir();
      const command = createFakeAgentCommand(directory, agentCase.agentId);
      const restoreHome = writeConfig({
        directory,
        agentId: agentCase.agentId,
        agentConfig: agentCase.config,
        command,
        projectDir,
      });
      const server = createServer();

      try {
        fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'docs', 'brief.txt'), 'workspace file must not be used', 'utf8');

        const port = await listen(server);
        const prompt = apiCase.upload
          ? 'Read docs/brief.txt and return its contents.'
          : `Plain prompt for ${agentCase.agentId}`;
        const uploadedText = `uploaded content for ${agentCase.agentId}`;
        const expectedOutput = apiCase.upload ? `FILE:${uploadedText}` : `ACK:${prompt}`;
        const response = await callRunApi({
          port,
          apiCase,
          agentId: agentCase.agentId,
          prompt,
          uploadedText,
        });

        if (apiCase.stream) {
          assertNormalizedStreamResponse(response, expectedOutput);
        } else {
          assertNormalizedRunResponse(response, expectedOutput, { upload: apiCase.upload });
        }

        assert.equal(fs.existsSync(path.join(projectDir, 'agents-api-run-files')), false);
      } finally {
        await closeServer(server);
        restoreHome();
        fs.rmSync(directory, { recursive: true, force: true });
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  }
}
