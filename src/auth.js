const crypto = require('crypto');

function generateApiKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function maskApiKey(value) {
  const apiKey = String(value || '');
  if (!apiKey) {
    return '';
  }
  if (apiKey.length <= 10) {
    return `${apiKey.slice(0, 2)}...`;
  }
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function resolveApiKey(config = {}) {
  const envKey = String(process.env.AGENTSAPI_API_KEY || '').trim();
  if (envKey) {
    return {
      enabled: true,
      apiKey: envKey,
      source: 'env',
      masked: maskApiKey(envKey),
    };
  }

  const configKey = String(config.auth && config.auth.apiKey ? config.auth.apiKey : '').trim();
  if (configKey) {
    return {
      enabled: true,
      apiKey: configKey,
      source: 'config',
      masked: maskApiKey(configKey),
    };
  }

  return {
    enabled: false,
    apiKey: '',
    source: 'none',
    masked: '',
  };
}

function extractBearerToken(authorizationHeader) {
  const value = String(authorizationHeader || '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function timingSafeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyAuthorizationHeader(authorizationHeader, apiKey) {
  const token = extractBearerToken(authorizationHeader);
  if (!token || !apiKey) {
    return false;
  }
  return timingSafeEquals(token, apiKey);
}

function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  );
}

function isPublicListenHost(host) {
  return !isLoopbackHost(host);
}

module.exports = {
  extractBearerToken,
  generateApiKey,
  isPublicListenHost,
  maskApiKey,
  resolveApiKey,
  verifyAuthorizationHeader,
};
