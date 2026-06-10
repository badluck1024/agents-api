const fs = require('fs');
const { splitArgsString } = require('./argsString');
const { runProcess, spawnProcess } = require('./processRunner');

function buildCodexArgs(configString, prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('Il campo prompt e obbligatorio.');
  }

  return ['exec', ...splitArgsString(configString), prompt];
}

function ensureWorkingDir(cwd) {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory inesistente: ${cwd}`);
  }

  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Working directory non valida: ${cwd}`);
  }
}

async function runCodex({ command, config, prompt, cwd }) {
  ensureWorkingDir(cwd);
  const args = buildCodexArgs(config, prompt);
  const result = await runProcess({ command, args, cwd });

  return {
    command,
    args,
    cwd,
    config,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function spawnCodex({ command, config, prompt, cwd }) {
  ensureWorkingDir(cwd);
  const args = buildCodexArgs(config, prompt);
  const child = spawnProcess({ command, args, cwd });

  return {
    child,
    command,
    args,
    cwd,
    config,
  };
}

module.exports = {
  buildCodexArgs,
  runCodex,
  spawnCodex,
};
