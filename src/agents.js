const { splitArgsString } = require('./argsString');
const { buildRunFileArgs } = require('./runFiles');

const AGENTS = {
  codex: {
    id: 'codex',
    displayName: 'Codex',
    commandEnv: 'AGENTSAPI_CODEX_COMMAND',
    defaultCommand: 'codex',
    versionArgs: ['--version'],
    authArgs: ['login', 'status'],
    buildArgs(configString, prompt, options = {}) {
      const configArgs = splitArgsString(configString);
      const fileArgs = buildRunFileArgs('codex', options.runFiles);
      if (options.sessionId) {
        return ['exec', ...configArgs, ...fileArgs, 'resume', options.sessionId, prompt];
      }
      return ['exec', ...configArgs, ...fileArgs, prompt];
    },
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    commandEnv: 'AGENTSAPI_CLAUDE_COMMAND',
    defaultCommand: 'claude',
    versionArgs: ['--version'],
    authArgs: ['auth', 'status'],
    buildArgs(configString, prompt, options = {}) {
      const configArgs = splitArgsString(configString);
      const fileArgs = buildRunFileArgs('claude', options.runFiles);
      if (options.sessionId) {
        return ['-p', '--resume', options.sessionId, ...configArgs, ...fileArgs, prompt];
      }
      return ['-p', ...configArgs, ...fileArgs, prompt];
    },
  },
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity CLI',
    commandEnv: 'AGENTSAPI_ANTIGRAVITY_COMMAND',
    defaultCommand: 'agy',
    versionArgs: ['--version'],
    authArgs: ['models'],
    buildArgs(configString, prompt, options = {}) {
      const configArgs = splitArgsString(configString);
      const fileArgs = buildRunFileArgs('antigravity', options.runFiles);
      if (options.sessionId) {
        return ['--conversation', options.sessionId, ...configArgs, ...fileArgs, '--print', prompt];
      }
      return [...configArgs, ...fileArgs, '--print', prompt];
    },
  },
};

function listAgentIds() {
  return Object.keys(AGENTS);
}

function getAgent(agentId) {
  const normalized = normalizeAgentId(agentId);
  return normalized ? AGENTS[normalized] : null;
}

function normalizeAgentId(value, defaultValue = null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(AGENTS, normalized)) {
    return normalized;
  }
  return defaultValue;
}

function createDefaultAgentsConfig(env = process.env) {
  const agents = {};
  for (const agent of Object.values(AGENTS)) {
    agents[agent.id] = {
      command: env[agent.commandEnv] || agent.defaultCommand,
      config: '',
    };
  }
  return agents;
}

module.exports = {
  AGENTS,
  createDefaultAgentsConfig,
  getAgent,
  listAgentIds,
  normalizeAgentId,
};
