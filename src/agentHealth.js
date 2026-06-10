const { getAgent, listAgentIds } = require('./agents');
const { runProcess } = require('./processRunner');

function compactOutput(result) {
  return [result.stdout, result.stderr]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function checkAgentReady(agentId, agentConfig = {}, options = {}) {
  const agent = getAgent(agentId);
  const command = agentConfig.command || (agent && agent.defaultCommand) || agentId;
  const timeoutMs = Number(options.timeoutMs || 7000);

  if (!agent) {
    return {
      agent: agentId,
      provider: agentId,
      displayName: agentId,
      command,
      installed: false,
      authenticated: false,
      ready: false,
      version: '',
      error: `Agente non supportato: ${agentId}`,
    };
  }

  const version = await runProcess({ command, args: agent.versionArgs, timeoutMs });
  if (version.code !== 0) {
    const installed = version.timedOut === true;
    return {
      agent: agentId,
      provider: agentId,
      displayName: agent.displayName,
      command,
      installed,
      authenticated: false,
      ready: false,
      version: '',
      error: compactOutput(version) || `Comando non eseguibile: ${command}`,
    };
  }

  const auth = await runProcess({ command, args: agent.authArgs, timeoutMs });
  if (auth.code !== 0) {
    return {
      agent: agentId,
      provider: agentId,
      displayName: agent.displayName,
      command,
      installed: true,
      authenticated: false,
      ready: false,
      version: compactOutput(version),
      error: compactOutput(auth) || `${agent.displayName} non risulta autenticato.`,
    };
  }

  return {
    agent: agentId,
    provider: agentId,
    displayName: agent.displayName,
    command,
    installed: true,
    authenticated: true,
    ready: true,
    version: compactOutput(version),
    authStatus: compactOutput(auth),
  };
}

async function checkAllAgentsReady(config = {}, options = {}) {
  const statuses = [];
  for (const agentId of listAgentIds()) {
    statuses.push(await checkAgentReady(agentId, config.agents && config.agents[agentId], options));
  }
  return statuses;
}

function readyAgentIds(statuses) {
  return statuses.filter((status) => status.ready).map((status) => status.agent);
}

function formatAgentStatus(status) {
  const state = status.ready
    ? 'READY'
    : status.installed
      ? 'NOT_AUTHENTICATED'
      : 'NOT_INSTALLED';
  const details = status.ready
    ? status.version
    : status.error || status.version || '';
  return `${status.agent}: ${state}${details ? ` - ${details}` : ''}`;
}

function formatNoReadyAgentsFailure(statuses) {
  return [
    'Nessun agente risulta installato e autenticato correttamente.',
    'Almeno un agente tra codex, claude e gemini deve essere disponibile.',
    '',
    'Stato agenti:',
    ...statuses.map((status) => `  - ${formatAgentStatus(status)}`),
  ].join('\n');
}

module.exports = {
  checkAgentReady,
  checkAllAgentsReady,
  formatAgentStatus,
  formatNoReadyAgentsFailure,
  readyAgentIds,
};
