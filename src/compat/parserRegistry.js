const { splitArgsString } = require('../argsString');
const { extractVersionNumber, satisfiesVersionRange } = require('./version');

const COMPATIBILITY_PROFILES = [
  {
    agent: 'codex',
    profileId: 'codex-v1',
    versionRange: '*',
    promptMode: 'positional',
    formats: {
      text: { parserId: 'codex-text-v1' },
      jsonl: { parserId: 'codex-jsonl-v1' },
    },
  },
  {
    agent: 'claude',
    profileId: 'claude-v1',
    versionRange: '*',
    promptMode: 'print-positional',
    formats: {
      text: { parserId: 'generic-text-v1' },
      json: { parserId: 'claude-json-v1' },
      'stream-json': { parserId: 'claude-stream-json-v1' },
    },
  },
  {
    agent: 'antigravity',
    profileId: 'antigravity-v1',
    versionRange: '*',
    promptMode: 'print-flag',
    formats: {
      text: { parserId: 'generic-text-v1' },
    },
  },
];

function readOption(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1] || '';
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return '';
}

function hasArg(args, name) {
  return args.includes(name);
}

function detectOutputFormatForAgent(agentId, configString = '') {
  let args = [];
  try {
    args = splitArgsString(configString);
  } catch {
    return 'text';
  }

  if (agentId === 'codex') {
    return hasArg(args, '--json') ? 'jsonl' : 'text';
  }

  if (agentId === 'antigravity') {
    return 'text';
  }

  return readOption(args, '--output-format').trim().toLowerCase() || 'text';
}

function profileSpecificity(profile) {
  return profile.versionRange === '*' ? 0 : profile.versionRange.length;
}

function findProfile(agentId, versionText) {
  const matching = COMPATIBILITY_PROFILES
    .filter((profile) => profile.agent === agentId)
    .filter((profile) => satisfiesVersionRange(versionText, profile.versionRange))
    .sort((left, right) => profileSpecificity(right) - profileSpecificity(left));

  return matching[0] || null;
}

function resolveParserProfile({ agentId, version = '', configString = '', outputFormat = '' } = {}) {
  const normalizedAgent = String(agentId || '').trim().toLowerCase();
  const profile = findProfile(normalizedAgent, version);
  const detectedFormat = outputFormat || detectOutputFormatForAgent(normalizedAgent, configString);
  const fallback = {
    agent: normalizedAgent,
    agentVersion: extractVersionNumber(version),
    versionText: String(version || ''),
    profileId: 'generic',
    versionRange: '*',
    outputFormat: detectedFormat || 'text',
    promptMode: 'unknown',
    parserId: 'generic-text-v1',
  };

  if (!profile) {
    return fallback;
  }

  const format = profile.formats[detectedFormat] ? detectedFormat : 'text';
  const formatProfile = profile.formats[format] || { parserId: 'generic-text-v1' };
  return {
    agent: normalizedAgent,
    agentVersion: extractVersionNumber(version),
    versionText: String(version || ''),
    profileId: profile.profileId,
    versionRange: profile.versionRange,
    outputFormat: format,
    promptMode: profile.promptMode,
    parserId: formatProfile.parserId,
  };
}

module.exports = {
  COMPATIBILITY_PROFILES,
  detectOutputFormatForAgent,
  resolveParserProfile,
};
