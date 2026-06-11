const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractBearerToken,
  isPublicListenHost,
  maskApiKey,
  resolveApiKey,
  verifyAuthorizationHeader,
} = require('../src/auth');

test('extractBearerToken reads bearer authorization values', () => {
  assert.equal(extractBearerToken('Bearer secret-token'), 'secret-token');
  assert.equal(extractBearerToken('bearer secret-token'), 'secret-token');
  assert.equal(extractBearerToken('Basic secret-token'), '');
});

test('verifyAuthorizationHeader compares bearer token safely', () => {
  assert.equal(verifyAuthorizationHeader('Bearer secret-token', 'secret-token'), true);
  assert.equal(verifyAuthorizationHeader('Bearer wrong-token', 'secret-token'), false);
  assert.equal(verifyAuthorizationHeader('', 'secret-token'), false);
});

test('resolveApiKey prefers environment token over config token', () => {
  const previous = process.env.AGENTSAPI_API_KEY;
  process.env.AGENTSAPI_API_KEY = 'env-token';

  try {
    assert.deepEqual(resolveApiKey({ auth: { apiKey: 'config-token' } }), {
      enabled: true,
      apiKey: 'env-token',
      source: 'env',
      masked: maskApiKey('env-token'),
    });
  } finally {
    if (previous === undefined) {
      delete process.env.AGENTSAPI_API_KEY;
    } else {
      process.env.AGENTSAPI_API_KEY = previous;
    }
  }
});

test('resolveApiKey reads configured token when environment token is absent', () => {
  const previous = process.env.AGENTSAPI_API_KEY;
  delete process.env.AGENTSAPI_API_KEY;

  try {
    assert.equal(resolveApiKey({ auth: { apiKey: 'config-token' } }).source, 'config');
    assert.equal(resolveApiKey({ auth: { apiKey: '' } }).enabled, false);
  } finally {
    if (previous !== undefined) {
      process.env.AGENTSAPI_API_KEY = previous;
    }
  }
});

test('isPublicListenHost classifies loopback and public hosts', () => {
  assert.equal(isPublicListenHost('127.0.0.1'), false);
  assert.equal(isPublicListenHost('localhost'), false);
  assert.equal(isPublicListenHost('0.0.0.0'), true);
  assert.equal(isPublicListenHost('192.168.1.20'), true);
});
