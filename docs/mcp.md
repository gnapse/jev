# MCP server

`@gnapse/jev` includes a local MCP server. It exposes the same Jev evaluation,
validation, and batch implementation as the CLI. It uses stdio; your MCP client
starts and stops the process. No listening port or separate server deployment is
needed. Both the 2025 handshake and the 2026-07-28 protocol are supported through
the official MCP SDK.

## Configure a client

After `npm install --global @gnapse/jev`, configure your client to run command
`jev` with arguments `["mcp"]`. Alternatively, use this common client configuration:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "@gnapse/jev@0.1.1", "mcp"]
    }
  }
}
```

Configuration field names depend on the client. Run `jev auth login` once under
the same user account to save a key for both interfaces. The server reads it
directly, so desktop clients do not need to inherit your terminal environment.
Alternatively, supply `TYPESAFE_API_KEY` through the client's environment or secret
settings; it overrides the saved key. See [authentication](cli.md#authentication)
for file locations. Restart the MCP server after changing credentials.
The server does not load `.env` automatically and
never accepts an API key as a tool argument. Discovery and validation work
without credentials. See [TypeSafe](https://console.typesafe.ai) for API keys.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `jev_ask` | `state`, `questions`, optional `model` | Full Jev response: model, answers, and usage |
| `jev_batch` | `records`, optional shared `questions`, optional `fail_fast` | Ordered results and batch summary |
| `jev_models` | `{}` | Model cards under `models` |
| `jev_validate` | Same request as `jev_ask` | `valid: true` and a list of warnings |

Use `jev_ask` for Choice, Noul, Score, or a mix of these question types. Combine
independent questions about the same state into one call. For request semantics
and interpreting probabilities, see TypeSafe's [primitives](https://docs.typesafe.ai/primitives)
and [confidence](https://docs.typesafe.ai/confidence) documentation.

For example, the arguments to `jev_ask` can be:

```json
{
  "state": {"message": "Please cancel my subscription."},
  "questions": {
    "cancel": {
      "type": "noul",
      "instructions": "Does `message` request cancellation?"
    }
  }
}
```

All tools publish input and output JSON Schemas through MCP tool discovery.
Responses include `structuredContent` and a text block containing the same JSON.
These are two representations of one result. API results preserve all answer
fields; the calling agent or script decides which actions to take.

### Batches

Without shared questions, use `records: [{"id":"one","request":{...}}]`.
With `questions`, use `records: [{"id":"one","state":...}]`. Each result has
`index` (1-based input position), `id`, `ok`, and `response` or `error`. Results
are returned in input order. IDs may repeat; use `index` to distinguish records.

The summary reports `consumed`, `succeeded`, `failed`, `complete`, and aggregate
token `usage`. API errors retain successful records. Authentication errors or
`fail_fast: true` stop scheduling new records and drain work already started;
`complete: false` signals that the input was not fully processed. Input schema
errors reject the whole tool call before any inference.

MCP batches are bounded to 100 records per call. Use CLI JSONL batches for larger
streams. A cancelled or timed-out tool call may have consumed tokens without
returning its partial results; avoid retrying whole batches blindly.

## Configuration and limits

`jev mcp --help` lists startup options. The server accepts the CLI's transport
flags and explicit JSON config files; see [configuration](cli.md#configuration).
Model precedence is startup `--model`, request `model`, environment, config,
then `jev-latest`. Credentials, API endpoint, headers, retries, and limits belong
to server configuration and cannot be overridden by tool arguments.

- `--concurrency` bounds API requests across all calls (default 4).
- At most 32 tool calls may be active, with at most 128 API requests waiting.
  A full limit returns `BUSY` with `retryable: true`.
- `--deadline-ms` bounds an entire tool call, including queue time and batches
  (default 120,000). `--timeout-ms` bounds each API attempt (default 10,000).
- `--max-input-bytes` bounds each protocol message and tool arguments (default
  16 MiB). An oversized protocol message closes the connection.
- Cancellation affects that call's work; other calls remain usable. Closing
  stdin or stopping the server cancels all outstanding work.

Stdin and stdout carry only MCP protocol messages. Config and header flags must
name files, not `-`. `--pretty` is rejected. `--verbose` writes sanitized
diagnostics to stderr. The server does not expose filesystem access through tools.

## Errors

Execution failures return `isError: true` with an `error` object containing
`code`, `message`, and `retryable`, plus `http_status`, `request_id`, or validation
details when available. See the [CLI error reference](cli.md#output-and-exit-status) for
shared error meanings. MCP uses tool errors instead of process exit codes;
`BUSY` and `CANCELLED` describe server capacity and request cancellation.
Unknown tools and malformed protocol requests use MCP protocol errors.

A batch containing record failures still returns its result envelope; inspect
the record errors and summary even when `isError` is absent.
