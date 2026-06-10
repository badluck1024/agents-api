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
      error: compactOutput(version) || `Comando non eseguibile: ${command}`,
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
      error: compactOutput(login) || 'Codex non risulta autenticato.',
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
      'Codex CLI non risulta installato o non e eseguibile.',
      `Comando configurato: ${status.command}`,
      status.error ? `Errore: ${status.error}` : '',
      'Installa Codex CLI e verifica con: codex --version',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'Codex CLI e installato ma non risulta autenticato correttamente.',
    `Comando configurato: ${status.command}`,
    status.version ? `Versione: ${status.version}` : '',
    status.error ? `Errore: ${status.error}` : '',
    'Esegui sulla stessa utenza Linux/Windows che avvia agentsapi:',
    '  codex login status',
    '  codex login --device-auth',
    'Poi riavvia agentsapi.',
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
