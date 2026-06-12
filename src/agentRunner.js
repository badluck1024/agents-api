const fs = require('fs');
const { getAgent, normalizeAgentId } = require('./agents');
const { runProcess, spawnProcess } = require('./processRunner');

function ensurePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('Il campo prompt e obbligatorio.');
  }
}

function ensureWorkingDir(cwd) {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory inesistente: ${cwd}`);
  }

  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Working directory non valida: ${cwd}`);
  }
}

function normalizeSessionId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Il campo sessionId deve essere una stringa.');
  }

  const sessionId = value.trim();
  if (!sessionId) {
    throw new Error('Il campo sessionId non puo essere vuoto.');
  }

  return sessionId;
}

function normalizeTimeoutMs(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Il campo timeoutMs deve essere un intero positivo.');
  }

  return timeoutMs;
}

function buildAgentArgs(agentId, configString, prompt, options = {}) {
  ensurePrompt(prompt);
  const sessionId = normalizeSessionId(options.sessionId);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agent = getAgent(normalizedAgentId);
  if (!agent) {
    throw new Error(`Agente non supportato: ${agentId}`);
  }
  return agent.buildArgs(configString, prompt, { sessionId });
}

async function runAgent({ agentId, command, config, prompt, cwd, sessionId, timeoutMs }) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const args = buildAgentArgs(agentId, config, prompt, { sessionId: normalizedSessionId });
  const result = await runProcess({ command, args, cwd, timeoutMs: normalizedTimeoutMs });

  return {
    agent: agentId,
    provider: agentId,
    command,
    args,
    cwd,
    config,
    sessionId: normalizedSessionId,
    timeoutMs: normalizedTimeoutMs,
    timedOut: result.timedOut === true,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function spawnAgent({ agentId, command, config, prompt, cwd, sessionId, timeoutMs }) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const args = buildAgentArgs(agentId, config, prompt, { sessionId: normalizedSessionId });
  const child = spawnProcess({ command, args, cwd });

  return {
    agent: agentId,
    provider: agentId,
    child,
    command,
    args,
    cwd,
    config,
    sessionId: normalizedSessionId,
    timeoutMs: normalizedTimeoutMs,
  };
}

module.exports = {
  buildAgentArgs,
  normalizeSessionId,
  normalizeTimeoutMs,
  runAgent,
  spawnAgent,
};
