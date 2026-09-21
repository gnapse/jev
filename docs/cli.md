# CLI reference

This reference covers `jev` command behavior. For question definitions and
response fields, use TypeSafe’s [API reference](https://docs.typesafe.ai/api),
[question types](https://docs.typesafe.ai/primitives), and
[model documentation](https://docs.typesafe.ai/models).

## Requests

```sh
jev ask --request request.json
jev ask --request - < request.json
jev ask --questions questions.json --state-file state.json --state-format json
```

`--request` reads a complete request and cannot be combined with `--questions`
or state flags. `--questions` reads only the named question map and combines it
with the supplied state. All questions in a request are sent together.

`choice`, `noul`, and `score` build a single-question request. They accept either
positional instructions or `--instructions-file FILE`, which reads JSON. Use
`--id NAME` to change the default answer key, `result`.

| Command | Inline criteria | JSON file with `--criteria-file FILE` |
| --- | --- | --- |
| `choice` | Repeat `--option LABEL` | Map of labels to descriptions |
| `noul` | Optional `--yes TEXT` and `--no TEXT` | Object with optional `true` and `false` descriptions |
| `score` | Repeat `--level TEXT` in order | Ordered array of level descriptions |

Inline criteria and a criteria file are mutually exclusive. Duplicate Choice
labels are invalid; label punctuation such as `=` and commas is literal. No
fallback option is added automatically. Each convenience command returns the
full API response, just like `ask`.

## Files and stdin

| Option | Meaning |
| --- | --- |
| `--state TEXT` | Literal text, even if it looks like JSON |
| `--state-file FILE` | UTF-8 file; `-` reads stdin |
| `--state-format text\|json` | State file interpretation; default `text` |
| `--max-input-bytes N` | Maximum bytes per input or JSONL line; default 16 MiB |

Without a state flag, `ask --questions` and the convenience commands read piped
stdin as text. Missing state at a terminal is an error. `--state-format` requires
`--state-file`. Complete request files already contain typed state.

Only one input can read stdin. All file flags accept `-`, including config,
headers, questions, criteria, and instructions. Except for text state and JSONL
batch input, these files contain JSON. Paths resolve from the working directory.

JSON must be valid UTF-8, without comments, trailing commas, or duplicate object
keys. Empty stdin is invalid; an explicit empty string in a request or `--state ''`
is valid. Batch files stream and have no fixed total size limit.

## Output and exit status

These output rules apply to CLI commands. `jev mcp` reserves stdout and stdin
for protocol messages; see the [MCP reference](mcp.md).

Successful inference writes the complete API response as one JSON object and a
newline. Answer values, distributions, model ID, usage, and additional response
fields are preserved. `--pretty` indents JSON and is unavailable for batches.
`--help` and `--version` print plain text.

Errors go to stderr as JSON events. For example:

```json
{"type":"error","error":{"code":"AUTH_ERROR","message":"Run jev auth login or set TYPESAFE_API_KEY before calling the API.","retryable":false}}
```

The error object contains `code`, `message`, and `retryable`. It can also contain
`http_status`, `request_id`, and validation `details` with `path` and `rule`.
Use codes and fields in scripts; message text can change. The CLI omits request
bodies, credentials, and raw upstream error bodies from diagnostics.

| Exit | Meaning |
| --- | --- |
| 0 | Success; low probabilities or confidence also succeed |
| 1 | One or more batch records failed |
| 2 | Invalid arguments, config, or input (`INVALID_INPUT`) |
| 3 | Missing credentials or HTTP 401/403 (`AUTH_ERROR`) |
| 4 | HTTP 429 after retries (`RATE_LIMITED`) |
| 5 | Other API error (`API_ERROR`) |
| 6 | Connection failure, timeout, or deadline (`TRANSPORT_ERROR` / `DEADLINE_EXCEEDED`) |
| 7 | Input/output failure (`IO_ERROR`) |
| 8 | Invalid API response (`INVALID_RESPONSE`) |
| 70 | Unexpected CLI defect (`INTERNAL_ERROR`) |
| 130 / 143 | SIGINT / SIGTERM |
| 141 | Downstream pipe closed (`PIPE_CLOSED`) |

Single-request errors produce no stdout result. Stderr is quiet on ordinary
success, except for the batch summary. `--verbose` adds JSON events for request
attempts, timing, and usage. A closed output pipe stops further work.

## Batches

With `--questions`, each JSONL line contains `id` and `state`:

```json
{"id":"ticket-1","state":{"message":"Please cancel my subscription."}}
```

```sh
jev batch --input tickets.jsonl --questions questions.json --concurrency 4
```

Without `--questions`, each line contains `id` and a complete `request`:

```json
{"id":"ticket-1","request":{"state":"Please cancel my subscription.","questions":{"cancel":{"type":"noul","instructions":"Does the message request cancellation?"}}}}
```

Each consumed line produces a result with `line`, `id`, `ok`, and either
`response` or `error`. `line` is the 1-based physical input line and is the
definitive correlation key. IDs must be nonempty strings but need not be unique.
Malformed records can have `id: null`.

- Output defaults to completion order. `--ordered` preserves input order with
  bounded buffering.
- `--concurrency N` limits simultaneous requests; the default is 4.
- Record failures normally let other records continue. `--fail-fast` stops new
  work after the first failure. Authentication errors always stop new work.
  Already scheduled records drain in both cases.
- Blank or malformed lines produce record errors. A final newline adds no
  record; a final nonempty line without a newline is processed. Empty input fails.
- Interruption or output failure can leave records without results. Compare
  output correlation keys against the input before retrying.

The completion summary is a separate stderr event:

```json
{"type":"batch_summary","consumed":2,"succeeded":2,"failed":0,"complete":true,"usage":{"input_tokens":800,"output_tokens":40}}
```

These counts illustrate the output shape. `complete` means the entire input
was consumed without an early stop; check `failed` as well. Setup errors use the
specific exit code above. After processing starts, record errors give exit 1;
interruption, output failure, and CLI defects take precedence.

Each record has its own deadline and retry policy. Batch execution runs in the
CLI process and has no resume or checkpoint storage. Retrying a failed or
interrupted request can consume tokens again.

## Authentication

```sh
jev auth login
jev auth status
jev auth logout
```

`login` reads a hidden terminal prompt, verifies the entered key by listing models,
then saves it. Verification uses the entered key even if `TYPESAFE_API_KEY` is set.
Failed verification leaves the previous saved key intact. It makes no inference
requests. No other command prompts. Without a terminal, supply `--stdin` and pipe
one key from a secret manager or file:

```sh
jev auth login --stdin < /path/to/api-key.txt
```

There is no API-key command-line argument. Login reserves stdin for the key;
`--config` and `--headers-file` must name files. Login accepts the usual transport
options, including `--base-url`, retries, and deadlines. The saved key is used
with the API endpoint selected for each invocation.

The credential source is the first nonempty value in:

```text
TYPESAFE_API_KEY > saved credentials
```

This applies to CLI API calls and `jev mcp`. Desktop agents use the same saved key
when they run under the same user account and config directory. Remote or sandboxed
agents with a separate home directory need their own credentials. Restart a running
MCP server after changing credentials; it loads them at startup.

The file is `~/.config/jev/credentials.json` on macOS/Linux, or
`$XDG_CONFIG_HOME/jev/credentials.json` when `XDG_CONFIG_HOME` is an absolute path.
On Windows it is `%APPDATA%\jev\credentials.json`, falling back to
`%USERPROFILE%\AppData\Roaming\jev\credentials.json`.
The file is **unencrypted**. On macOS/Linux, the directory is mode `0700` and the
file is mode `0600`; Windows uses the user directory's inherited access controls.
Updates replace the file atomically. Do not commit it or copy it into a project.

`status` (also `jev auth`) is offline. It returns `{configured, source, path}`;
`source` is `environment`, `file`, or `none`. It never prints the key and does not
verify API access. Exit 0 means the status was read, even if `configured` is false.
Run `jev models` to verify access.

`login` returns `{saved: true, verified: true, source, path}`. `logout` returns
`{removed, configured, source, path}`. Logout is idempotent and only deletes the
local saved key. It does not revoke the key at TypeSafe or unset environment
variables; `source: "environment"` means that override remains active.

Missing credentials produce `AUTH_ERROR` (exit 3) for API calls. Corrupt, unreadable,
or overly permissive credential files produce `IO_ERROR` (exit 7); login can replace
them. A nonempty environment override bypasses the saved file. Offline CLI validation,
dry runs, and discovery do not read it. Credentials never appear in command output
or diagnostics. Only the interactive login prompt writes plain text to stderr.

## Configuration

Credentials follow the precedence above. Other settings are loaded only from
explicit config files, flags, or the supported environment variables. The CLI does
not discover project config or `.env` files. Select JSON config with `--config FILE`:

```json
{
  "model": "jev-latest",
  "timeout_ms": 10000,
  "deadline_ms": 120000,
  "concurrency": 4,
  "retry": { "maxRetries": 2 }
}
```

```sh
jev --config jev.config.json ask --request request.json
```

Model precedence is:

```text
--model > request.model > TYPESAFE_DEFAULT_MODEL > config.model > jev-latest
```

Other settings resolve from flags, then supported environment variables, then
the selected config, then defaults:

| Setting | Flag | Config key | Environment | Default |
| --- | --- | --- | --- | --- |
| API root | `--base-url` | `base_url` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| Attempt timeout | `--timeout-ms` | `timeout_ms` | — | 10000 ms |
| Total request deadline | `--deadline-ms` | `deadline_ms` | — | 120000 ms |
| Retries after first attempt | `--retries` | `retry.maxRetries` | — | 2 |
| Batch concurrency | `--concurrency` | `concurrency` | — | 4 |
| Input size limit | `--max-input-bytes` | `max_input_bytes` | — | 16777216 bytes |
| Extra headers | `--headers-file` | `headers` | — | None |

The API root must be HTTP(S), without embedded credentials, a query, or a
fragment. Header files contain a JSON object of string values. They merge with
config headers, overriding names case-insensitively. `Authorization` and
`Content-Type` cannot be overridden.

Timeouts, deadlines, concurrency, and size limits are positive integers. Retries
are nonnegative. The total deadline includes attempts and retry delays. Advanced
`retry` fields follow the SDK’s [retry policy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy);
`httpStatuses` is a JSON array. Run `jev schema config` for accepted fields.
Unknown config keys are errors, and config cannot contain an API key.

## Offline validation and discovery

```sh
jev validate --request request.json
jev validate --questions questions.json
jev ask --request request.json --dry-run
jev describe ask --pretty
jev schema request --pretty
```

These commands need no API key. Validation returns `valid` and `warnings`; it
checks structure, not model quality or context fit. Dry-run writes the resolved
request, including its input content. It is also available on `choice`, `noul`,
and `score`.

`describe` exposes command flags, argument names, nested `subcommands`, stdin rules, environment
variables, exit codes, and schema names. `schema` prints JSON Schema 2020-12;
the same definitions are shipped in `schemas/` and used for runtime validation.
Run `jev describe` to discover the full schema catalog.
Use `jev describe auth` or `jev describe "auth login"` for credential commands.

The CLI enforces these input boundaries:

- State must be a string, object, or array. Top-level null is invalid; nested
  nulls are preserved.
- Choice accepts 1–255 options. Score accepts 2–10 non-null levels.
- Full requests allow omitted/null instructions and nullable Noul descriptions.
  Convenience commands require non-null instructions.
- Unknown request/question fields require `--passthrough` on `ask`, `batch`, or
  `validate`. This permits extra fields; it does not bypass known field checks.

Responses are checked for the requested answer IDs, question types, criteria,
and numeric ranges. Additive response fields are preserved. An invalid service
response exits 8 instead of being reported as a successful evaluation.
