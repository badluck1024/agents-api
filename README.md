# agents-api

Run local AI agent CLIs through a small HTTP API.

`agents-api` exposes a consistent API for installed command-line agents such as Codex, Claude Code, and Gemini CLI. It is designed for machines where one or more supported agents are already available and authenticated.

This package is implemented with Codex.

## Supported Agents

| Agent | CLI command | Non-interactive command used by agents-api |
| --- | --- | --- |
| Codex | `codex` | `codex exec ... <prompt>` |
| Claude Code | `claude` | `claude -p ... <prompt>` |
| Gemini CLI | `gemini` | `gemini ... -p <prompt>` |

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
0.2.3
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
agentsapi config set gemini "--output-format json --model gemini-3-pro-preview"
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
  -d '{"agent":"codex","prompt":"Write only CIAO"}'
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

For Gemini CLI, authentication status is based on the configured non-interactive auth method, such as `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA`, or the Gemini CLI settings file.

## Configuration

Each agent has a shared argument string. The string is appended to the agent command before the prompt.

```bash
agentsapi config set codex '--json --model gpt-5 -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--model sonnet --permission-mode plan"
agentsapi config set gemini "--model gemini-2.5-pro"
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
| Gemini CLI | `gemini ... -p <prompt>` |

Full automation profile:

```bash
agentsapi config set codex '--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --model gpt-5.5 -c model_reasoning_effort=\"xhigh\"'
agentsapi config set claude "--output-format stream-json --dangerously-skip-permissions --verbose --model claude-opus-4-8 --effort max"
agentsapi config set gemini "--output-format stream-json --model gemini-3-pro-preview --approval-mode yolo"
```

Machine-readable output without automatic tool approval:

```bash
agentsapi config set codex '--json --model gpt-5.5 -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--output-format json --model sonnet --effort medium"
agentsapi config set gemini "--output-format json --model gemini-3-pro-preview --approval-mode default"
```

Restricted tool execution:

```bash
agentsapi config set codex '--json --model gpt-5.5 --sandbox read-only -c model_reasoning_effort=\"medium\"'
agentsapi config set claude "--output-format text --model sonnet --permission-mode plan"
agentsapi config set gemini "--output-format text --model gemini-3-pro-preview --approval-mode default"
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
agentsapi projects config webapp gemini "--model gemini-2.5-pro"
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
  "prompt": "Write only CIAO",
  "config": "--json --model gpt-5",
  "responseMode": "normalized"
}
```

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | Prompt passed to the selected agent |
| `agent` | No | `codex`, `claude`, or `gemini` |
| `provider` | No | Alias of `agent` |
| `project` | No | Project ID used to select working directory and project config |
| `config` | No | Request-level argument string |
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
  "output": "CIAO",
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
  "prompt": "Write only CIAO",
  "responseMode": "raw"
}
```

Raw mode returns command metadata, `stdout`, and `stderr`.

For Codex, Claude Code, and Gemini CLI, normalized mode extracts the assistant text from the agent output format in use. Text output, JSON output, and streaming JSON output are mapped to the same response shape.

## Streaming API

### `POST /api/runs/stream`

Uses the same request body as `/api/runs`.

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
  -d '{"agent":"claude","prompt":"Write only CIAO","responseMode":"normalized"}'
```

## CLI Reference

```text
agentsapi serve [--host <host>] [--port <port>] [--log-level <level>]
agentsapi status
agentsapi agents status
agentsapi auth status|generate|set <token>|clear
agentsapi config default get|set <codex|claude|gemini>|clear
agentsapi config get <codex|claude|gemini>
agentsapi config set <codex|claude|gemini> "<agent args>"
agentsapi config clear <codex|claude|gemini>
agentsapi projects list
agentsapi projects add <id> <working_dir>
agentsapi projects remove <id>
agentsapi projects config <id> [<codex|claude|gemini> ["<agent args>"|--clear]]
agentsapi run [--agent <codex|claude|gemini>] [--project <id>] [--config "<agent args>"] <prompt>
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
| `AGENTSAPI_GEMINI_COMMAND` | Gemini CLI command path/name |

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
| `401 Unauthorized` from `agentsapi` | Send `Authorization: Bearer <token>` |
| `400` for a request without `agent` | Pass `agent` or configure a fallback agent with `agentsapi config default set <agent>` |
| `503 Agente non disponibile` | Select an installed and authenticated agent |

## License

MIT
