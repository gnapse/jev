# Contributing

## Setup

Use the latest Node.js 22 or 24 release and npm for development and release tools.
The installed package supports Node.js 22.12 or later. From the repository root:

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
Credential tests use temporary stores. Package tests set isolated config directories
and exercise login, environment precedence, logout, and saved-key CLI/MCP calls.
They never read or change your saved key.

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

Merges to `main` run the `Publish` workflow. It first runs the full test matrix
on Linux, macOS, and Windows with Node 22 and 24. After all checks pass,
[semantic-release](https://semantic-release.org/) reads commits since the last
release tag, chooses the next version, publishes to npm, and creates a GitHub tag
and release with generated notes.

Use [Conventional Commits](https://www.conventionalcommits.org/) for commits that
reach `main`. When squash-merging, use a conventional PR title for the squash
commit and retain any breaking-change footer in its body.

| Commit | Release |
| --- | --- |
| `fix: ...` or `perf: ...` | Patch, such as `0.1.1` to `0.1.2` |
| `feat: ...` | Minor, such as `0.1.1` to `0.2.0` |
| `feat!: ...` or a `BREAKING CHANGE:` footer | Major, including `0.x` to `1.0.0` |
| `docs: ...`, `ci: ...`, or `chore: ...` without a breaking change | No release |

The highest release type among the new commits wins. Do not manually bump the
package or lockfile version. The npm plugin sets the release version in the CI
checkout before publishing; `prepublishOnly` reruns the checks and `prepack`
builds the executable and schemas using that version. Version changes are not
committed back to `main`, so the source version is not the latest npm version.
Git tags, [GitHub releases](https://github.com/gnapse/jev/releases), and npm are
the release record. [CHANGELOG.md](CHANGELOG.md) records the initial manual releases.

The workflow uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
with OIDC. Its npm configuration must authorize GitHub owner `gnapse`, repository
`jev`, workflow filename `publish.yml`, and direct publishing (`npm publish`).
No `NPM_TOKEN` secret is needed. The workflow's `GITHUB_TOKEN` creates tags and
releases; automated issue and PR comments are disabled.

Version `0.1.1` is the migration baseline. Keep its `v0.1.1` tag on the merged
code from the first two PRs so those commits are not released again.
To retry a run that failed before creating a release tag, rerun `Publish` or
dispatch it on `main`; both paths run the tests before publishing. If tagging or
publishing already started, inspect npm and GitHub first to recover any partial
release. A run with no releasable commits publishes nothing.

Before merging a change, run `npm run check`, the relevant live tests, and
`npm pack --dry-run`. Check the package contents and keep the public documentation
and packaged skill aligned with the implementation.

The package allowlist includes the executable, schemas, agent skill, and documentation.
Runnable examples stay in the repository. Examples, local reports, credentials,
source tests, and CI files are not distributed.
