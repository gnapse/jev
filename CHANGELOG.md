# Changelog

## 0.1.1

- Export `createJevMcpServerFactory` and its configuration types from `@gnapse/jev/mcp`
  for hosts that provide their own transport, credentials, and lifecycle.
- Share API concurrency and outstanding-call limits across servers from one factory.

- `jev auth login`, `status`, and `logout` manage a user-level API key shared by CLI and MCP.
- Hidden terminal input or explicit piped input; verify keys before saving with private file permissions.
- Environment credentials override saved credentials. Offline CLI commands do not load the saved key.
- Nested command discovery and JSON output schemas for authentication commands.

## 0.1.0

Initial release of `@gnapse/jev`, with the `jev` CLI and MCP server.

- Full Jev requests and Choice, Noul, and Score commands.
- Text/JSON file input, stdin, structured criteria, and dry runs.
- JSONL batch processing with bounded concurrency and partial failure results.
- Model discovery, offline validation, JSON Schemas, and command discovery.
- Explicit configuration, SDK retries, request deadlines, and cancellation.
- JSON output, stable exit codes, and diagnostics that omit credentials and bodies.
- Runnable examples for CI triage, claim verification, semantic file search, diff labels, and exact email extraction.
- Live compatibility checks; reject null state and null Score levels before API calls.
- Local MCP server with evaluation, bounded batches, model discovery, and offline validation.
- Shared CLI/MCP validation, evaluation, errors, and batch scheduling.
- Bundled `jev` Agent Skill with explicit installation instructions.
