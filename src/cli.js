const fs = require('fs');
const path = require('path');
const { generateApiKey, resolveApiKey } = require('./auth');
const { joinRemainingArgs } = require('./argsString');
const { checkAllAgentsReady } = require('./agentHealth');
const { listAgentIds, normalizeAgentId } = require('./agents');
const { runAgent } = require('./agentRunner');
const { normalizeLogLevel } = require('./logger');
const { getConfigPath, getStateDir, loadConfig, resolveRunConfig, saveConfig } = require('./config');
const { startServer } = require('./server');

function printHelp() {
  console.log(`agents-api

Uso:
  agentsapi serve [--host <host>] [--port <port>] [--log-level <level>]
  agentsapi status
  agentsapi agents status
  agentsapi auth status|generate|set <token>|clear
  agentsapi config get <codex|claude|gemini>
  agentsapi config set <codex|claude|gemini> "<argomenti agente>"
  agentsapi config clear <codex|claude|gemini>
  agentsapi logs get|level <debug|info|warning|error|off>|requests <on|off>|prompt <on|off>
  agentsapi projects list
  agentsapi projects add <id> <working_dir>
  agentsapi projects remove <id>
  agentsapi projects config <id> [<codex|claude|gemini> ["<argomenti agente>"|--clear]]
  agentsapi run --agent <codex|claude|gemini> [--project <id>] [--config "<argomenti agente>"] <prompt>

Regola di override:
  config richiesta API/CLI > config progetto/agente > config condivisa/agente.

Esempi:
  agentsapi auth generate
  agentsapi config set codex "--json --model gpt-5"
  agentsapi config set claude "--model sonnet --permission-mode plan"
  agentsapi config set gemini "--model gemini-2.5-pro"
  agentsapi projects add demo C:\\repo\\demo
  agentsapi projects config demo claude "--model opus"
  agentsapi run --agent gemini --project demo "Scrivi solo CIAO"
  agentsapi serve --host 0.0.0.0 --port 7357 --log-level info`);
}

function requireArg(value, label) {
  if (!value) {
    throw new Error(`Argomento mancante: ${label}`);
  }
  return value;
}

function requireAgent(value) {
  requireArg(value, 'agent');
  const agentId = normalizeAgentId(value, null);
  if (!agentId) {
    throw new Error(`Agente non valido: ${value}. Usa: ${listAgentIds().join(', ')}`);
  }
  return agentId;
}

function validateProjectId(id) {
  requireArg(id, 'id progetto');
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error('ID progetto non valido. Usa solo lettere, numeri, punto, trattino o underscore.');
  }
}

function resolveOrCreateWorkingDir(value) {
  const workingDir = path.resolve(requireArg(value, 'working_dir'));

  if (!fs.existsSync(workingDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
  }

  if (!fs.statSync(workingDir).isDirectory()) {
    throw new Error(`Working directory non valida: ${workingDir}`);
  }

  return workingDir;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] || null;
}

function createEmptyProjectAgents() {
  const agents = {};
  for (const agentId of listAgentIds()) {
    agents[agentId] = { config: '' };
  }
  return agents;
}

async function handleAgents(args) {
  const subcommand = args[0] || 'status';
  if (subcommand !== 'status' && subcommand !== 'list') {
    throw new Error(`Comando agents non riconosciuto: ${subcommand}`);
  }

  const config = loadConfig();
  const statuses = await checkAllAgentsReady(config);
  console.log(JSON.stringify(statuses, null, 2));
}

async function handleStatus() {
  const config = loadConfig();
  const auth = resolveApiKey(config);
  const agents = await checkAllAgentsReady(config);

  console.log(JSON.stringify({
    configPath: getConfigPath(),
    stateDir: getStateDir(),
    agents,
    auth: {
      enabled: auth.enabled,
      source: auth.source,
      key: auth.masked,
    },
    logging: config.logging,
    projects: Object.keys(config.projects).length,
  }, null, 2));
}

function handleAuth(args) {
  const subcommand = args[0] || 'status';
  const config = loadConfig();

  if (subcommand === 'status') {
    const auth = resolveApiKey(config);
    console.log(JSON.stringify({
      enabled: auth.enabled,
      source: auth.source,
      key: auth.masked,
      envOverride: auth.source === 'env',
    }, null, 2));
    return;
  }

  if (subcommand === 'generate') {
    const token = generateApiKey();
    config.auth.apiKey = token;
    saveConfig(config);
    console.log('Token API generato e salvato.');
    console.log(`Token: ${token}`);
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Nota: AGENTSAPI_API_KEY e impostata e avra precedenza sul token salvato.');
    }
    return;
  }

  if (subcommand === 'set') {
    config.auth.apiKey = String(requireArg(args[1], 'token')).trim();
    saveConfig(config);
    console.log('Token API salvato.');
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Nota: AGENTSAPI_API_KEY e impostata e avra precedenza sul token salvato.');
    }
    return;
  }

  if (subcommand === 'clear') {
    config.auth.apiKey = '';
    saveConfig(config);
    console.log('Token API rimosso dalla config.');
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Nota: AGENTSAPI_API_KEY e ancora impostata, quindi auth resta attiva via env.');
    }
    return;
  }

  throw new Error(`Comando auth non riconosciuto: ${subcommand}`);
}

function handleConfig(args) {
  const subcommand = args[0] || 'get';
  const config = loadConfig();

  if (subcommand === 'get') {
    const agentId = requireAgent(args[1]);
    console.log(config.agents[agentId].config);
    return;
  }

  if (subcommand === 'set') {
    const agentId = requireAgent(args[1]);
    config.agents[agentId].config = joinRemainingArgs(args, 2);
    saveConfig(config);
    console.log(`Configurazione condivisa ${agentId} aggiornata.`);
    return;
  }

  if (subcommand === 'clear') {
    const agentId = requireAgent(args[1]);
    config.agents[agentId].config = '';
    saveConfig(config);
    console.log(`Configurazione condivisa ${agentId} svuotata.`);
    return;
  }

  throw new Error(`Comando config non riconosciuto: ${subcommand}`);
}

function normalizeOnOff(value, label) {
  const normalized = String(requireArg(value, label)).trim().toLowerCase();

  if (['on', 'true', '1', 'yes', 'si'].includes(normalized)) {
    return true;
  }

  if (['off', 'false', '0', 'no'].includes(normalized)) {
    return false;
  }

  throw new Error(`${label} deve essere on oppure off.`);
}

function handleLogs(args) {
  const subcommand = args[0] || 'get';
  const config = loadConfig();

  if (subcommand === 'get') {
    console.log(JSON.stringify(config.logging, null, 2));
    return;
  }

  if (subcommand === 'level') {
    const rawLevel = requireArg(args[1], 'log level');
    const level = normalizeLogLevel(rawLevel);
    const rawNormalized = String(rawLevel).trim().toLowerCase();
    const aliases = ['warn', 'warnings', 'errors', 'none', 'false', 'disabled'];
    if (level !== rawNormalized && !aliases.includes(rawNormalized)) {
      throw new Error('Log level non valido. Usa: debug, info, warning, error, off.');
    }
    config.logging.level = level;
    saveConfig(config);
    console.log(`Log level aggiornato: ${level}`);
    return;
  }

  if (subcommand === 'requests') {
    config.logging.requests = normalizeOnOff(args[1], 'requests');
    saveConfig(config);
    console.log(`Log richieste: ${config.logging.requests ? 'on' : 'off'}`);
    return;
  }

  if (subcommand === 'prompt') {
    config.logging.includePrompt = normalizeOnOff(args[1], 'prompt');
    saveConfig(config);
    console.log(`Log prompt in debug: ${config.logging.includePrompt ? 'on' : 'off'}`);
    return;
  }

  throw new Error(`Comando logs non riconosciuto: ${subcommand}`);
}

function handleProjects(args) {
  const subcommand = args[0] || 'list';
  const config = loadConfig();

  if (subcommand === 'list') {
    const projects = Object.values(config.projects);
    if (projects.length === 0) {
      console.log('Nessun progetto configurato.');
      return;
    }

    for (const project of projects) {
      console.log(`${project.id}\t${project.workingDir}\t${JSON.stringify(project.agents)}`);
    }
    return;
  }

  if (subcommand === 'add') {
    const id = args[1];
    validateProjectId(id);
    config.projects[id] = {
      id,
      workingDir: resolveOrCreateWorkingDir(args[2]),
      agents: createEmptyProjectAgents(),
    };
    saveConfig(config);
    console.log(`Progetto ${id} salvato.`);
    return;
  }

  if (subcommand === 'remove') {
    const id = args[1];
    validateProjectId(id);
    if (!config.projects[id]) {
      throw new Error(`Progetto non trovato: ${id}`);
    }
    delete config.projects[id];
    saveConfig(config);
    console.log(`Progetto ${id} rimosso.`);
    return;
  }

  if (subcommand === 'config') {
    const id = args[1];
    validateProjectId(id);
    const project = config.projects[id];
    if (!project) {
      throw new Error(`Progetto non trovato: ${id}`);
    }
    project.agents = project.agents || createEmptyProjectAgents();

    if (args.length === 2) {
      console.log(JSON.stringify(project.agents, null, 2));
      return;
    }

    const agentId = requireAgent(args[2]);
    const valueStartIndex = 3;
    project.agents[agentId] = project.agents[agentId] || { config: '' };

    if (args.length === valueStartIndex) {
      console.log(project.agents[agentId].config);
      return;
    }

    if (args[valueStartIndex] === '--clear') {
      project.agents[agentId].config = '';
    } else {
      project.agents[agentId].config = joinRemainingArgs(args, valueStartIndex);
    }

    saveConfig(config);
    console.log(`Configurazione progetto ${id}/${agentId} aggiornata.`);
    return;
  }

  throw new Error(`Comando projects non riconosciuto: ${subcommand}`);
}

function parseRunArgs(args) {
  const request = {};
  const promptParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--agent' || arg === '--provider') {
      request.agent = requireAgent(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--project') {
      request.project = requireArg(args[index + 1], '--project');
      index += 1;
      continue;
    }

    if (arg === '--config') {
      request.config = requireArg(args[index + 1], '--config');
      index += 1;
      continue;
    }

    promptParts.push(arg);
  }

  request.prompt = promptParts.join(' ').trim();
  return request;
}

async function handleRun(args) {
  const request = parseRunArgs(args);
  const config = loadConfig();
  const resolved = resolveRunConfig(config, request);
  const result = await runAgent({
    agentId: resolved.agentId,
    command: config.agents[resolved.agentId].command,
    config: resolved.config,
    prompt: request.prompt,
    cwd: resolved.cwd,
  });

  console.log(JSON.stringify({
    agent: resolved.agentId,
    provider: resolved.agentId,
    project: resolved.projectId,
    ...result,
  }, null, 2));
}

async function handleServe(args) {
  const host = optionValue(args, '--host');
  const port = optionValue(args, '--port');
  const logLevel = optionValue(args, '--log-level');
  if (logLevel) {
    process.env.AGENTSAPI_LOG_LEVEL = normalizeLogLevel(logLevel);
  }
  await startServer({ host, port });
}

async function runCli(argv) {
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(require('../package.json').version);
    return;
  }

  if (command === 'serve') {
    await handleServe(argv.slice(1));
    return;
  }

  if (command === 'status') {
    await handleStatus();
    return;
  }

  if (command === 'agents') {
    await handleAgents(argv.slice(1));
    return;
  }

  if (command === 'auth') {
    handleAuth(argv.slice(1));
    return;
  }

  if (command === 'config') {
    handleConfig(argv.slice(1));
    return;
  }

  if (command === 'logs') {
    handleLogs(argv.slice(1));
    return;
  }

  if (command === 'projects') {
    handleProjects(argv.slice(1));
    return;
  }

  if (command === 'run') {
    await handleRun(argv.slice(1));
    return;
  }

  throw new Error(`Comando non riconosciuto: ${command}`);
}

module.exports = {
  runCli,
};
