# cc-marketspec

A **headless data standard + generator** for the *presentation* of a Claude Code
plugin marketplace.

You describe a marketplace as data; `cc-marketspec` joins it with the native
plugin manifests, derives what's already encoded there, validates, and emits a
single **`manifest.json`** — a render-agnostic document any website can be built
from. **It ships data, not design.** How the site looks is the consumer's.

## Mental model: native layer vs presentation layer

- **Native (Claude Code defines):** `marketplace.json`, `plugin.json`,
  `.mcp.json`, `skills/*/SKILL.md` · `commands/*.md` · `agents/*.md` frontmatter,
  `hooks/hooks.json`. Identity + structure. You maintain these anyway for the
  plugins to work.
- **Presentation (this standard):** `catalog.yaml` (marketplace-level) +
  `entry.yaml` (per plugin). Only what native can't express.

**Rule: presentation never restates native facts** — it references them or adds
presentation value. The generator joins the two by plugin id (= directory name).

## The three files

| File | Where | Role |
|------|-------|------|
| `catalog.yaml` | repo root | marketplace-level data: `schemaVersion`, `lang`, group taxonomy |
| `entry.yaml` | each `plugins/<id>/` | per-plugin presentation overlay (all optional) |
| `manifest.json` | generated | the consolidated consumer API — **never hand-edited** |

`entry.yaml` is **optional enrichment**: native alone yields a valid (plainer)
manifest via fallbacks (e.g. `intro`/`tagline` → native description, skill
`description` → native SKILL.md description). Authoring burden is minimal by design.

## Install

```bash
npm install -D @xbluesky/cc-marketspec
# or run it without installing:
npx @xbluesky/cc-marketspec
```

## Usage

```bash
# In a marketplace repo (defaults to cwd):
npx @xbluesky/cc-marketspec
# -> writes ./manifest.json

# Validate only (CI gate) — report errors/warnings, write nothing:
npx @xbluesky/cc-marketspec --check

cc-marketspec --help        # full flag list (after install, the bin is `cc-marketspec`)
cc-marketspec --version
```

A complete, runnable example marketplace (with its generated `manifest.json`)
lives in [`examples/marketplace/`](examples/marketplace) — it's also the golden
fixture the test suite regenerates and diffs.

Programmatic:

```ts
import { generateManifest, Manifest, Entry } from '@xbluesky/cc-marketspec';

const { manifest, errors, warnings } = generateManifest(process.cwd());
// Entry / Catalog / Manifest are Zod schemas; their z.infer types are exported too.
```

### Editor support while authoring

Point your YAML language server at the published JSON Schemas:

```yaml
# yaml-language-server: $schema=node_modules/cc-marketspec/schemas/entry.schema.json
group: build
tagline: ...
```

## What the generator derives (so you don't restate it)

- skill **autoload** badge ← `user-invocable: false`; bundled-resource counts ← skill dir
- command **argument table** ← native `arguments` / `argument-hint`; `summary` ← first sentence of description
- agent **tools** ← frontmatter `tools`; `summary` ← description
- mcp **transport** + env-var keys ← `.mcp.json`
- hook **event/matcher** ← `hooks.json`
- plugin identity (name/version/author/license/keywords/deps) ← `plugin.json` / `marketplace.json`
- plugin **category** (native classification) ← `marketplace.json` entry `category` (distinct from authored `group`)

## What you author (no native source)

`entry.yaml`: curated `description`/`tagline`/`intro`, agent `returns`/`not`,
mcp `provides`/`install`/`auth`/`setup`/env descriptions, `examples`, hook `why`,
`configuration` (`.claude/<plugin>.local.md` settings), `tips` / `traps`.

## Validation (CI strict, dev degrades)

Beyond schema validation, the generator enforces referential integrity that no
declarative schema can:

- plugin directory name == `plugin.json` name == marketplace entry name
- `entry.yaml` skill/command/agent/mcp entries must exist on disk; `entry` hooks must match a real `event`/`matcher` in `hooks.json`
- `entry.group` must be declared in `catalog.yaml` `groups[]`
- `entry` env keys must exist in `.mcp.json` (undescribed keys → warning)

Any error fails the build (all errors are reported, not just the first).

## Coverage gate

The coverage gate checks that plugins have authored enough presentation data.
Rules are addressed by `<component>.<field>` dot-paths (e.g. `skill.trigger`,
`plugin.tagline`). Each rule has a built-in default severity:

| Rule | Default |
|------|---------|
| `skill.trigger` | `warn` |
| `skill.examples` | `off` |
| `command.description` | `off` |
| `agent.summary` | `warn` |
| `mcp.env` | `warn` |
| `mcp.provides` | `off` |
| `plugin.tagline` | `warn` |
| `plugin.group` | `off` |

Override per-rule (or set `"*"` as a catch-all) in `catalog.yaml`:

```yaml
coverage:
  skill.trigger: error   # promote to hard failure
  plugin.group: warn     # promote from off
  "*": warn              # default fallback for all other rules
```

`--check` exits non-zero if any `error`-severity finding exists.
`--strict-coverage` additionally exits non-zero when there are any `warn`
findings — use this as a stricter release gate.

## Getting started: `npx cc-marketspec init`

Scaffolds the files you need to begin authoring presentation data. It is
**non-destructive**: any file that already exists is reported as `skipped`.

```bash
npx @xbluesky/cc-marketspec init
```

Creates:
- `catalog.yaml` — marketplace-level metadata and group taxonomy (with a
  commented-out `coverage:` block ready to tune).
- `plugins/<id>/entry.yaml` — per-plugin overlay stub, for each plugin found in
  `.claude-plugin/marketplace.json` that has a `plugin.json` on disk.

## CI

The `--check` flag validates without writing anything — use it on PRs.

**GitHub Actions** (`.github/workflows/manifest.yml`):
```yaml
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @xbluesky/cc-marketspec --check
```

**GitLab CI** (`.gitlab-ci.yml`):
```yaml
check:manifest:
  image: node:22
  script:
    - npx @xbluesky/cc-marketspec --check
```

Add `--strict-coverage` for a stricter release gate that fails on warnings too.
The generated `manifest.json` can be committed to the repo or uploaded as a
CI artifact — that choice is yours.

## MCP

```bash
npx @xbluesky/cc-marketspec mcp
```

Starts a stdio MCP server. Four tools:

| Tool | What it does |
|------|-------------|
| `get_schema` | Returns the JSON Schema for `entry`, `catalog`, or `manifest` |
| `explain_field` | Explains a field in the entry or catalog schema |
| `check_coverage` | Runs the coverage gate against a plugin directory |
| `scaffold_entry` | Generates an `entry.yaml` stub for a given plugin |

## Versioning

The standard is semver; the manifest carries `schemaVersion` (`MAJOR.MINOR`).
Consumers gate on MAJOR; MINOR is additive / back-compatible.

## Not in v1 (back-compatible additions later)

- An `x-*` extension hatch (kept strict in v1 so the Zod validator and the
  emitted JSON Schema stay identical).
- `lsp` / `output-styles` component types (pure-derive; additive MINOR).
