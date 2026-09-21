---
name: jev
description: Use the Jev CLI or MCP tools to get typed judgments from TypeSafe's Jev model. Use when working with @gnapse/jev or adding classification, ranking, extraction, or verification to shell scripts and coding-agent workflows.
license: MIT
---

# Jev

Use Jev for typed judgments over text or JSON. It returns structured answers,
not generated prose. Keep exact parsing, arithmetic, sorting, and actions in
the caller's code.

## Choose and discover the interface

If Jev MCP tools are already connected, use their advertised schemas and call
`jev_ask`, `jev_batch`, `jev_models`, or `jev_validate` directly. Otherwise use the
CLI. Prefer CLI JSONL batches for large streams. Do not launch a new MCP process
for each judgment; the client manages the server with `jev mcp`.

The npm package is `@gnapse/jev`; the executable is `jev`. It requires Node.js
22.12+ and `TYPESAFE_API_KEY` in the environment for API calls. The CLI does not
load `.env` automatically or accept an API key argument. If credentials are
missing, request environment setup rather than asking for a key in chat.

Use these offline commands when you need the installed version's contract:

```sh
jev --version
jev describe
jev describe batch
jev schema request
```

If `jev` is unavailable, use an existing local installation or set up `@gnapse/jev`
as part of the requested task. In its source checkout, run `npm run build` and
use `node dist/index.js` in place of `jev`.

## Choose the request shape

- `choice` selects one label. Supply a fallback option when no candidate may fit.
- `noul` estimates whether a condition holds. Use separate questions when several
  labels may apply. Its value near 0.5 means uncertainty, not medium intensity.
- `score` rates along 2–10 ordered levels. Reuse one rubric across items before
  sorting their scores; do not compare Choice probabilities across different
  candidate sets as a relevance scale.
- `ask` sends named questions together over one state. Combine independent
  judgments in one request. They cannot see each other's answers; a dependent
  step needs a new request after its required evidence is available.

Question IDs are for code. Put the complete judgment in `instructions` and
reference the relevant state fields explicitly. For detailed model guidance,
read TypeSafe's [question types](https://docs.typesafe.ai/primitives) and
[confidence guide](https://docs.typesafe.ai/confidence).

For example, send two independent judgments in one request:

```sh
jev ask --request - <<'JSON'
{
  "state": {"message": "I cannot sign in and my work is blocked."},
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Which team should handle the request in `message`?",
      "criteria": {
        "support": "Product errors and access problems",
        "billing": "Payments and subscriptions",
        "other": "Neither team fits the request"
      }
    },
    "blocked": {
      "type": "noul",
      "instructions": "Does `message` state that work cannot continue?"
    }
  }
}
JSON
```

Use `jev validate --request request.json` or `jev ask --request request.json
--dry-run` before sending an unfamiliar request shape. Both are offline; dry-run
prints the input content. Select a versioned model with `--model ID` for
repeatable automation; the default is the moving alias `jev-latest`.

## Files, stdin, and batches

MCP tools take JSON values, not local paths or CLI flags. Pass the request object
directly to `jev_ask` or `jev_validate`. MCP `jev_batch` accepts up to 100
`records`, with the same `{id, request}` or shared `questions` plus `{id, state}`
forms below. It returns ordered `results` with 1-based `index`, and `summary`.
Credentials and API endpoint belong to server configuration, never tool arguments.

`--state` is always literal text. `--state-file` also reads text unless paired
with `--state-format json`. Full request files already contain typed state.
Only one input can read stdin; keep other inputs in files. Serialize dynamic
JSON with code instead of inserting raw input into shell commands.

For many states with shared questions:

```sh
jev batch --input records.jsonl --questions questions.json --ordered > results.jsonl
```

Each input line is `{"id":"record-1","state":...}`. Without `--questions`, use
`{"id":"record-1","request":...}`. Batch output includes `line`, `id`, `ok`, and
either `response` or `error`. Default output order is completion order; use the
1-based `line` for correlation. `--ordered` preserves input order.

## Consume results and handle failures

MCP results provide structured JSON and a text fallback containing the same data;
consume one representation. Check `isError` for tool failures. A batch can return
without `isError` while individual records failed: inspect each `ok` and
`summary.complete`. Cancellation and deadline errors may hide partial work that
already consumed tokens. `BUSY` means capacity is temporarily full.

Convenience commands return `answers.result`; `--id NAME` changes that key.
`ask` returns answers under the supplied question IDs. Retain the model ID,
usage, and raw answer probabilities. Choose action thresholds in caller code;
confidence does not establish correctness or authorize an action.

Exit 0 means the evaluation succeeded, including low-probability answers. Batch
exit 1 means at least one record failed. Check every record before consuming a
partial result. Exit 2 requires an input fix; exit 3 requires credential or
account setup. Use `jev describe` for the full exit-code map.

The CLI already retries transient errors within a request deadline. Avoid
unbounded outer retry loops. `--fail-fast` stops scheduling after a record error
but drains started work. Interrupted batches can omit pending or unread records;
compare input/output correlation keys before retrying, which can consume tokens
again. Diagnostics go to stderr, separately from JSON/JSONL stdout.
