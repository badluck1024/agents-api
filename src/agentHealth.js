const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAgent, listAgentIds } = require('./agents');
const { runProcess } = require('./processRunner');

function compactOutput(result) {
  return [result.stdout, result.stderr]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isEnabledEnv(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function stripJsonComments(input) {
  return String(input || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function parseJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(stripJsonComments(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function geminiSettingsPaths({ env = process.env, homeDir = os.homedir(), cwd = process.cwd() } = {}) {
  const paths = [];
  if (env.GEMINI_CLI_SYSTEM_SETTINGS_PATH) {
    paths.push(env.GEMINI_CLI_SYSTEM_SETTINGS_PATH);
  }

  if (process.platform === 'win32') {
    paths.push('C:\\ProgramData\\gemini-cli\\settings.json');
  } else if (process.platform === 'darwin') {
    paths.push('/Library/Application Support/GeminiCli/settings.json');
  } else {
    paths.push('/etc/gemini-cli/settings.json');
  }

  paths.push(path.join(homeDir, '.gemini', 'settings.json'));
  paths.push(path.join(cwd, '.gemini', 'settings.json'));
  return [...new Set(paths)];
}

function readConfiguredGeminiAuth({ env = process.env, homeDir = os.homedir(), cwd = process.cwd() } = {}) {
  if (env.GEMINI_API_KEY) {
    return { type: 'gemini-api-key', source: 'GEMINI_API_KEY' };
  }
  if (isEnabledEnv(env.GOOGLE_GENAI_USE_VERTEXAI)) {
    return { type: 'vertex-ai', source: 'GOOGLE_GENAI_USE_VERTEXAI' };
  }
  if (isEnabledEnv(env.GOOGLE_GENAI_USE_GCA)) {
    return { type: 'google-account', source: 'GOOGLE_GENAI_USE_GCA' };
  }

  for (const settingsPath of geminiSettingsPaths({ env, homeDir, cwd })) {
    const settings = parseJsonFile(settingsPath);
    const auth = settings && settings.security && settings.security.auth;
    const selectedType = auth && typeof auth.selectedType === 'string' ? auth.selectedType.trim() : '';
    if (selectedType) {
      return { type: selectedType, source: settingsPath };
    }
  }

  return null;
}

function configuredGeminiAuthStatus({ command, displayName, version, options }) {
  const auth = readConfiguredGeminiAuth({
    env: { ...process.env, ...((options && options.env) || {}) },
    homeDir: options && options.homeDir ? options.homeDir : os.homedir(),
    cwd: options && options.cwd ? options.cwd : process.cwd(),
  });

  if (!auth) {
    return {
      installed: true,
      authenticated: false,
      ready: false,
      version,
      error: `${displayName} auth method is not configured. Configure Gemini CLI authentication or set GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI=true, or GOOGLE_GENAI_USE_GCA=true.`,
    };
  }

  return {
    installed: true,
    authenticated: true,
    ready: true,
    version,
    authStatus: `Auth method configured: ${auth.type} (${auth.source})`,
  };
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

  const version = await runProcess({
    command,
    args: agent.versionArgs,
    timeoutMs,
    cwd: options.cwd,
    env: options.env,
  });
  if (version.code !== 0) {
    if (agent.authCheck === 'gemini-configured-auth' && version.timedOut === true) {
      const status = configuredGeminiAuthStatus({
        displayName: agent.displayName,
        version: '',
        options,
      });
      return {
        agent: agentId,
        provider: agentId,
        displayName: agent.displayName,
        command,
        ...status,
        warning: compactOutput(version),
      };
    }

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

  if (agent.authCheck === 'gemini-configured-auth') {
    return {
      agent: agentId,
      provider: agentId,
      displayName: agent.displayName,
      command,
      ...configuredGeminiAuthStatus({
        command,
        displayName: agent.displayName,
        version: compactOutput(version),
        options,
      }),
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
  readConfiguredGeminiAuth,
  formatAgentStatus,
  formatNoReadyAgentsFailure,
  readyAgentIds,
};
