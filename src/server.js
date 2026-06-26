const http = require('http');
const { isPublicListenHost, resolveApiKey, verifyAuthorizationHeader } = require('./auth');
const { loadConfig, resolveRunConfig } = require('./config');
const { createAgentStreamNormalizer, normalizeAgentResult, normalizeResponseMode } = require('./codexOutput');
const { checkAllAgentsReady, formatNoReadyAgentsFailure, readyAgentIds } = require('./agentHealth');
const { runAgent, spawnAgent } = require('./agentRunner');
const { createLogger } = require('./logger');
const { generateOpenApiSpec, swaggerHtml } = require('./openapi');
const { isMultipartFormData, parseMultipartRunRequest } = require('./multipart');
const { killProcessTree } = require('./processRunner');

let nextRequestNumber = 0;
let runtimeAgentStatuses = [];
let runtimeReadyAgentIds = [];
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;

function readRequestBuffer(req, limitBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;

    req.on('data', (chunk) => {
      const buffer = Buffer.from(chunk || '');
      size += buffer.length;
      if (size > limitBytes) {
        failed = true;
        reject(new Error(`Request body is too large. Limit: ${limitBytes} bytes.`));
        req.destroy();
        return;
      }

      chunks.push(buffer);
    });
    req.on('end', () => {
      if (failed) {
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, authorization',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, body, contentType = 'text/plain') {
  res.writeHead(statusCode, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, authorization',
  });
  res.end(body);
}

function readJsonBody(req) {
  return readRequestBuffer(req).then((body) => {
    const text = body.toString('utf8');
    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  });
}

async function readRunRequestBody(req) {
  const contentType = req.headers['content-type'] || '';
  if (isMultipartFormData(contentType)) {
    return parseMultipartRunRequest(await readRequestBuffer(req), contentType);
  }

  return readJsonBody(req);
}

function classifyError(error) {
  const message = error && error.message ? error.message : String(error);

  if (message.startsWith('Project not found')) {
    return { statusCode: 404, message };
  }

  if (message.startsWith('Agent is not available')) {
    return { statusCode: 503, message };
  }

  if (
    message.includes('prompt') ||
    message.includes('sessionId') ||
    message.includes('timeoutMs') ||
    message.includes('idleTimeoutMs') ||
    message.includes('agent or provider') ||
    message.includes('files field') ||
    message.includes('files item') ||
    message.includes('Run file') ||
    message.includes('Duplicate run file path') ||
    message.includes('multipart') ||
    message.includes('Multipart') ||
    message.includes('boundary') ||
    message.includes('Invalid JSON') ||
    message.includes('Unclosed quote') ||
    message.startsWith('Invalid agent')
  ) {
    return { statusCode: 400, message };
  }

  return { statusCode: 500, message };
}

function sseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }, null, 2));
}

function authenticateRequest(req, res, context) {
  const auth = resolveApiKey(context.config);
  if (!auth.enabled) {
    return true;
  }

  if (verifyAuthorizationHeader(req.headers.authorization, auth.apiKey)) {
    context.logger.debug('http_auth_ok', {
      requestId: context.requestId,
      source: auth.source,
    });
    return true;
  }

  context.logger.warning('http_auth_failed', {
    requestId: context.requestId,
    method: req.method,
    path: req.url,
    source: auth.source,
  });
  sendUnauthorized(res);
  return false;
}

function createRequestContext(req, res) {
  const requestId = `${Date.now().toString(36)}-${(nextRequestNumber += 1).toString(36)}`;
  const startedAt = Date.now();
  let config;

  try {
    config = loadConfig();
  } catch {
    config = { logging: { level: 'info', requests: true, includePrompt: false } };
  }

  const logger = createLogger(config.logging);
  const shouldLogRequests = config.logging.requests !== false;
  const remoteAddress = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';

  if (shouldLogRequests) {
    logger.info('http_request_received', {
      requestId,
      method: req.method,
      path: req.url,
      remoteAddress,
    });

    res.on('finish', () => {
      logger.info('http_request_completed', {
        requestId,
        method: req.method,
        path: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
  }

  return {
    config,
    includePromptInLogs: config.logging.includePrompt !== false,
    logger,
    requestId,
  };
}

function logRunRequest(context, body, resolved) {
  const responseMode = normalizeResponseMode(body.responseMode);
  const files = Array.isArray(body.files) ? body.files : [];
  context.logger.info('agent_run_received', {
    requestId: context.requestId,
    agent: resolved.agentId,
    project: resolved.projectId,
    cwd: resolved.cwd,
    responseMode,
    hasRequestConfig: Object.prototype.hasOwnProperty.call(body, 'config'),
    hasSessionId: typeof body.sessionId === 'string' && body.sessionId.trim() !== '',
    timeoutMs: body.timeoutMs || undefined,
    idleTimeoutMs: body.idleTimeoutMs || undefined,
    configLength: String(resolved.config || '').length,
    filesCount: files.length || undefined,
    promptLength: String(body.prompt || '').length,
  });

  context.logger.debug('agent_run_details', {
    requestId: context.requestId,
    agent: resolved.agentId,
    project: resolved.projectId,
    responseMode,
    config: resolved.config,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : undefined,
    timeoutMs: body.timeoutMs || undefined,
    idleTimeoutMs: body.idleTimeoutMs || undefined,
    files: files.map((file) => ({
      path: file && (file.path || file.name),
      encoding: file && file.encoding,
      mimeType: file && file.mimeType,
      contentLength: file && typeof file.content === 'string'
        ? file.content.length
        : file && Buffer.isBuffer(file.buffer)
          ? file.buffer.length
          : undefined,
    })),
  });
}

function logAgentInvocation(context, resolved, invocation) {
  context.logger.debug('agent_run_prompt', {
    requestId: context.requestId,
    agent: resolved.agentId,
    project: resolved.projectId,
    promptTransport: invocation.promptTransport,
    files: invocation.files,
    prompt: context.includePromptInLogs ? invocation.prompt : undefined,
  });
}

function buildRunResponse(result, projectId, responseMode) {
  if (responseMode === 'raw') {
    return {
      responseMode,
      agent: result.agent,
      provider: result.provider,
      project: projectId,
      ...result,
    };
  }

  const normalized = normalizeAgentResult(result);

  return {
    responseMode,
    agent: result.agent,
    provider: result.provider,
    agentVersion: result.agentVersion || '',
    project: projectId,
    ...normalized,
    ...(result.files ? { files: result.files } : {}),
    timedOut: result.timedOut === true,
    idleTimedOut: result.idleTimedOut === true,
    sessionId: normalized.sessionId || result.sessionId || null,
  };
}

function assertRequestedAgentReady(agentId) {
  if (runtimeReadyAgentIds.length > 0 && !runtimeReadyAgentIds.includes(agentId)) {
    throw new Error(`Agent is not available or not authenticated: ${agentId}`);
  }
}

function runtimeAgentVersion(agentId) {
  const status = runtimeAgentStatuses.find((item) => item.agent === agentId);
  return status && status.version ? status.version : '';
}

async function handleRun(req, res, context) {
  const runStartedAt = Date.now();

  try {
    const body = await readRunRequestBody(req);
    const responseMode = normalizeResponseMode(body.responseMode);
    const config = loadConfig();
    const resolved = resolveRunConfig(config, body, { readyAgentIds: runtimeReadyAgentIds });
    assertRequestedAgentReady(resolved.agentId);
    logRunRequest(context, body, resolved);
    const result = await runAgent({
      agentId: resolved.agentId,
      command: config.agents[resolved.agentId].command,
      agentVersion: runtimeAgentVersion(resolved.agentId),
      config: resolved.config,
      prompt: body.prompt,
      cwd: resolved.cwd,
      sessionId: body.sessionId,
      timeoutMs: body.timeoutMs,
      idleTimeoutMs: body.idleTimeoutMs,
      files: body.files,
      onInvocation: (invocation) => logAgentInvocation(context, resolved, invocation),
    });

    sendJson(res, 200, buildRunResponse(result, resolved.projectId, responseMode));
    context.logger.info('agent_run_completed', {
      requestId: context.requestId,
      agent: resolved.agentId,
      project: resolved.projectId,
      responseMode,
      exitCode: result.exitCode,
      durationMs: Date.now() - runStartedAt,
      timedOut: result.timedOut === true,
      idleTimedOut: result.idleTimedOut === true,
      stdoutLength: String(result.stdout || '').length,
      stderrLength: String(result.stderr || '').length,
    });
  } catch (error) {
    const classified = classifyError(error);
    context.logger.error('agent_run_failed', {
      requestId: context.requestId,
      statusCode: classified.statusCode,
      error: classified.message,
    });
    sendJson(res, classified.statusCode, { error: classified.message });
  }
}

async function handleRunStream(req, res, context) {
  const runStartedAt = Date.now();
  let started = false;
  let finished = false;
  let child;
  let run;
  let streamTimedOut = false;
  let streamIdleTimedOut = false;

  try {
    const body = await readRunRequestBody(req);
    const responseMode = normalizeResponseMode(body.responseMode);
    const config = loadConfig();
    const resolved = resolveRunConfig(config, body, { readyAgentIds: runtimeReadyAgentIds });
    assertRequestedAgentReady(resolved.agentId);
    logRunRequest(context, body, resolved);
    run = spawnAgent({
      agentId: resolved.agentId,
      command: config.agents[resolved.agentId].command,
      agentVersion: runtimeAgentVersion(resolved.agentId),
      config: resolved.config,
      prompt: body.prompt,
      cwd: resolved.cwd,
      sessionId: body.sessionId,
      timeoutMs: body.timeoutMs,
      idleTimeoutMs: body.idleTimeoutMs,
      files: body.files,
      onInvocation: (invocation) => logAgentInvocation(context, resolved, invocation),
    });

    child = run.child;
    started = true;
    let runTimeout = null;
    let idleTimeout = null;

    function clearIdleTimeout() {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
    }

    function refreshIdleTimeout() {
      if (!run.idleTimeoutMs || finished || streamTimedOut || streamIdleTimedOut) {
        return;
      }

      clearIdleTimeout();
      idleTimeout = setTimeout(() => {
        if (finished) {
          return;
        }
        streamIdleTimedOut = true;
        sseEvent(res, 'error', {
          error: `Process produced no output for ${run.idleTimeoutMs}ms`,
          idleTimedOut: true,
        });
        killProcessTree(child);
      }, run.idleTimeoutMs);
      if (typeof idleTimeout.unref === 'function') {
        idleTimeout.unref();
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, authorization',
    });

    sseEvent(res, 'start', {
      agent: resolved.agentId,
      provider: resolved.agentId,
      agentVersion: run.agentVersion || '',
      project: resolved.projectId,
      sessionId: run.sessionId || null,
      responseMode,
      ...(responseMode === 'raw'
        ? {
            command: run.command,
            args: run.args,
            cwd: run.cwd,
            config: run.config,
            ...(run.files ? { files: run.files } : {}),
            promptTransport: run.promptTransport,
            timeoutMs: run.timeoutMs,
            idleTimeoutMs: run.idleTimeoutMs,
          }
        : {}),
    });

    refreshIdleTimeout();

    if (run.timeoutMs) {
      runTimeout = setTimeout(() => {
        if (finished) {
          return;
        }
        streamTimedOut = true;
        sseEvent(res, 'error', {
          error: `Process timed out after ${run.timeoutMs}ms`,
          timedOut: true,
        });
        killProcessTree(child);
      }, run.timeoutMs);
      if (typeof runTimeout.unref === 'function') {
        runTimeout.unref();
      }
    }

    const normalizer = createAgentStreamNormalizer(resolved.agentId, resolved.config, {
      agentVersion: run.agentVersion,
    });

    child.stdout.on('data', (chunk) => {
      refreshIdleTimeout();
      if (responseMode === 'raw') {
        sseEvent(res, 'stdout', { data: String(chunk || '') });
        return;
      }

      for (const event of normalizer.pushStdout(chunk)) {
        sseEvent(res, event.type === 'message' ? 'output' : event.type, event);
      }
    });

    child.stderr.on('data', (chunk) => {
      refreshIdleTimeout();
      if (responseMode === 'raw') {
        sseEvent(res, 'stderr', { data: String(chunk || '') });
        return;
      }

      normalizer.pushStderr(chunk);
    });

    child.on('error', (error) => {
      context.logger.error('agent_stream_error', {
        requestId: context.requestId,
        error: error.message,
      });
      sseEvent(res, 'error', { error: error.message });
    });

    child.on('close', (code) => {
      finished = true;
      if (runTimeout) {
        clearTimeout(runTimeout);
      }
      clearIdleTimeout();
      if (run && typeof run.cleanup === 'function') {
        run.cleanup();
      }
      const finalResult = responseMode === 'raw' ? null : normalizer.finish(code);
      const exitPayload = responseMode === 'raw'
        ? {
            responseMode,
            exitCode: code,
            sessionId: run.sessionId || null,
            timedOut: streamTimedOut,
            idleTimedOut: streamIdleTimedOut,
          }
        : {
            responseMode,
            agent: resolved.agentId,
            provider: resolved.agentId,
            project: resolved.projectId,
            ...finalResult,
            timedOut: streamTimedOut,
            idleTimedOut: streamIdleTimedOut,
            sessionId: finalResult.sessionId || run.sessionId || null,
          };
      context.logger.info('agent_stream_completed', {
        requestId: context.requestId,
        agent: resolved.agentId,
        project: resolved.projectId,
        responseMode,
        exitCode: code,
        durationMs: Date.now() - runStartedAt,
      });
      sseEvent(res, 'exit', exitPayload);
      res.end();
    });

    req.on('close', () => {
      if (runTimeout) {
        clearTimeout(runTimeout);
      }
      clearIdleTimeout();
      if (!finished && child && !child.killed) {
        killProcessTree(child);
      }
    });
  } catch (error) {
    const classified = classifyError(error);
    context.logger.error('agent_stream_failed', {
      requestId: context.requestId,
      statusCode: classified.statusCode,
      error: classified.message,
    });
    if (started) {
      if (run && typeof run.cleanup === 'function') {
        run.cleanup();
      }
      sseEvent(res, 'error', { error: classified.message });
      res.end();
      return;
    }
    sendJson(res, classified.statusCode, { error: classified.message });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const context = createRequestContext(req, res);

    if (req.method === 'OPTIONS') {
      sendText(res, 204, '');
      return;
    }

    if (!authenticateRequest(req, res, context)) {
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/docs')) {
      sendText(res, 200, swaggerHtml(), 'text/html');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/openapi.json') {
      sendJson(res, 200, generateOpenApiSpec());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const config = loadConfig();
      sendJson(res, 200, {
        ok: true,
        agents: runtimeAgentStatuses.length > 0 ? runtimeAgentStatuses : [],
        readyAgents: runtimeReadyAgentIds,
        defaultAgent: config.defaultAgent || null,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/runs') {
      handleRun(req, res, context);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/runs/stream') {
      handleRunStream(req, res, context);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

async function startServer({ host, port } = {}) {
  const config = loadConfig();
  const listenHost = host || config.server.host;
  const listenPort = Number(port || config.server.port);
  const logger = createLogger(config.logging);
  const auth = resolveApiKey(config);

  logger.info('agents_preflight_started');
  runtimeAgentStatuses = await checkAllAgentsReady(config);
  runtimeReadyAgentIds = readyAgentIds(runtimeAgentStatuses);
  for (const status of runtimeAgentStatuses) {
    const payload = {
      agent: status.agent,
      command: status.command,
      installed: status.installed,
      authenticated: status.authenticated,
      ready: status.ready,
      version: status.version,
      error: status.error,
    };
    if (status.ready) {
      logger.info('agent_status', payload);
    } else {
      logger.warning('agent_status', payload);
    }
  }

  if (runtimeReadyAgentIds.length === 0) {
    throw new Error(formatNoReadyAgentsFailure(runtimeAgentStatuses));
  }

  logger.info('agents_preflight_completed', {
    readyAgents: runtimeReadyAgentIds,
  });

  if (isPublicListenHost(listenHost) && !auth.enabled) {
    throw new Error([
      'API auth is not configured.',
      `Requested host: ${listenHost}`,
      'Configure a Bearer token before exposing agentsapi publicly:',
      '  agentsapi auth generate',
      'or set:',
      '  AGENTSAPI_API_KEY=long-random-token',
      'Alternatively, listen locally only:',
      '  agentsapi serve --host 127.0.0.1 --port 7357',
    ].join('\n'));
  }

  const server = createServer();

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(listenPort, listenHost, () => {
      logger.info('server_started', {
        url: `http://${listenHost}:${listenPort}`,
        logLevel: logger.level,
        apiAuthEnabled: auth.enabled,
        apiAuthSource: auth.source,
      });
      resolve(server);
    });
  });
}

module.exports = {
  createServer,
  startServer,
};
