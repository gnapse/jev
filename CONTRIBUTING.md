# Contributing

## Setup

Use Node.js 22.12 or later and npm. From the repository root:

```sh
npm ci
npm run build
node dist/index.js --help
```

`npm run dev` watches TypeScript source. Optionally run `npm link` to make this
checkout available as `jev` in your shell.

## Checks

```sh
npm run check
```

This type-checks, runs the offline tests, builds, packs, and tests a fresh npm
installation through the CLI and real MCP clients against a local mock API.
No TypeSafe key is needed. CI runs this
command on Linux, macOS, and Windows with Node 22 and 24.

For focused checks, use `npm test`, `npm run type-check`, or
`npm run test:package`.

### Live tests

Copy `.env.example` to `.env` and set `TYPESAFE_API_KEY`, or inject the variable
through your environment. `.env` is ignored by Git and excluded from the package.
An existing environment variable takes precedence over the file.

```sh
# Eleven inference requests plus CLI and MCP model discovery.
npm run test:live

# Run the example cases: 23 inference requests.
npm run examples:live

# Run an individual command with the local key.
node --env-file=.env dist/index.js models
```

These tests make real API calls and consume tokens. Live commands explicitly
load `.env`; the distributed CLI does not. Save any local reports under `reports/`,
which is ignored by Git and excluded from the npm package. Keep committed
fixtures synthetic and free of credentials.

## Architecture

See [architecture](docs/architecture.md) for the repository layout and shared
core contract. Commander handles CLI parsing through registrars under
`src/cli/commands/`. `createProgram(context)` builds a fresh command tree with
injected streams, files, environment, and transport. MCP uses the official SDK's
protocol server with the same JSON Schemas and AJV validation as the CLI.

Add CLI commands through a registrar with discovery metadata. Add MCP tools in
`src/mcp/server.ts` with input and output schemas. Keep shared behavior under
`src/core/`, independent of files, terminal output, and either interface. Throw
`JevError` for shared failures; the CLI maps it to an exit status and MCP maps it
to a tool result. API calls use the official TypeSafe SDK for HTTP and retries.

Edit `src/`, not generated `dist/` or `schemas/`. `npm run build` compiles the
production source and generates schemas from runtime definitions. Tests stay
outside the compiled package. Update the [CLI reference](docs/cli.md) when
changing public behavior, and update the [MCP reference](docs/mcp.md) for tool
changes. Link to TypeSafe for upstream concepts and API details.

## Agent skill

Keep `skills/jev/SKILL.md` aligned with both interfaces when changing commands or
output contracts. It follows the [Agent Skills format](https://agentskills.io/specification)
and the [npm directory convention](https://github.com/antfu/skills-npm/blob/main/PROPOSAL.md).
The `files` allowlist ships it with the same version as the executable.

Keep it self-contained: skill installers can copy the folder away from the
package. Use MCP discovery or `jev describe` and `jev schema` for detailed contracts,
and link to TypeSafe for model guidance. References to `../../docs` or repository
examples would break after copying. Preview discovery without installing:

```sh
npx skills add ./skills/jev --list
```

## Release

1. Update the version in `package.json` and `package-lock.json`, and document
   changes in [CHANGELOG.md](CHANGELOG.md).
2. Run `npm run check` and the relevant live tests. Check CI on all supported
   platforms.
3. Inspect `npm pack --dry-run` for the intended files.
4. With an authorized npm account, run `npm publish --access public`.

`prepublishOnly` runs the offline checks; `prepack` builds the executable and
schemas. Publishing is a manual action. During 0.x, use minor releases for
interface breaks and patch releases for compatible fixes.

The package allowlist includes the executable, schemas, agent skill, and documentation.
Runnable examples stay in the repository. Examples, local reports, credentials,
source tests, and CI files are not distributed.
