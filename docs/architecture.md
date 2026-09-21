# Architecture

`@gnapse/jev` is one npm package with the `jev` executable, a CLI, and a local
MCP server started by `jev mcp`. Both interfaces use the official TypeSafe SDK
and the same evaluation, validation, and batch implementation.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Executable entry point and process signals |
| `src/core/` | Typed requests and results, schemas, API calls, deadlines, errors, batch scheduling |
| `src/cli/` | Commander commands, file and stdin input, configuration loading, output, exit codes |
| `src/mcp/` | Tool definitions, protocol results, stdio lifecycle, request cancellation and limits |
| `src/test-support/`, `test/` | Shared fixtures, API integration, and MCP protocol tests |
| `scripts/` | Build, package verification, and opt-in live verification |
| `examples/` | Runnable source-checkout examples |
| `skills/jev/` | Agent instructions distributed with the package |

The core does not import either adapter, Commander, or the MCP SDK. It accepts
values, explicit settings, cancellation signals, and optional diagnostic/event
callbacks. It does not read process globals or files, write terminal output, or
choose process exit codes. The CLI maps core errors to exit codes; MCP maps
them to tool errors. API response fields, including probabilities and usage,
are preserved by both adapters.

Credential storage lives in `src/cli/credentials.ts` and is injected at the
executable entry point. CLI API calls and MCP startup resolve the environment key
before falling back to the user credential file. Offline CLI commands skip credential
loading. `auth login` verifies a hidden or piped key before atomically saving it;
status and logout remain offline. The core only receives the resolved key.

## MCP interface

The initial server uses stdio and the official MCP TypeScript SDK. MCP is loaded
only for `jev mcp`. Stdout is reserved for protocol messages; diagnostics use
stderr. The server uses its resolved API key, API endpoint, retries,
and limits. Tool arguments cannot supply credentials, endpoints, headers, or
local file paths.

| Tool | Input and behavior |
| --- | --- |
| `jev_ask` | A request with `state`, `questions`, and optional `model`; supports all three question types and mixed questions |
| `jev_batch` | `records` of `{id, request}`, or `{id, state}` with shared `questions`; returns ordered per-item results and a summary |
| `jev_models` | Empty arguments; lists model cards |
| `jev_validate` | A request; checks it offline and returns warnings |

Tool discovery declares input and output schemas from the same definitions used
for runtime validation. Results include structured JSON and a JSON text fallback.
Failures contain sanitized error codes, retryability, and request IDs when
available. Batch failures retain successful records and identify partial results.
The three primitive CLI shortcuts build ordinary requests; MCP callers use
`jev_ask` directly to avoid separate calls for independent questions over one state.

Each tool call has its own cancellation scope. Cancelling a call aborts its API
work without shutting down the server or cancelling another call. Server shutdown
cancels all outstanding work. One shared limiter bounds concurrent API requests
across calls. Batch size, pending calls, and input bytes also have finite limits;
oversized batches are rejected before inference. Discovery and validation work
without an API key.

`@gnapse/jev/mcp` exports `createJevMcpServerFactory` for embedding the same tools
in another process. The factory captures one shared service and produces fresh
protocol servers for the host's transport. Configuration and credentials are
explicit; this entry point never starts the CLI, reads environment variables or
files, or installs process signal handlers. The host owns HTTP routing, access
control, transport body limits, and shutdown. The internal core stays private.

## Verification and release

CLI regression tests preserve command behavior. Shared fixtures check CLI/MCP
request and response parity. MCP tests use a real protocol client to check
discovery, validation, API errors, batches, cancellation, and process lifecycle.
Package verification installs the tarball independently and exercises both
interfaces and the bundled skill. Live tests remain explicit and use a local
environment key. CI runs on Linux, macOS, and Windows with Node 22 and 24.

The package and both interfaces have one version and one release. Separate npm
packages are only warranted if installation cost or independent release cycles
become a demonstrated need. The internal core remains private.
