# agents-api

[![npm version](https://img.shields.io/npm/v/agents-api.svg)](https://www.npmjs.com/package/agents-api)
[![npm downloads](https://img.shields.io/npm/dm/agents-api.svg)](https://www.npmjs.com/package/agents-api)
[![license](https://img.shields.io/npm/l/agents-api.svg)](https://github.com/badluck1024/agents-api/blob/main/LICENSE)

Run local AI agent CLIs through a small HTTP API.

`agents-api` exposes a consistent API for installed command-line agents such as Codex, Claude Code, and Antigravity CLI. It is designed for machines where one or more supported agents are already available and authenticated.

This package is implemented with Codex.

## Supported Agents

| Agent | CLI command | Non-interactive command used by agents-api |
| --- | --- | --- |
| Codex | `codex` | `codex exec ... <prompt>` |
| Claude Code | `claude` | `claude -p ... <prompt>` |
| Antigravity CLI | `agy` | `agy ... --print <prompt>` |

At least one supported agent must be installed and authenticated before the HTTP server can start.

## Requirements

- Node.js `18` or newer
- npm, pnpm, or another Node package manager
- At least one supported agent CLI installed on the host
- The selected agent authenticated for the same OS user that runs `agentsapi`

## Installation

Install globally from npm:

```bash
npm install -g agents-api
```

Verify the installed version:

```bash
agentsapi --version
```

Expected version:

```text
0.2.7
```

## Quick Start

Check agent availability:

```bash
agentsapi agents status
```

Generate an API token:

```bash
agentsapi auth generate
```

Configure an agent:

```bash
agentsapi config set codex "--json --model gpt-5.5"
agentsapi config set claude "--output-format text --model sonnet"
agentsapi config set antigravity "--model gemini-3.5-flash"
```

Set the fallback agent:

```bash
agentsapi config default set codex
```

Start the server:

```bash
agentsapi serve --host 0.0.0.0 --port 7357
```

Call the API:

```bash
curl http://127.0.0.1:7357/api/runs \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":"codex","prompt":"Write only OK"}'
```

## Agent Status

Check all supported agents:

```bash
agentsapi agents status
```

The command returns a JSON array. Each entry includes:

| Field | Description |
| --- | --- |
| `agent` / `provider` | Agent ID |
| `command` | CLI command used by `agentsapi` |
| `installed` | The command can be executed |
| `authenticated` | Authentication is available for non-interactive use |
| `ready` | The agent can be selected for runs |
| `version` | CLI version when available |
| `authStatus` / `error` | Authentication detail or failure reason |

When the HTTP server starts, it prints a compact line for each agent:

- `READY`: installed and authenticated
- `NOT_AUTHENTICATED`: command exists, but authentication check failed
- `NOT_INSTALLED`: command cannot be executed

If no agent is `READY`, the server exits.

Each supported CLI must be authenticated for the same OS user that starts `agents-api`. Readiness checks use the configured command path with the agent's native status command:

| Agent | Authentication check |
| --- | --- |
| Codex | `codex login status` |
| Claude Code | `claude auth status` |
| Antigravity CLI | `agy models` |

Complete the agent login in its CLI before using that agent through `agents-api`.

Antigravity runs use print mode. For `/api/runs` and `/api/runs/stream`, `agents-api` reads the assistant response from stdout produced by `agy --print`, so the runtime environment that starts `agents-api` must be able to capture that output:

```bash
agy --print "Write only OK"
```

A successful check prints `OK` to stdout. If this command exits successfully but redirected or subprocess output is empty, Antigravity-backed API runs are reported as unsuccessful because there is no assistant output to return.

Public issue reports tracking Antigravity CLI stdout capture behavior: [google-antigravity/antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76), [google-gemini/gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466).

## Configuration

Each agent has a shared argument string. The string is appended to the agent command before the prompt.

```bash
agentsapi config set codex '--json --model gpt-5 -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--model sonnet --permission-mode plan"
agentsapi config set antigravity "--model gemini-3.5-flash"
```

Read or clear a shared configuration:

```bash
agentsapi config get codex
agentsapi config clear claude
```

Set the fallback agent used when a run request does not include `agent` or `provider`:

```bash
agentsapi config default set claude
agentsapi config default get
agentsapi config default clear
```

### Configuration Examples

Configure only agent options. `agentsapi` supplies the command form used to pass the prompt:

| Agent | Command form |
| --- | --- |
| Codex | `codex exec ... <prompt>` |
| Claude Code | `claude -p ... <prompt>` |
| Antigravity CLI | `agy ... --print <prompt>` |

Full automation profile:

```bash
agentsapi config set codex '--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --model gpt-5.5 -c model_reasoning_effort=\"xhigh\"'
agentsapi config set claude "--output-format stream-json --dangerously-skip-permissions --verbose --model claude-opus-4-8 --effort max"
agentsapi config set antigravity "--model gemini-3.5-flash --dangerously-skip-permissions"
```

Machine-readable output without automatic tool approval:

```bash
agentsapi config set codex '--json --model gpt-5.5 -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--output-format json --model sonnet --effort medium"
agentsapi config set antigravity "--model gemini-3.5-flash"
```

Restricted tool execution:

```bash
agentsapi config set codex '--json --model gpt-5.5 --sandbox read-only -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--output-format text --model sonnet --permission-mode plan"
agentsapi config set antigravity "--model gemini-3.5-flash"
```

## Projects

A project binds an ID to a working directory and optional per-agent configuration.

```bash
agentsapi projects add webapp /srv/projects/webapp
```

If the working directory does not exist, it is created.

Set project-level arguments:

```bash
agentsapi projects config webapp codex "--json --model gpt-5 --sandbox workspace-write"
agentsapi projects config webapp claude "--model opus"
agentsapi projects config webapp antigravity "--model gemini-3.5-flash"
```

List or remove projects:

```bash
agentsapi projects list
agentsapi projects remove webapp
```

Configuration precedence:

```text
request config > project agent config > shared agent config
```

## API Authentication

Generate and store a bearer token:

```bash
agentsapi auth generate
```

Check the current authentication state:

```bash
agentsapi auth status
```

Set or clear a token manually:

```bash
agentsapi auth set "token-long-random-value"
agentsapi auth clear
```

You can also provide the token with an environment variable:

```bash
AGENTSAPI_API_KEY="token-long-random-value" agentsapi serve --host 0.0.0.0 --port 7357
```

When a token is configured, requests must include:

```http
Authorization: Bearer <token>
```

When binding to a public host such as `0.0.0.0`, `agentsapi` requires an API token before it starts.

## HTTP Server

Start locally:

```bash
agentsapi serve --host 127.0.0.1 --port 7357
```

Start for remote access:

```bash
agentsapi serve --host 0.0.0.0 --port 7357
```

OpenAPI and Swagger UI:

```text
http://127.0.0.1:7357/openapi.json
http://127.0.0.1:7357/docs
```

Health endpoint:

```text
GET /api/health
```

## Run API

### `POST /api/runs`

Request body:

```json
{
  "agent": "codex",
  "project": "webapp",
  "prompt": "Write only OK",
  "sessionId": "019...",
  "config": "--json --model gpt-5",
  "timeoutMs": 600000,
  "idleTimeoutMs": 30000,
  "responseMode": "normalized"
}
```

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | Prompt passed to the selected agent |
| `agent` | No | `codex`, `claude`, or `antigravity` |
| `provider` | No | Alias of `agent` |
| `project` | No | Project ID used to select working directory and project config |
| `sessionId` | No | Agent session to resume |
| `config` | No | Request-level argument string |
| `timeoutMs` | No | Positive integer timeout in milliseconds |
| `idleTimeoutMs` | No | Positive integer timeout in milliseconds without stdout/stderr output |
| `responseMode` | No | `normalized` or `raw` |

If neither `agent` nor `provider` is provided, the configured fallback agent is used. Without a fallback agent, the request is rejected.

Normalized response:

```json
{
  "responseMode": "normalized",
  "agent": "codex",
  "provider": "codex",
  "project": "webapp",
  "ok": true,
  "exitCode": 0,
  "timedOut": false,
  "idleTimedOut": false,
  "output": "OK",
  "sessionId": "019...",
  "usage": null,
  "errors": [],
  "events": []
}
```

Raw response:

```json
{
  "agent": "codex",
  "prompt": "Write only OK",
  "responseMode": "raw"
}
```

Raw mode returns command metadata, `stdout`, and `stderr`.

If `timeoutMs` is provided and the agent process does not finish in time, `agents-api` terminates the process and returns `timedOut: true`. If `idleTimeoutMs` is provided and the agent process stops producing stdout/stderr output, `agents-api` terminates the process and returns `idleTimedOut: true`.

For Codex, Claude Code, and Antigravity CLI, normalized mode extracts assistant text from the agent output format in use. Structured formats from Codex and Claude Code are mapped to the same response shape as plain text output. Antigravity CLI responses are normalized from `agy --print` text output when that stdout is available to the `agents-api` process.

### Session Resume

Normalized responses include `sessionId` when the selected agent exposes it. Pass that value in a later `/api/runs` or `/api/runs/stream` request to continue the same conversation.

```json
{
  "agent": "codex",
  "project": "webapp",
  "sessionId": "019...",
  "prompt": "Continue from the previous result"
}
```

Session resume uses each agent's native local session store:

| Agent | Resume command shape |
| --- | --- |
| Codex | `codex exec ... resume <sessionId> <prompt>` |
| Claude Code | `claude -p --resume <sessionId> ... <prompt>` |
| Antigravity CLI | `agy --conversation <sessionId> ... --print <prompt>` |

Use the same agent, machine, and project working directory that created the session. Agent session files are local, so a session ID from one machine is not automatically available on another machine.

## Streaming API

### `POST /api/runs/stream`

Uses the same request body as `/api/runs`.

Use this endpoint with agent output formats that emit progressive events. Codex `--json` and Claude Code `--output-format stream-json` are suitable choices. Non-streaming formats such as Claude Code `--output-format json` and Antigravity CLI print mode are valid, but most output is emitted only after the agent process completes.

Normalized stream events:

- `start`
- `session`
- `output`
- `result`
- `reasoning`
- `tool_start`
- `tool`
- `usage`
- `error`
- `exit`

Raw stream events:

- `start`
- `stdout`
- `stderr`
- `error`
- `exit`

Example:

```bash
curl -N http://127.0.0.1:7357/api/runs/stream \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":"claude","prompt":"Write only OK","responseMode":"normalized"}'
```

## CLI Reference

```text
agentsapi serve [--host <host>] [--port <port>] [--log-level <level>]
agentsapi status
agentsapi agents status
agentsapi auth status|generate|set <token>|clear
agentsapi config default get|set <codex|claude|antigravity>|clear
agentsapi config get <codex|claude|antigravity>
agentsapi config set <codex|claude|antigravity> "<agent args>"
agentsapi config clear <codex|claude|antigravity>
agentsapi projects list
agentsapi projects add <id> <working_dir>
agentsapi projects remove <id>
agentsapi projects config <id> [<codex|claude|antigravity> ["<agent args>"|--clear]]
agentsapi run [--agent <codex|claude|antigravity>] [--project <id>] [--session-id <id>] [--timeout-ms <ms>] [--idle-timeout-ms <ms>] [--config "<agent args>"] <prompt>
agentsapi logs get
agentsapi logs level <debug|info|warning|error|off>
agentsapi logs requests <on|off>
agentsapi logs prompt <on|off>
```

## Logging

Set the log level:

```bash
agentsapi logs level info
agentsapi logs level debug
```

Disable request logging:

```bash
agentsapi logs requests off
```

Include prompt text in debug logs:

```bash
agentsapi logs prompt on
```

Runtime override:

```bash
AGENTSAPI_LOG_LEVEL=debug agentsapi serve --host 0.0.0.0 --port 7357
```

Logs are emitted as JSON lines on stdout/stderr.

## Environment Variables

| Variable | Description |
| --- | --- |
| `AGENTSAPI_HOME` | Directory used to store `config.json` |
| `AGENTSAPI_API_KEY` | Bearer token used by the HTTP API |
| `AGENTSAPI_LOG_LEVEL` | Runtime log level |
| `AGENTSAPI_CODEX_COMMAND` | Codex command path/name |
| `AGENTSAPI_CLAUDE_COMMAND` | Claude Code command path/name |
| `AGENTSAPI_ANTIGRAVITY_COMMAND` | Antigravity CLI command path/name |

## Production Notes

For internet-facing deployments:

- bind `agentsapi` to `127.0.0.1` behind a reverse proxy when possible
- expose HTTPS from the proxy
- keep port `7357` private unless explicitly needed
- require a bearer token
- run the process with the same OS user used to authenticate the agent CLIs

## Troubleshooting

Check agent status:

```bash
agentsapi agents status
```

Common cases:

| Symptom | Action |
| --- | --- |
| `NOT_INSTALLED` | Install the agent CLI or configure the command path with the matching environment variable |
| `NOT_AUTHENTICATED` | Run the agent login command as the same OS user that starts `agentsapi` |
| Antigravity run returns empty output | Verify that `agy --print "Write only OK"` prints text when stdout is redirected or captured by the same runtime environment; use a Linux/WSL runtime for Antigravity-backed runs if the local Windows CLI exits with empty captured output |
| `401 Unauthorized` from `agentsapi` | Send `Authorization: Bearer <token>` |
| `400` for a request without `agent` | Pass `agent` or configure a fallback agent with `agentsapi config default set <agent>` |
| `503 Agent unavailable` | Select an installed and authenticated agent |

## License

MIT
