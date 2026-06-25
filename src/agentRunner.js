const fs = require('fs');
const { getAgent, normalizeAgentId } = require('./agents');
const { runProcess, spawnProcess } = require('./processRunner');

function ensurePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('The prompt field is required.');
  }
}

function ensureWorkingDir(cwd) {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Invalid working directory: ${cwd}`);
  }
}

function normalizeSessionId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('The sessionId field must be a string.');
  }

  const sessionId = value.trim();
  if (!sessionId) {
    throw new Error('The sessionId field cannot be empty.');
  }

  return sessionId;
}

function normalizeTimeoutMs(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('The timeoutMs field must be a positive integer.');
  }

  return timeoutMs;
}

function normalizeIdleTimeoutMs(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const idleTimeoutMs = Number(value);
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error('The idleTimeoutMs field must be a positive integer.');
  }

  return idleTimeoutMs;
}

function buildAgentArgs(agentId, configString, prompt, options = {}) {
  ensurePrompt(prompt);
  const sessionId = normalizeSessionId(options.sessionId);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agent = getAgent(normalizedAgentId);
  if (!agent) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }
  return agent.buildArgs(configString, prompt, { sessionId });
}

async function runAgent({ agentId, command, config, prompt, cwd, sessionId, timeoutMs, idleTimeoutMs, agentVersion }) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const normalizedIdleTimeoutMs = normalizeIdleTimeoutMs(idleTimeoutMs);
  const args = buildAgentArgs(agentId, config, prompt, { sessionId: normalizedSessionId });
  const result = await runProcess({
    command,
    args,
    cwd,
    timeoutMs: normalizedTimeoutMs,
    idleTimeoutMs: normalizedIdleTimeoutMs,
  });

  return {
    agent: agentId,
    provider: agentId,
    agentVersion: agentVersion || '',
    command,
    args,
    cwd,
    config,
    sessionId: normalizedSessionId,
    timeoutMs: normalizedTimeoutMs,
    idleTimeoutMs: normalizedIdleTimeoutMs,
    timedOut: result.timedOut === true,
    idleTimedOut: result.idleTimedOut === true,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function spawnAgent({ agentId, command, config, prompt, cwd, sessionId, timeoutMs, idleTimeoutMs, agentVersion }) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const normalizedIdleTimeoutMs = normalizeIdleTimeoutMs(idleTimeoutMs);
  const args = buildAgentArgs(agentId, config, prompt, { sessionId: normalizedSessionId });
  const child = spawnProcess({ command, args, cwd });

  return {
    agent: agentId,
    provider: agentId,
    agentVersion: agentVersion || '',
    child,
    command,
    args,
    cwd,
    config,
    sessionId: normalizedSessionId,
    timeoutMs: normalizedTimeoutMs,
    idleTimeoutMs: normalizedIdleTimeoutMs,
  };
}

module.exports = {
  buildAgentArgs,
  normalizeIdleTimeoutMs,
  normalizeSessionId,
  normalizeTimeoutMs,
  runAgent,
  spawnAgent,
};
