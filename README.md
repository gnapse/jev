# @gnapse/jev

A TypeScript CLI and MCP server for [TypeSafe’s Jev model](https://docs.typesafe.ai),
built for scripts, coding agents, and automation. Ask typed questions about text
or JSON and receive structured answers through either interface.

## Install

Requires **Node.js 22.12 or later**.

```sh
npm install --global @gnapse/jev
jev --help
```

## Quick start

Get an API key from the [TypeSafe console](https://console.typesafe.ai) and set
`TYPESAFE_API_KEY` in your environment:

```sh
export TYPESAFE_API_KEY='your-api-key'

jev choice 'Which team should handle this request?' \
  --option support --option billing --option other \
  --state 'Please update my payment method.'
```

The response contains `model`, `answers`, and `usage`. Convenience commands put
their answer under `answers.result`; use `--id NAME` to choose another key.

The CLI reads the key from its environment. It does not store credentials or
load `.env` files automatically. See [local development](CONTRIBUTING.md) to
run from a checkout with a `.env` file.

## Use in a script

Read state from stdin and save the complete JSON response:

```sh
printf '%s' 'I cannot sign in and need access today.' |
  jev noul 'Does this message ask for urgent help?' > result.json

# Optional: extract a value with jq.
jq '.answers.result.noul' result.json
```

Or rate a text file against ordered levels:

```sh
jev score 'How much does this issue disrupt work?' \
  --level 'No functional impact' \
  --level 'Work can continue with a workaround' \
  --level 'Work cannot continue' \
  --state-file issue.txt
```

Stdout contains JSON, or JSONL for batches. Errors and diagnostics go to stderr.
Commands never prompt. Exit 0 means the request succeeded; your script decides
what the answer means and which action to take. Use `set -o pipefail` in Bash or
Zsh pipelines to preserve upstream failures.

See TypeSafe’s [question types](https://docs.typesafe.ai/primitives) and
[confidence guide](https://docs.typesafe.ai/confidence) for model semantics and
how to interpret answers.

## Commands

| Command | Purpose |
| --- | --- |
| `jev ask` | Submit a complete request or combine question and state files. |
| `jev choice` | Select from named options. |
| `jev noul` | Evaluate a yes/no condition. |
| `jev score` | Rate against ordered levels. |
| `jev batch` | Process JSONL records with bounded concurrency. |
| `jev models` | List available model names. |
| `jev validate` | Validate request or question files offline. |
| `jev schema` | Print a bundled JSON Schema. |
| `jev describe` | Print the command contract for agents and programs. |
| `jev mcp` | Start the local MCP server over stdio. |

Run `jev <command> --help` for flags. The [CLI reference](docs/cli.md) covers
file input, configuration, batch results, and exit codes.

## Request files and batches

Save this as `request.json`:

```json
{
  "state": "Please cancel my subscription before tomorrow’s renewal.",
  "questions": {
    "cancel": {
      "type": "noul",
      "instructions": "Does the message request cancellation?"
    }
  }
}
```

```sh
jev validate --request request.json
jev ask --request request.json
```

For a batch, put a complete request on each JSONL line with a caller-supplied ID:

```json
{"id":"ticket-1","request":{"state":"Please cancel my subscription.","questions":{"cancel":{"type":"noul","instructions":"Does the message request cancellation?"}}}}
```

```sh
jev batch --input requests.jsonl --ordered > results.jsonl
```

For shared questions, use `--questions FILE` with `{ "id": "...", "state": ... }`
records instead. Each result includes `line`, `id`, `ok`, and a `response` or
`error`. Check both the process exit status and record errors before consuming a
batch. See [batch behavior](docs/cli.md#batches) for partial failures and retries.

## MCP server

Configure your MCP client to launch command `jev` with arguments `["mcp"]`, or
use this common configuration to run a pinned npm version:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "@gnapse/jev@0.1.0", "mcp"]
    }
  }
}
```

Supply `TYPESAFE_API_KEY` through your client's environment or secret settings.
The server provides `jev_ask`, `jev_batch`, `jev_models`, and `jev_validate`.
`jev_ask` supports all three question types, including mixed requests. Both
interfaces share validation, API behavior, and complete structured results.

See the [MCP reference](docs/mcp.md) for arguments, limits, cancellation, and
errors. Use the CLI for large JSONL streams; MCP batches accept up to 100 records.

## Agent skill

The npm package includes an [Agent Skills](https://agentskills.io/specification)
skill at [skills/jev/SKILL.md](skills/jev/SKILL.md). It teaches agents how
to prepare requests, group questions, process batches, and handle CLI or MCP results.

After installing `@gnapse/jev` globally, install its skill with the
[skills installer](https://github.com/vercel-labs/skills) (Node.js 22.20+):

```sh
npx skills add "$(npm root -g)/@gnapse/jev/skills/jev" --global
```

The installer lets you select your agent. Omit `--global` to install for the
current project. For a local npm dependency, use `./node_modules/@gnapse/jev/skills/jev`
as the source; from this checkout, use `./skills/jev`. You can also copy the
entire skill directory to your agent's skill directory manually.

Installing `@gnapse/jev` ships the skill files; it does not activate them or modify
agent settings. Rerun the skill installation after updating the CLI to refresh
the installed instructions.

Agents can discover the CLI and validate requests without an API key:

```sh
jev describe
jev schema request
jev ask --request request.json --dry-run
```

The default model is `jev-latest`. Use `--model ID` to pin a version for repeatable
automation. See TypeSafe's [models](https://docs.typesafe.ai/models) and
[API reference](https://docs.typesafe.ai/api) for current service capabilities.

## Examples

The repository's [examples](examples/README.md) include CI failure triage, agent
claim checks, semantic search over files, diff labels, and exact email extraction.
They are not included in the npm package; run them from a source checkout.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, architecture, and release
steps. Changes are listed in the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE).
