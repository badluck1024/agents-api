const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDefaultAgentsConfig, listAgentIds, normalizeAgentId } = require('./agents');
const { normalizeLogLevel } = require('./logger');

function getStateDir() {
  if (process.env.AGENTSAPI_HOME) {
    return process.env.AGENTSAPI_HOME;
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agents-api');
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agents-api');
}

function getConfigPath() {
  return path.join(getStateDir(), 'config.json');
}

function defaultConfig() {
  return {
    version: 1,
    server: {
      host: '127.0.0.1',
      port: 7357,
    },
    defaultAgent: '',
    agents: createDefaultAgentsConfig(process.env),
    auth: {
      apiKey: '',
    },
    logging: {
      level: normalizeLogLevel(process.env.AGENTSAPI_LOG_LEVEL || 'info'),
      requests: true,
      includePrompt: false,
    },
    projects: {},
  };
}

function ensureStateDir() {
  fs.mkdirSync(getStateDir(), { recursive: true });
}

function normalizeConfig(config) {
  const base = defaultConfig();
  const normalized = {
    version: 1,
    server: {
      ...base.server,
      ...((config && config.server) || {}),
    },
    defaultAgent: normalizeAgentId(config && config.defaultAgent, null) || '',
    agents: {},
    auth: {
      ...base.auth,
      ...((config && config.auth) || {}),
    },
    logging: {
      ...base.logging,
      ...((config && config.logging) || {}),
    },
    projects: {},
  };
  for (const agentId of listAgentIds()) {
    const previousCodexConfig = agentId === 'codex' && config && config.codex ? config.codex : {};
    normalized.agents[agentId] = {
      ...base.agents[agentId],
      ...previousCodexConfig,
      ...((config && config.agents && config.agents[agentId]) || {}),
    };
    normalized.agents[agentId].command = String(normalized.agents[agentId].command || base.agents[agentId].command);
    normalized.agents[agentId].config = String(normalized.agents[agentId].config || '');
  }
  normalized.auth.apiKey = String(normalized.auth.apiKey || '').trim();
  normalized.logging.level = normalizeLogLevel(normalized.logging.level);
  normalized.logging.requests = normalized.logging.requests !== false;
  normalized.logging.includePrompt = normalized.logging.includePrompt === true;

  for (const [id, project] of Object.entries((config && config.projects) || {})) {
    const projectAgents = {};
    for (const agentId of listAgentIds()) {
      projectAgents[agentId] = {
        config: String(
          (project.agents && project.agents[agentId] && project.agents[agentId].config) ||
          (agentId === 'codex' ? project.config : '') ||
          ''
        ),
      };
    }
    normalized.projects[id] = {
      id,
      workingDir: String(project.workingDir || ''),
      agents: projectAgents,
    };
  }

  return normalized;
}

function loadConfig() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return normalizeConfig(parsed);
  } catch (error) {
    throw new Error(`Configurazione non leggibile in ${configPath}: ${error.message}`);
  }
}

function saveConfig(config) {
  ensureStateDir();
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8');
}

function selectAgentId(config, request = {}) {
  const requestedValue = request.agent || request.provider;
  if (requestedValue !== undefined && requestedValue !== null && String(requestedValue).trim()) {
    const requested = normalizeAgentId(requestedValue, null);
    if (!requested) {
      throw new Error(`Agente non valido: ${requestedValue}`);
    }
    return requested;
  }

  const defaultAgent = normalizeAgentId(config && config.defaultAgent, null);
  if (defaultAgent) {
    return defaultAgent;
  }

  throw new Error('Il campo agent o provider e obbligatorio quando defaultAgent non e configurato.');
}

function resolveRunConfig(config, request = {}, options = {}) {
  const agentId = selectAgentId(config, request, options);
  const hasProject = typeof request.project === 'string' && request.project.trim() !== '';
  const projectId = hasProject ? request.project.trim() : '';
  const project = projectId ? config.projects[projectId] : null;

  if (projectId && !project) {
    throw new Error(`Progetto non trovato: ${projectId}`);
  }

  const hasRequestConfig = Object.prototype.hasOwnProperty.call(request, 'config');
  const projectAgentConfig = project && project.agents && project.agents[agentId] ? project.agents[agentId].config : '';
  const sharedAgentConfig = config.agents && config.agents[agentId] ? config.agents[agentId].config : '';
  const effectiveConfig = hasRequestConfig ? String(request.config || '') : (projectAgentConfig || sharedAgentConfig || '');

  return {
    agentId,
    provider: agentId,
    projectId: projectId || null,
    cwd: project ? project.workingDir : process.cwd(),
    config: effectiveConfig,
  };
}

module.exports = {
  defaultConfig,
  getConfigPath,
  getStateDir,
  loadConfig,
  normalizeConfig,
  resolveRunConfig,
  saveConfig,
  selectAgentId,
};
