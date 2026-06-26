const { checkAgentReady, checkAllAgentsReady } = require('./agentHealth');
const { buildAgentArgs, runAgent, spawnAgent } = require('./agentRunner');
const { getAgent, listAgentIds, normalizeAgentId } = require('./agents');
const { splitArgsString } = require('./argsString');
const { generateApiKey, maskApiKey, resolveApiKey, verifyAuthorizationHeader } = require('./auth');
const {
  createAgentStreamNormalizer,
  createCodexStreamNormalizer,
  normalizeAgentResult,
  normalizeAntigravityResult,
  normalizeClaudeResult,
  normalizeCodexResult,
  normalizeResponseMode,
} = require('./codexOutput');
const { defaultConfig, getConfigPath, getStateDir, loadConfig, resolveRunConfig, saveConfig } = require('./config');
const { detectOutputFormatForAgent, resolveParserProfile } = require('./compat/parserRegistry');
const { createLogger, normalizeLogLevel } = require('./logger');
const { createServer, startServer } = require('./server');

module.exports = {
  buildAgentArgs,
  checkAgentReady,
  checkAllAgentsReady,
  createAgentStreamNormalizer,
  createCodexStreamNormalizer,
  createLogger,
  createServer,
  defaultConfig,
  detectOutputFormatForAgent,
  generateApiKey,
  getAgent,
  getConfigPath,
  getStateDir,
  listAgentIds,
  loadConfig,
  maskApiKey,
  normalizeAgentId,
  normalizeAgentResult,
  normalizeAntigravityResult,
  normalizeClaudeResult,
  normalizeCodexResult,
  normalizeLogLevel,
  normalizeResponseMode,
  resolveApiKey,
  resolveParserProfile,
  resolveRunConfig,
  runAgent,
  saveConfig,
  spawnAgent,
  splitArgsString,
  startServer,
  verifyAuthorizationHeader,
};
