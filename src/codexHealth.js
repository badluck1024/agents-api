const { runProcess } = require('./processRunner');

function compactOutput(result) {
  return [result.stdout, result.stderr]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function checkCodexReady(command = 'codex') {
  const version = await runProcess({ command, args: ['--version'] });

  if (version.code !== 0) {
    return {
      installed: false,
      authenticated: false,
      ready: false,
      command,
      version: '',
      error: compactOutput(version) || `Command is not executable: ${command}`,
    };
  }

  const login = await runProcess({ command, args: ['login', 'status'] });

  if (login.code !== 0) {
    return {
      installed: true,
      authenticated: false,
      ready: false,
      command,
      version: compactOutput(version),
      error: compactOutput(login) || 'Codex is not authenticated.',
    };
  }

  return {
    installed: true,
    authenticated: true,
    ready: true,
    command,
    version: compactOutput(version),
    authStatus: compactOutput(login),
  };
}

function formatCodexReadinessFailure(status) {
  if (!status.installed) {
    return [
      'Codex CLI is not installed or is not executable.',
      `Configured command: ${status.command}`,
      status.error ? `Error: ${status.error}` : '',
      'Install Codex CLI and verify it with: codex --version',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'Codex CLI is installed but is not authenticated correctly.',
    `Configured command: ${status.command}`,
    status.version ? `Version: ${status.version}` : '',
    status.error ? `Error: ${status.error}` : '',
    'Run these commands as the same Linux/Windows user that starts agentsapi:',
    '  codex login status',
    '  codex login --device-auth',
    'Then restart agentsapi.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function assertCodexReady(command = 'codex') {
  const status = await checkCodexReady(command);
  if (!status.ready) {
    throw new Error(formatCodexReadinessFailure(status));
  }
  return status;
}

module.exports = {
  assertCodexReady,
  checkCodexReady,
  formatCodexReadinessFailure,
};
