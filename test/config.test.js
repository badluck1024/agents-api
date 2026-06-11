const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultConfig, resolveRunConfig, selectAgentId } = require('../src/config');

function createConfig() {
  const config = defaultConfig();
  config.defaultAgent = 'codex';
  config.agents.codex.config = '--shared-codex';
  config.agents.claude.config = '--shared-claude';
  config.agents.gemini.config = '--shared-gemini';
  config.projects.webapp = {
    id: 'webapp',
    workingDir: '/srv/webapp',
    agents: {
      codex: { config: '--project-codex' },
      claude: { config: '--project-claude' },
      gemini: { config: '' },
    },
  };
  return config;
}

test('selectAgentId uses requested agent when provided', () => {
  assert.equal(selectAgentId(createConfig(), { agent: 'claude' }, { readyAgentIds: ['codex'] }), 'claude');
  assert.equal(selectAgentId(createConfig(), { provider: 'gemini' }, { readyAgentIds: ['codex'] }), 'gemini');
});

test('selectAgentId prefers ready default agent, then first ready agent', () => {
  assert.equal(selectAgentId(createConfig(), {}, { readyAgentIds: ['codex', 'claude'] }), 'codex');
  assert.equal(selectAgentId(createConfig(), {}, { readyAgentIds: ['gemini'] }), 'gemini');
});

test('resolveRunConfig applies request, project, then shared precedence', () => {
  const config = createConfig();

  assert.equal(
    resolveRunConfig(config, { agent: 'codex', project: 'webapp' }).config,
    '--project-codex'
  );
  assert.equal(
    resolveRunConfig(config, { agent: 'gemini', project: 'webapp' }).config,
    '--shared-gemini'
  );
  assert.equal(
    resolveRunConfig(config, { agent: 'claude', project: 'webapp', config: '--request-claude' }).config,
    '--request-claude'
  );
});

test('resolveRunConfig returns project cwd and errors for unknown projects', () => {
  const config = createConfig();
  const resolved = resolveRunConfig(config, { agent: 'codex', project: 'webapp' });

  assert.equal(resolved.cwd, '/srv/webapp');
  assert.equal(resolved.projectId, 'webapp');
  assert.throws(
    () => resolveRunConfig(config, { agent: 'codex', project: 'missing' }),
    /Progetto non trovato/
  );
});
