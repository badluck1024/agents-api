# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## 0.2.5 - 2026-06-12

### Added

- Run requests can set `idleTimeoutMs` to terminate agent processes that stop producing output.

### Changed

- Gemini CLI runs use the explicit `--prompt` flag for headless execution.

## 0.2.4 - 2026-06-12

### Added

- Run requests can resume an existing agent session by passing `sessionId`.
- Run requests can set `timeoutMs` to terminate long-running agent processes.

### Changed

- Gemini CLI runs now use the positional prompt form.
- Timed-out processes are terminated with their child processes.

## 0.2.3 - 2026-06-11

### Fixed

- Gemini CLI status now uses configured non-interactive authentication instead of calling an interactive auth command.

## 0.2.2 - 2026-06-11

### Added

- Automated Node.js test suite for argument parsing, agent command construction, run configuration resolution, output normalization, API authentication, and HTTP run endpoints.
- CLI commands to configure the fallback agent used when run requests omit `agent` and `provider`.

### Changed

- Run requests use the configured fallback agent when `agent` and `provider` are omitted.
- Agent argument configuration commands require an explicit agent argument.

## 0.2.1 - 2026-06-10

### Added

- GitHub repository metadata in the npm package manifest.
- Normalized output parsing for Claude Code and Gemini CLI JSON and streaming JSON responses.
- Configuration examples for Codex, Claude Code, and Gemini CLI.

### Changed

- Normalized run responses now use agent-specific parsing while raw mode remains a direct process result.

## 0.2.0 - 2026-06-09

### Added

- Multi-agent support for Codex, Claude Code, and Gemini CLI.
- Project-specific configuration for each supported agent.
- Agent status checks during server startup.

## 0.1.3 - 2026-06-09

### Added

- `responseMode` support for normalized and raw run responses.

## 0.1.2 - 2026-06-09

### Added

- API authentication helpers and request logging controls.

## 0.1.1 - 2026-06-09

### Fixed

- Startup checks and Codex execution handling.

## 0.1.0 - 2026-06-09

### Added

- Initial public package with Codex execution through CLI and HTTP API.
