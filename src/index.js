const { checkAgentReady, checkAllAgentsReady } = require('./agentHealth');
const { buildAgentArgs, runAgent, spawnAgent } = require('./agentRunner');
const { getAgent, listAgentIds, normalizeAgentId } = require('./agents');
const { splitArgsString } = require('./argsString');
const { generateApiKey, maskApiKey, resolveApiKey, verifyAuthorizationHeader } = require('./auth');
const {
  createAgentStreamNormalizer,
  createCodexStreamNormalizer,
  normalizeAgentResult,
  normalizeClaudeResult,
  normalizeCodexResult,
  normalizeGeminiResult,
  normalizeResponseMode,
} = require('./codexOutput');
const { defaultConfig, getConfigPath, getStateDir, loadConfig, resolveRunConfig, saveConfig } = require('./config');
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
  generateApiKey,
  getAgent,
  getConfigPath,
  getStateDir,
  listAgentIds,
  loadConfig,
  maskApiKey,
  normalizeAgentId,
  normalizeAgentResult,
  normalizeClaudeResult,
  normalizeCodexResult,
  normalizeGeminiResult,
  normalizeLogLevel,
  normalizeResponseMode,
  resolveApiKey,
  resolveRunConfig,
  runAgent,
  saveConfig,
  spawnAgent,
  splitArgsString,
  startServer,
  verifyAuthorizationHeader,
};
