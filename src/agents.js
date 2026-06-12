const { splitArgsString } = require('./argsString');

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
      if (options.sessionId) {
        return ['exec', ...configArgs, 'resume', options.sessionId, prompt];
      }
      return ['exec', ...configArgs, prompt];
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
      if (options.sessionId) {
        return ['-p', '--resume', options.sessionId, ...configArgs, prompt];
      }
      return ['-p', ...configArgs, prompt];
    },
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    commandEnv: 'AGENTSAPI_GEMINI_COMMAND',
    defaultCommand: 'gemini',
    versionArgs: ['--version'],
    authCheck: 'gemini-configured-auth',
    buildArgs(configString, prompt, options = {}) {
      const configArgs = splitArgsString(configString);
      if (options.sessionId) {
        return ['--resume', options.sessionId, ...configArgs, prompt];
      }
      return [...configArgs, prompt];
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
