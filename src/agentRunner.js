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

function buildAgentArgs(agentId, configString, prompt) {
  ensurePrompt(prompt);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agent = getAgent(normalizedAgentId);
  if (!agent) {
    throw new Error(`Agente non supportato: ${agentId}`);
  }
  return agent.buildArgs(configString, prompt);
}

async function runAgent({ agentId, command, config, prompt, cwd }) {
  ensureWorkingDir(cwd);
  const args = buildAgentArgs(agentId, config, prompt);
  const result = await runProcess({ command, args, cwd });

  return {
    agent: agentId,
    provider: agentId,
    command,
    args,
    cwd,
    config,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function spawnAgent({ agentId, command, config, prompt, cwd }) {
  ensureWorkingDir(cwd);
  const args = buildAgentArgs(agentId, config, prompt);
  const child = spawnProcess({ command, args, cwd });

  return {
    agent: agentId,
    provider: agentId,
    child,
    command,
    args,
    cwd,
    config,
  };
}

module.exports = {
  buildAgentArgs,
  runAgent,
  spawnAgent,
};
