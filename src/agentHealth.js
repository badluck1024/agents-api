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
      error: `Unsupported agent: ${agentId}`,
    };
  }

  const version = await runProcess({
    command,
    args: agent.versionArgs,
    timeoutMs,
    cwd: options.cwd,
    env: options.env,
  });
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
      error: compactOutput(version) || `Command is not executable: ${command}`,
    };
  }

  const auth = await runProcess({
    command,
    args: agent.authArgs,
    timeoutMs,
    cwd: options.cwd,
    env: options.env,
  });
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
      error: compactOutput(auth) || `${agent.displayName} is not authenticated. Run the agent CLI and complete interactive login.`,
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
    'No agent is installed and authenticated correctly.',
    'At least one agent among codex, claude, and antigravity must be available.',
    '',
    'Agent status:',
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
