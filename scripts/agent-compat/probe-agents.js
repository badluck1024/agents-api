#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { checkAgentReady } = require('../../src/agentHealth');
const { runAgent } = require('../../src/agentRunner');
const { listAgentIds } = require('../../src/agents');
const { loadConfig } = require('../../src/config');
const { normalizeAgentResult } = require('../../src/codexOutput');
const { createOutputSignature } = require('../../src/compat/outputSignature');
const { resolveParserProfile } = require('../../src/compat/parserRegistry');

const DEFAULT_PROMPT = 'Write only AGENTS_API_COMPAT_OK';

function parseArgs(argv) {
  const options = {
    agents: [],
    baseline: path.join('test', 'fixtures', 'agent-compat', 'baseline.json'),
    checkBaseline: false,
    idleTimeoutMs: 30000,
    prompt: DEFAULT_PROMPT,
    report: path.join('codex-inner-doc', 'agent-compat', 'latest-report.json'),
    timeoutMs: 90000,
    updateBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === '--') {
      continue;
    } else if (arg === '--agent') {
      options.agents.push(next());
    } else if (arg === '--baseline') {
      options.baseline = next();
    } else if (arg === '--check-baseline') {
      options.checkBaseline = true;
    } else if (arg === '--idle-timeout-ms') {
      options.idleTimeoutMs = Number(next());
    } else if (arg === '--prompt') {
      options.prompt = next();
    } else if (arg === '--report') {
      options.report = next();
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next());
    } else if (arg === '--update-baseline') {
      options.updateBaseline = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function probeCases(agentId) {
  if (agentId === 'codex') {
    return [
      { id: 'prompt-only', config: '' },
      { id: 'text', config: '' },
      { id: 'json', config: '--json' },
      { id: 'stream-json', config: '--json' },
    ];
  }

  if (agentId === 'claude') {
    return [
      { id: 'prompt-only', config: '' },
      { id: 'text', config: '--output-format text' },
      { id: 'json', config: '--output-format json' },
      { id: 'stream-json', config: '--output-format stream-json --verbose --include-partial-messages' },
    ];
  }

  if (agentId === 'antigravity') {
    return [
      { id: 'prompt-only', config: '' },
      { id: 'text', config: '' },
    ];
  }

  return [{ id: 'prompt-only', config: '' }];
}

function compactResult(result) {
  const normalized = normalizeAgentResult(result);
  return {
    agent: result.agent,
    agentVersion: result.agentVersion || '',
    args: result.args,
    config: result.config,
    exitCode: result.exitCode,
    idleTimedOut: result.idleTimedOut === true,
    normalized: {
      ok: normalized.ok,
      eventTypes: normalized.events.map((event) => event.type),
      hasOutput: Boolean(normalized.output),
      hasSessionId: Boolean(normalized.sessionId),
      hasUsage: Boolean(normalized.usage),
      errorCount: normalized.errors.length,
    },
    signature: createOutputSignature(result),
    stderrSample: String(result.stderr || '').slice(0, 1000),
    stdoutSample: String(result.stdout || '').slice(0, 1000),
    timedOut: result.timedOut === true,
  };
}

function baselineKey(agentId, caseId) {
  return `${agentId}/${caseId}`;
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createBaselineEntries(report) {
  const entries = {};
  for (const agent of report.agents) {
    for (const probe of agent.probes) {
      entries[baselineKey(agent.agent, probe.id)] = {
        agent: agent.agent,
        probe: probe.id,
        version: agent.version,
        parserId: probe.parser.parserId,
        promptMode: probe.parser.promptMode,
        signature: probe.result.signature,
      };
    }
  }
  return entries;
}

function reportAgentIds(report) {
  return new Set((report.agents || []).map((agent) => agent.agent));
}

function lineShapeKeys(signature) {
  return new Set((signature.stdoutLineShapes || []).map((shape) => JSON.stringify(shape)));
}

function signaturesChanged(previousSignature, actualSignature) {
  if (JSON.stringify(previousSignature) === JSON.stringify(actualSignature)) {
    return false;
  }

  if (
    previousSignature &&
    actualSignature &&
    previousSignature.kind === 'jsonl' &&
    actualSignature.kind === 'jsonl' &&
    previousSignature.stderrPresent === actualSignature.stderrPresent
  ) {
    const previousShapes = lineShapeKeys(previousSignature);
    return [...lineShapeKeys(actualSignature)].some((shape) => !previousShapes.has(shape));
  }

  return true;
}

function compareBaseline(report, baseline) {
  const expected = baseline && baseline.entries ? baseline.entries : {};
  const actual = createBaselineEntries(report);
  const includedAgents = reportAgentIds(report);
  const changes = [];

  for (const [key, value] of Object.entries(actual)) {
    const previous = expected[key];
    if (!previous) {
      changes.push({ key, type: 'new-probe' });
      continue;
    }

    if (signaturesChanged(previous.signature, value.signature) || previous.parserId !== value.parserId) {
      changes.push({
        key,
        type: 'changed-format',
        previousParserId: previous.parserId,
        parserId: value.parserId,
      });
    }
  }

  for (const key of Object.keys(expected)) {
    const expectedAgent = key.split('/')[0];
    if (!includedAgents.has(expectedAgent)) {
      continue;
    }
    if (!actual[key]) {
      changes.push({ key, type: 'missing-probe' });
    }
  }

  return changes;
}

async function runProbe(options) {
  const config = loadConfig();
  const agentIds = options.agents.length > 0 ? options.agents : listAgentIds();
  const report = {
    generatedAt: new Date().toISOString(),
    prompt: options.prompt,
    agents: [],
  };

  for (const agentId of agentIds) {
    const agentConfig = config.agents && config.agents[agentId] ? config.agents[agentId] : {};
    const status = await checkAgentReady(agentId, agentConfig, {
      cwd: process.cwd(),
      timeoutMs: Math.min(options.timeoutMs, 30000),
    });
    const agentReport = {
      agent: agentId,
      command: agentConfig.command || agentId,
      ready: status.ready,
      version: status.version || '',
      status,
      probes: [],
    };

    if (status.ready) {
      for (const probe of probeCases(agentId)) {
        const parser = resolveParserProfile({
          agentId,
          version: status.version || '',
          configString: probe.config,
        });
        const result = await runAgent({
          agentId,
          command: agentConfig.command || agentId,
          config: probe.config,
          prompt: options.prompt,
          cwd: process.cwd(),
          agentVersion: status.version || '',
          timeoutMs: options.timeoutMs,
          idleTimeoutMs: options.idleTimeoutMs,
        });

        agentReport.probes.push({
          id: probe.id,
          parser,
          result: compactResult(result),
        });
      }
    }

    report.agents.push(agentReport);
  }

  const baselinePath = path.resolve(options.baseline);
  const baseline = loadJson(baselinePath, { entries: {} });
  report.baseline = {
    path: baselinePath,
    changes: compareBaseline(report, baseline),
  };

  writeJson(path.resolve(options.report), report);

  if (options.updateBaseline) {
    writeJson(baselinePath, {
      generatedAt: report.generatedAt,
      entries: {
        ...((baseline && baseline.entries) || {}),
        ...createBaselineEntries(report),
      },
    });
  }

  if (options.checkBaseline && report.baseline.changes.length > 0) {
    const error = new Error(`Agent compatibility baseline changed: ${report.baseline.changes.length} change(s)`);
    error.report = report;
    throw error;
  }

  return report;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runProbe(options);
    console.log(JSON.stringify({
      generatedAt: report.generatedAt,
      agents: report.agents.map((agent) => ({
        agent: agent.agent,
        ready: agent.ready,
        version: agent.version,
        probes: agent.probes.length,
      })),
      baselineChanges: report.baseline.changes.length,
      report: path.resolve(options.report),
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  compareBaseline,
  createBaselineEntries,
  parseArgs,
  probeCases,
  runProbe,
};
