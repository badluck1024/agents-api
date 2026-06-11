# Changelog

All notable changes to this project are documented in this file.

The project follows Semantic Versioning while the public package remains on the `0.2.x` release line.

## Unreleased

### Added

- Automated Node.js test suite for argument parsing, agent command construction, run configuration resolution, output normalization, API authentication, and HTTP run endpoints.

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
