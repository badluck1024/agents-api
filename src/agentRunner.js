const fs = require('fs');
const { getAgent, normalizeAgentId } = require('./agents');
const { runProcess, spawnProcess } = require('./processRunner');
const { appendRunFilesToPrompt, createRunFilesContext, publicRunFiles } = require('./runFiles');

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

function hasRunFiles(runFiles) {
  return Boolean(runFiles && Array.isArray(runFiles.files) && runFiles.files.length > 0);
}

function shouldUsePromptStdin(agentId, runFiles, prompt) {
  return agentId === 'codex' && (hasRunFiles(runFiles) || String(prompt || '').includes('\n'));
}

function buildAgentInvocation(agentId, configString, prompt, options = {}) {
  ensurePrompt(prompt);
  const sessionId = normalizeSessionId(options.sessionId);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agent = getAgent(normalizedAgentId);
  if (!agent) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }
  const runPrompt = appendRunFilesToPrompt(prompt, options.runFiles);
  const promptStdin = shouldUsePromptStdin(normalizedAgentId, options.runFiles, runPrompt) ? runPrompt : null;
  const cliPrompt = promptStdin === null ? runPrompt : '-';

  return {
    agentPrompt: runPrompt,
    args: agent.buildArgs(configString, cliPrompt, { sessionId, runFiles: options.runFiles }),
    promptTransport: promptStdin === null ? 'argument' : 'stdin',
    stdin: promptStdin,
  };
}

function buildAgentArgs(agentId, configString, prompt, options = {}) {
  return buildAgentInvocation(agentId, configString, prompt, options).args;
}

async function runAgent({
  agentId,
  command,
  config,
  prompt,
  cwd,
  sessionId,
  timeoutMs,
  idleTimeoutMs,
  agentVersion,
  files,
  onInvocation,
}) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const normalizedIdleTimeoutMs = normalizeIdleTimeoutMs(idleTimeoutMs);
  const runFiles = createRunFilesContext(files, cwd);

  try {
    const invocation = buildAgentInvocation(agentId, config, prompt, {
      sessionId: normalizedSessionId,
      runFiles,
    });
    const publicFiles = publicRunFiles(runFiles);
    if (typeof onInvocation === 'function') {
      onInvocation({
        args: invocation.args,
        files: publicFiles,
        prompt: invocation.agentPrompt,
        promptTransport: invocation.promptTransport,
      });
    }

    const result = await runProcess({
      command,
      args: invocation.args,
      cwd,
      input: invocation.stdin,
      timeoutMs: normalizedTimeoutMs,
      idleTimeoutMs: normalizedIdleTimeoutMs,
    });

    return {
      agent: agentId,
      provider: agentId,
      agentVersion: agentVersion || '',
      command,
      args: invocation.args,
      cwd,
      config,
      ...(publicFiles.length > 0 ? { files: publicFiles } : {}),
      promptTransport: invocation.promptTransport,
      sessionId: normalizedSessionId,
      timeoutMs: normalizedTimeoutMs,
      idleTimeoutMs: normalizedIdleTimeoutMs,
      timedOut: result.timedOut === true,
      idleTimedOut: result.idleTimedOut === true,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    runFiles.cleanup();
  }
}

function spawnAgent({
  agentId,
  command,
  config,
  prompt,
  cwd,
  sessionId,
  timeoutMs,
  idleTimeoutMs,
  agentVersion,
  files,
  onInvocation,
}) {
  ensureWorkingDir(cwd);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const normalizedIdleTimeoutMs = normalizeIdleTimeoutMs(idleTimeoutMs);
  const runFiles = createRunFilesContext(files, cwd);
  const invocation = buildAgentInvocation(agentId, config, prompt, {
    sessionId: normalizedSessionId,
    runFiles,
  });
  const publicFiles = publicRunFiles(runFiles);
  if (typeof onInvocation === 'function') {
    onInvocation({
      args: invocation.args,
      files: publicFiles,
      prompt: invocation.agentPrompt,
      promptTransport: invocation.promptTransport,
    });
  }

  let child;

  try {
    child = spawnProcess({ command, args: invocation.args, cwd, input: invocation.stdin });
  } catch (error) {
    runFiles.cleanup();
    throw error;
  }

  return {
    agent: agentId,
    provider: agentId,
    agentVersion: agentVersion || '',
    child,
    command,
    args: invocation.args,
    cwd,
    config,
    cleanup: runFiles.cleanup,
    ...(publicFiles.length > 0 ? { files: publicFiles } : {}),
    promptTransport: invocation.promptTransport,
    sessionId: normalizedSessionId,
    timeoutMs: normalizedTimeoutMs,
    idleTimeoutMs: normalizedIdleTimeoutMs,
  };
}

module.exports = {
  buildAgentArgs,
  buildAgentInvocation,
  normalizeIdleTimeoutMs,
  normalizeSessionId,
  normalizeTimeoutMs,
  runAgent,
  spawnAgent,
};
