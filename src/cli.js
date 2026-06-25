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

Usage:
  agentsapi serve [--host <host>] [--port <port>] [--log-level <level>]
  agentsapi status
  agentsapi agents status
  agentsapi auth status|generate|set <token>|clear
  agentsapi config default get|set <codex|claude|antigravity>|clear
  agentsapi config get <codex|claude|antigravity>
  agentsapi config set <codex|claude|antigravity> "<agent arguments>"
  agentsapi config clear <codex|claude|antigravity>
  agentsapi logs get|level <debug|info|warning|error|off>|requests <on|off>|prompt <on|off>
  agentsapi projects list
  agentsapi projects add <id> <working_dir>
  agentsapi projects remove <id>
  agentsapi projects config <id> [<codex|claude|antigravity> ["<agent arguments>"|--clear]]
  agentsapi run [--agent <codex|claude|antigravity>] [--project <id>] [--session-id <id>] [--timeout-ms <ms>] [--idle-timeout-ms <ms>] [--config "<agent arguments>"] <prompt>

Configuration precedence:
  request config > project agent config > shared agent config.

Examples:
  agentsapi auth generate
  agentsapi config default set codex
  agentsapi config set codex "--json --model gpt-5"
  agentsapi config set claude "--model sonnet --permission-mode plan"
  agentsapi config set antigravity "--model gemini-3.5-flash"
  agentsapi projects add demo C:\\repo\\demo
  agentsapi projects config demo claude "--model opus"
  agentsapi run --agent antigravity --project demo --session-id 550e8400-e29b-41d4-a716-446655440000 "Write only OK"
  agentsapi serve --host 0.0.0.0 --port 7357 --log-level info`);
}

function requireArg(value, label) {
  if (!value) {
    throw new Error(`Missing argument: ${label}`);
  }
  return value;
}

function requireAgent(value) {
  requireArg(value, 'agent');
  const agentId = normalizeAgentId(value, null);
  if (!agentId) {
    throw new Error(`Invalid agent: ${value}. Use: ${listAgentIds().join(', ')}`);
  }
  return agentId;
}

function validateProjectId(id) {
  requireArg(id, 'project id');
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error('Invalid project ID. Use only letters, numbers, dots, hyphens, or underscores.');
  }
}

function resolveOrCreateWorkingDir(value) {
  const workingDir = path.resolve(requireArg(value, 'working_dir'));

  if (!fs.existsSync(workingDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
  }

  if (!fs.statSync(workingDir).isDirectory()) {
    throw new Error(`Invalid working directory: ${workingDir}`);
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
    throw new Error(`Unknown agents command: ${subcommand}`);
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
    defaultAgent: config.defaultAgent || null,
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
    console.log('API token generated and saved.');
    console.log(`Token: ${token}`);
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Note: AGENTSAPI_API_KEY is set and takes precedence over the saved token.');
    }
    return;
  }

  if (subcommand === 'set') {
    config.auth.apiKey = String(requireArg(args[1], 'token')).trim();
    saveConfig(config);
    console.log('API token saved.');
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Note: AGENTSAPI_API_KEY is set and takes precedence over the saved token.');
    }
    return;
  }

  if (subcommand === 'clear') {
    config.auth.apiKey = '';
    saveConfig(config);
    console.log('API token removed from config.');
    if (process.env.AGENTSAPI_API_KEY) {
      console.log('Note: AGENTSAPI_API_KEY is still set, so auth remains active through the environment.');
    }
    return;
  }

  throw new Error(`Unknown auth command: ${subcommand}`);
}

function handleDefaultAgentConfig(args, config) {
  const subcommand = args[0] || 'get';

  if (subcommand === 'get') {
    console.log(config.defaultAgent || '');
    return;
  }

  if (subcommand === 'set') {
    config.defaultAgent = requireAgent(args[1]);
    saveConfig(config);
    console.log(`Default agent updated: ${config.defaultAgent}`);
    return;
  }

  if (subcommand === 'clear') {
    config.defaultAgent = '';
    saveConfig(config);
    console.log('Default agent removed.');
    return;
  }

  throw new Error(`Unknown config default command: ${subcommand}`);
}

function handleConfig(args) {
  const subcommand = args[0] || 'get';
  const config = loadConfig();

  if (subcommand === 'default') {
    handleDefaultAgentConfig(args.slice(1), config);
    return;
  }

  if (subcommand === 'get') {
    const agentId = requireAgent(args[1]);
    console.log(config.agents[agentId].config);
    return;
  }

  if (subcommand === 'set') {
    const agentId = requireAgent(args[1]);
    config.agents[agentId].config = joinRemainingArgs(args, 2);
    saveConfig(config);
    console.log(`Shared ${agentId} configuration updated.`);
    return;
  }

  if (subcommand === 'clear') {
    const agentId = requireAgent(args[1]);
    config.agents[agentId].config = '';
    saveConfig(config);
    console.log(`Shared ${agentId} configuration cleared.`);
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}`);
}

function normalizeOnOff(value, label) {
  const normalized = String(requireArg(value, label)).trim().toLowerCase();

  if (['on', 'true', '1', 'yes'].includes(normalized)) {
    return true;
  }

  if (['off', 'false', '0', 'no'].includes(normalized)) {
    return false;
  }

  throw new Error(`${label} must be on or off.`);
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
      throw new Error('Invalid log level. Use: debug, info, warning, error, off.');
    }
    config.logging.level = level;
    saveConfig(config);
    console.log(`Log level updated: ${level}`);
    return;
  }

  if (subcommand === 'requests') {
    config.logging.requests = normalizeOnOff(args[1], 'requests');
    saveConfig(config);
    console.log(`Request logging: ${config.logging.requests ? 'on' : 'off'}`);
    return;
  }

  if (subcommand === 'prompt') {
    config.logging.includePrompt = normalizeOnOff(args[1], 'prompt');
    saveConfig(config);
    console.log(`Prompt debug logging: ${config.logging.includePrompt ? 'on' : 'off'}`);
    return;
  }

  throw new Error(`Unknown logs command: ${subcommand}`);
}

function handleProjects(args) {
  const subcommand = args[0] || 'list';
  const config = loadConfig();

  if (subcommand === 'list') {
    const projects = Object.values(config.projects);
    if (projects.length === 0) {
      console.log('No projects configured.');
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
    console.log(`Project ${id} saved.`);
    return;
  }

  if (subcommand === 'remove') {
    const id = args[1];
    validateProjectId(id);
    if (!config.projects[id]) {
      throw new Error(`Project not found: ${id}`);
    }
    delete config.projects[id];
    saveConfig(config);
    console.log(`Project ${id} removed.`);
    return;
  }

  if (subcommand === 'config') {
    const id = args[1];
    validateProjectId(id);
    const project = config.projects[id];
    if (!project) {
      throw new Error(`Project not found: ${id}`);
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
    console.log(`Project ${id}/${agentId} configuration updated.`);
    return;
  }

  throw new Error(`Unknown projects command: ${subcommand}`);
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

    if (arg === '--session-id' || arg === '--sessionId') {
      request.sessionId = requireArg(args[index + 1], '--session-id');
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms' || arg === '--timeoutMs') {
      request.timeoutMs = requireArg(args[index + 1], '--timeout-ms');
      index += 1;
      continue;
    }

    if (arg === '--idle-timeout-ms' || arg === '--idleTimeoutMs') {
      request.idleTimeoutMs = requireArg(args[index + 1], '--idle-timeout-ms');
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
    sessionId: request.sessionId,
    timeoutMs: request.timeoutMs,
    idleTimeoutMs: request.idleTimeoutMs,
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

  throw new Error(`Unknown command: ${command}`);
}

module.exports = {
  runCli,
};
