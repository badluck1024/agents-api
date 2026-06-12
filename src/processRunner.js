const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function hasPathSeparator(command) {
  return command.includes('/') || command.includes('\\');
}

function splitPathEnv(env) {
  const value = env.Path || env.PATH || '';
  return value.split(path.delimiter).filter(Boolean);
}

function windowsCandidatePaths(command, env) {
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  const hasExtension = Boolean(path.extname(command));
  const names = hasExtension ? [command] : [...extensions.map((extension) => `${command}${extension.toLowerCase()}`), command];

  if (hasPathSeparator(command)) {
    return names;
  }

  const candidates = [];
  for (const directory of splitPathEnv(env)) {
    for (const name of names) {
      candidates.push(path.join(directory, name));
    }
  }
  return candidates;
}

function resolveWindowsCommand(command, env) {
  if (process.platform !== 'win32') {
    return command;
  }

  for (const candidate of windowsCandidatePaths(command, env)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return command;
}

function readNpmCmdShim(commandPath) {
  try {
    const content = fs.readFileSync(commandPath, 'utf8');
    const match = content.match(/"%dp0%\\([^"]+\.(?:js|cjs|mjs))"/i);
    if (!match) {
      return null;
    }

    const baseDirectory = path.dirname(commandPath);
    const scriptPath = path.join(baseDirectory, match[1].replace(/[\\/]/g, path.sep));
    const bundledNode = path.join(baseDirectory, 'node.exe');
    return {
      command: fs.existsSync(bundledNode) ? bundledNode : 'node',
      argsPrefix: [scriptPath],
    };
  } catch {
    return null;
  }
}

function prepareCommand(command, args, env) {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  const resolvedCommand = resolveWindowsCommand(command, env);
  const extension = path.extname(resolvedCommand).toLowerCase();

  if (extension === '.cmd' || extension === '.bat') {
    const shim = readNpmCmdShim(resolvedCommand);
    if (shim) {
      return {
        command: shim.command,
        args: [...shim.argsPrefix, ...args],
      };
    }

    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', resolvedCommand, ...args],
    };
  }

  return { command: resolvedCommand, args };
}

function spawnProcess({ command, args = [], cwd, env }) {
  const childEnv = {
    ...process.env,
    ...(env || {}),
    GIT_OPTIONAL_LOCKS: process.env.GIT_OPTIONAL_LOCKS || '0',
  };
  const prepared = prepareCommand(command, args, childEnv);

  return spawn(prepared.command, prepared.args, {
    cwd: cwd || process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function killProcessTree(child) {
  if (!child || !child.pid || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      child.kill();
    });
    return;
  }

  child.kill();
}

function runProcess(options) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let completed = false;
    let timedOut = false;
    let idleTimedOut = false;
    let timeout = null;
    let idleTimeout = null;
    let killFallback = null;

    function clearIdleTimeout() {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
    }

    function terminateAfterTimeout(message, kind) {
      if (completed || timedOut || idleTimedOut) {
        return;
      }

      if (kind === 'idle') {
        idleTimedOut = true;
      } else {
        timedOut = true;
      }

      stderr += message;
      clearIdleTimeout();
      killProcessTree(child);
      killFallback = setTimeout(() => {
        finish(1);
      }, 2000);
      if (typeof killFallback.unref === 'function') {
        killFallback.unref();
      }
    }

    function refreshIdleTimeout() {
      const idleTimeoutMs = Number(options.idleTimeoutMs || 0);
      if (!idleTimeoutMs || idleTimeoutMs <= 0 || completed || timedOut || idleTimedOut) {
        return;
      }

      clearIdleTimeout();
      idleTimeout = setTimeout(() => {
        terminateAfterTimeout(`Process produced no output for ${idleTimeoutMs}ms`, 'idle');
      }, idleTimeoutMs);
      if (typeof idleTimeout.unref === 'function') {
        idleTimeout.unref();
      }
    }

    function finish(code) {
      if (completed) {
        return;
      }
      completed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (killFallback) {
        clearTimeout(killFallback);
      }
      clearIdleTimeout();
      resolve({
        code: code === null || code === undefined ? 1 : code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ...(timedOut ? { timedOut: true } : {}),
        ...(idleTimedOut ? { idleTimedOut: true } : {}),
      });
    }

    try {
      child = spawnProcess(options);
    } catch (error) {
      resolve({ code: 1, stdout: '', stderr: error.message, error });
      return;
    }

    if (options.timeoutMs && Number(options.timeoutMs) > 0) {
      timeout = setTimeout(() => {
        if (completed) {
          return;
        }
        terminateAfterTimeout(`Process timed out after ${options.timeoutMs}ms`, 'total');
      }, Number(options.timeoutMs));
    }

    refreshIdleTimeout();

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      refreshIdleTimeout();
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      refreshIdleTimeout();
    });

    child.on('error', (error) => {
      stderr += error.message;
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}

async function commandExists(command, args = ['--version']) {
  const result = await runProcess({ command, args });
  return {
    exists: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  commandExists,
  killProcessTree,
  prepareCommand,
  runProcess,
  spawnProcess,
};
