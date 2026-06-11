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
const agentId = ${JSON.stringify(agentId)};
const args = process.argv.slice(2);
const prompt = args[args.length - 1] || '';
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
if (agentId === 'gemini') {
  const outputFormat = optionValue('--output-format') || 'text';
  if (outputFormat === 'stream-json') {
    console.log(JSON.stringify({ delta: { text: 'ACK:' } }));
    console.log(JSON.stringify({ delta: { text: prompt } }));
  } else if (outputFormat === 'json') {
    console.log(JSON.stringify({ response: 'ACK:' + prompt, stats: { total: 1 } }));
  } else {
    console.log('ACK:' + prompt);
  }
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
  fs.writeFileSync(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
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

function writeConfig({ directory, apiKey = '', agentId = 'codex', agentConfig = '', command }) {
  const restoreHome = withAgentsApiHome(directory);
  const config = defaultConfig();
  config.logging.level = 'off';
  config.logging.requests = false;
  config.auth.apiKey = apiKey;
  config.agents[agentId].command = command;
  config.agents[agentId].config = agentConfig;
  saveConfig(config);
  return restoreHome;
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
      body: { agent: 'codex', prompt: 'CIAO' },
    });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await request({
      port,
      path: '/api/runs',
      headers: { Authorization: 'Bearer test-token' },
      body: { agent: 'codex', prompt: 'CIAO' },
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.json.output, 'ACK:CIAO');
    assert.equal(authorized.json.sessionId, 'fake-thread');
    assert.equal(authorized.json.usage.output_tokens, 2);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs requires agent or provider in the request body', async () => {
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
      body: { prompt: 'CIAO' },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json.error, /agent o provider/);
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
      body: { agent: 'claude', prompt: 'CIAO' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json.output, 'ACK:CIAO');
    assert.equal(response.json.sessionId, 'fake-claude');
    assert.equal(response.json.usage.num_turns, 1);
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('POST /api/runs/stream returns normalized gemini stream output', async () => {
  const directory = createTempDir();
  const command = createFakeAgentCommand(directory, 'gemini');
  const restoreHome = writeConfig({
    directory,
    agentId: 'gemini',
    agentConfig: '--output-format stream-json',
    command,
  });
  const server = createServer();

  try {
    const port = await listen(server);
    const response = await request({
      port,
      path: '/api/runs/stream',
      body: { agent: 'gemini', prompt: 'CIAO' },
    });
    const events = parseSseEvents(response.text);

    assert.equal(response.statusCode, 200);
    assert.equal(events[0].event, 'start');
    assert.deepEqual(
      events.filter((entry) => entry.event === 'output').map((entry) => entry.data.text),
      ['ACK:', 'CIAO']
    );
    assert.equal(events.at(-1).event, 'exit');
    assert.equal(events.at(-1).data.output, 'ACK:CIAO');
  } finally {
    await closeServer(server);
    restoreHome();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
