# CLI examples

These examples use Jev to answer small questions inside a script. The script owns
file handling, exact values, sorting, thresholds, and any later action.
The examples are part of the source repository and are not shipped in the npm package.

| Example | Useful for | Model questions |
| --- | --- | --- |
| [CI triage](ci-triage/questions.json) | Route failed jobs and flag possible temporary failures | Choice + Noul |
| [Claim verification](verify-claims/questions.json) | Check an agent's completion claims against captured evidence | Choice |
| [Semantic search](semantic-search/run.mjs) | Find passages that answer a question in local text files | Score + Noul |
| [Diff checks](diff-checks/questions.json) | Suggest review labels from a staged patch | Three independent Nouls |
| [Exact email extraction](extract-email/run.mjs) | Select a receipt destination from several literal addresses | Dynamic Choice + code |
| [Support triage](triage.request.json) | Route a message and assess urgency and work disruption | Choice + Noul + Score |

## Run the bundled cases

Build the checkout and configure a key as described in
[Contributing](../CONTRIBUTING.md#live-tests), then run from the repository root:

```sh
npm run examples:live

# Run just one workflow, retaining full answers and expected outcomes.
node --env-file=.env examples/run.mjs verify-claims --check

# Save a machine-readable report. Progress goes to stderr.
mkdir -p reports
node --env-file=.env examples/run.mjs all --check > reports/examples.json
```

The runner covers **24 synthetic cases in 23 API requests**. The
no-email case needs no model. `--check` exits 1 if a demonstration expectation
fails; without it, the report includes failures but the process exits 0. Transport
or CLI errors always fail the runner. These calls use API tokens.

The runner pins `jev-1.13.0`. Each response retains all probabilities, confidence,
resolved model, and token usage. Expectations are deliberately broad: categorical
labels, Noul ranges below 0.25 or above 0.75, and selected Score ranges. They are
demo checks, not calibrated production thresholds or a benchmark.

Below, `jev` assumes an installed CLI and a key in its environment. For this
checkout, replace `jev` with `node --env-file=.env dist/index.js`. The example
scripts also need the key in their environment; they do not discover `.env`.
Commands using `jq` require a separate installation. Use `set -o pipefail` in
Bash or Zsh when composing pipelines so upstream failures reach the caller.

## CI failure triage

The cases cover download timeouts, dependency conflicts, compiler errors, failed
assertions, harmless warnings, and missing output. The questions distinguish the
observed cause from evidence that a failure could clear on retry.

```sh
jev batch --input examples/ci-triage/cases.jsonl \
  --questions examples/ci-triage/questions.json --model jev-1.13.0 > triage.jsonl

# Or classify one captured log. jq wraps the text in the required state field.
jq -Rs '{log: .}' build.log | jev ask \
  --questions examples/ci-triage/questions.json \
  --state-file - --state-format json --model jev-1.13.0
```

A successful inference exits 0 even if the log describes a failed job. Inspect
`answers.cause.choice` and `answers.transient.noul`. Keep retry count, delay,
known error-code handling, and permitted actions in code. `unknown` means the
captured evidence does not justify a specific category.

## Verify an agent's claim

Pass one claim and the evidence that could establish it. The examples include a
passing suite, a failed suite, untested platforms, an unexecuted plan, and a
performance claim with no benchmark.

```sh
jq -n --arg claim 'The parser suite passed on macOS.' \
  --rawfile evidence test-output.txt '{claim: $claim, evidence: $evidence}' |
  jev ask --questions examples/verify-claims/questions.json \
    --state-file - --state-format json --model jev-1.13.0
```

`supported`, `contradicted`, and `insufficient` have different meanings. An absent
Linux result does not prove Linux failed. A statement that a command has not run
does contradict a claim that it completed. This checks the supplied evidence;
it does not run tests or verify whether an agent supplied truthful evidence.

## Semantic search over local files

```sh
node --env-file=.env examples/semantic-search/run.mjs \
  'How can Acme CLI parse JSON state from stdin?' \
  examples/semantic-search/guide.txt

# Replace the query and paths with your own small text files.
node --env-file=.env examples/semantic-search/run.mjs \
  'How do I configure request retries?' README.md docs/cli.md
```

This script sends the named files to the API. It creates overlapping 30-line
passages, submits them through `jev batch`, and sorts the results in code. Each
hit includes its path, 1-based line range, original text, and full response. It
limits a run to 32 passages and each input file to 256 KiB; narrow files with
ordinary search first when the source is larger. Overlapping hits may repeat.

`relevance` uses the same 0–3 rubric for every passage. `has_answer` uses the
separate `answers_query` Noul with an illustrative threshold of 0.8. All hits are
returned so a caller can inspect uncertainty. A top-ranked passage need not
contain an answer. Return “no answer found” when no hit passes your policy.

For caller-managed passages, use [cases.jsonl](semantic-search/cases.jsonl) as
the input shape and run `jev batch` with the shared questions. Include enough
neighboring text to preserve the meaning of code or documentation.

## Label a staged diff

```sh
git diff --cached --no-color --no-ext-diff |
  jev ask --questions examples/diff-checks/questions.json --model jev-1.13.0
```

The state is the raw diff, read from stdin. Independent Nouls flag public
interface changes, stored-data changes, and documentation changes. Several
labels can apply together. A database migration plus README edit illustrates
this. An option description in source counts as user-facing help.

Use these as review signals. A diff alone cannot establish compatibility, test
coverage, or whether a release is ready. Keep path-based rules and required
checks in code. An empty or partial patch is not proof that no change occurred.

## Extract a literal email address

```sh
node --env-file=.env examples/extract-email/run.mjs examples/extract-email/message.txt

# Also accepts piped plain text.
cat examples/extract-email/message.txt |
  node --env-file=.env examples/extract-email/run.mjs
```

A regex finds candidate addresses. Jev selects the address requested for a
receipt, or `none` / `unclear`. Code returns an original match only when its
probability is at least 0.85 and exceeds the next option by at least 0.25.
Otherwise the result is `review`, with `email: null`. A confident `none` or an
empty candidate set produces `not_found`.

The thresholds are examples to evaluate on your messages. The simple regex is
not a full email parser; an address it misses cannot be selected. It permits 253
candidates plus two fallback options. Full responses are retained, and this
script never sends email or executes a chosen action.

## Adapt a workflow

1. Copy the questions and replace the sample states with representative data.
2. Include missing evidence, ambiguous inputs, and expected negative cases.
3. Run the core CLI directly, or compose it as the two Node examples do.
4. Inspect failures and probabilities before selecting action thresholds.
5. Check CLI exit status and every batch record before using a result.

These patterns follow the TypeSafe cookbooks for
[reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe),
[semantic search](https://docs.typesafe.ai/cookbooks/semantic_find),
[claim checks](https://docs.typesafe.ai/cookbooks/citation_check), and
[candidate extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).
