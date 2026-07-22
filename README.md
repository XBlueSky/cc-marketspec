<div align="center">
  <img src="cc-marketplace.png" width="140" alt="cc-marketspec logo" />

  # cc-marketspec

  [![npm version](https://img.shields.io/npm/v/@xbluesky/cc-marketspec.svg)](https://www.npmjs.com/package/@xbluesky/cc-marketspec)
  [![CI](https://github.com/XBlueSky/cc-marketspec/actions/workflows/ci.yml/badge.svg)](https://github.com/XBlueSky/cc-marketspec/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Node >=20](https://img.shields.io/node/v/@xbluesky/cc-marketspec.svg)](https://nodejs.org)

  **[Live showcase site →](https://cc-marketspec.pages.dev)**
</div>

A **headless data standard + generator** for the *presentation* of a Claude Code
plugin marketplace.

You describe a marketplace as data; `cc-marketspec` joins it with the native
plugin manifests, derives what's already encoded there, validates, and emits a
single **`.cc-marketspec/dist/manifest.json`** — a render-agnostic document any
website can be built from. **It ships data, not design.** How the site looks is
the consumer's.

## Mental model: native layer vs presentation layer

- **Native (Claude Code defines):** `marketplace.json`, `plugin.json`,
  `.mcp.json`, `skills/*/SKILL.md` · `commands/*.md` · `agents/*.md` frontmatter,
  `hooks/hooks.json`. Identity + structure. You maintain these anyway for the
  plugins to work.
- **Presentation (this standard):** `.cc-marketspec/catalog.yaml`
  (marketplace-level) + `.cc-marketspec/entries/plugin-<id>.yaml` (per plugin).
  Only what native can't express.

**Rule: presentation never restates native facts** — it references them or adds
presentation value. The generator joins the two by marketplace plugin id, which
must match the `plugin.json` name.

## Canonical bundle

```text
.claude-plugin/marketplace.json
.cc-marketspec/
├── .gitignore              # /dist/
├── catalog.yaml            # authored, schemaVersion: "1.1"
├── entries/
│   └── plugin-<id>.yaml    # authored marketplace presentation
└── dist/
    └── manifest.json       # generated, ignored
```

Author and commit `.cc-marketspec/catalog.yaml` and the relevant
`.cc-marketspec/entries/plugin-<id>.yaml`. The per-plugin entry is **optional
enrichment**: native data alone yields a valid, plainer manifest via fallbacks
(for example, `intro`/`tagline` fall back to the native description).
Do not hand-edit or commit the default `.cc-marketspec/dist/manifest.json`.

## Install

```bash
npm install -D @xbluesky/cc-marketspec
# or run it without installing:
npx @xbluesky/cc-marketspec
```

## Usage

```bash
# Scaffold namespaced authored files without overwriting anything:
npx @xbluesky/cc-marketspec init

# Validate only (CI gate); reports errors/warnings and writes nothing:
npx @xbluesky/cc-marketspec --check

# Generate the ignored default output:
npx @xbluesky/cc-marketspec
# -> writes .cc-marketspec/dist/manifest.json

# Explicit consumer-build output, still generated rather than authored:
npx @xbluesky/cc-marketspec --output site/public/manifest.json

cc-marketspec --help        # full flag list (after install, the bin is `cc-marketspec`)
cc-marketspec --version
```

A complete, runnable namespaced marketplace lives in
[`examples/marketplace/`](examples/marketplace). Its generated manifest is a
golden fixture that the test suite regenerates and compares.

### Migrating legacy authored YAML

Preview every write and removal before applying it:

```bash
npx @xbluesky/cc-marketspec migrate --dry-run
npx @xbluesky/cc-marketspec migrate
```

Recognized legacy input is the format `1.0` flat layout: a root `catalog.yaml`
plus plugin-local `entry.yaml` files that can be proven to belong to
cc-marketspec. A generic root catalog without the normal legacy evidence is
intentionally ambiguous; claim it explicitly only after inspection:

```bash
npx @xbluesky/cc-marketspec migrate --from legacy
```

Migration preserves YAML comments, quoting, and key order. It never overwrites
an existing target and never invokes git. A receipt authorizes byte-checked
cleanup, so rerunning after an interruption safely resumes instead of repeating
or guessing destructive work.

### Generated data and deployment

For a site in the same repository, run the generator before the site build and
consume `.cc-marketspec/dist/manifest.json` locally. For an external consumer,
publish an explicit output to a stable Pages, CDN, or object-storage endpoint.
Workflow artifacts are temporary job-transfer objects, not stable public APIs.

Programmatic:

```ts
import {
  checkManifestFormatVersion,
  generateManifest,
  Manifest,
  Entry,
} from '@xbluesky/cc-marketspec';

const { manifest, errors, warnings } = generateManifest(process.cwd());
// Entry / Catalog / Manifest are Zod schemas; their z.infer types are exported too.

const parsed = Manifest.safeParse(manifest);
if (parsed.success) {
  const compatibility = checkManifestFormatVersion(parsed.data.schemaVersion);
  if (!compatibility.ok) throw new Error(compatibility.error);
}
```

`Manifest` and its published JSON Schema intentionally validate document shape
and any syntactically valid `MAJOR.MINOR` value. Consumers must then call
`checkManifestFormatVersion` before interpreting the document: it accepts legacy
format `1.0` with a deprecation warning and current format `1.1`, while rejecting
unsupported or future versions.

### Editor support while authoring

In `.cc-marketspec/entries/plugin-<id>.yaml`, point your YAML language server at
the published entry schema. Entry documents remain versionless:

```yaml
# yaml-language-server: $schema=../../node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json
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

In `.cc-marketspec/entries/plugin-<id>.yaml`: curated
`description`/`tagline`/`intro`, agent `returns`/`not`, MCP
`provides`/`install`/`auth`/`setup`/environment descriptions, `examples`, hook
`why`, `configuration` (`.claude/<plugin>.local.md` settings), `tips`, and
`traps`.

## Validation (CI strict, dev degrades)

Beyond schema validation, the generator enforces referential integrity that no
declarative schema can:

- marketplace plugin id must match the `plugin.json` name
- `.cc-marketspec/entries/plugin-<id>.yaml` skill/command/agent/MCP entries must
  exist on disk; authored hooks must match a real `event`/`matcher` in
  `hooks.json`
- authored `group` values must be declared in
  `.cc-marketspec/catalog.yaml` `groups[]`
- `entry` env keys must exist in `.mcp.json` (undescribed keys → warning)

Any error fails the build (all errors are reported, not just the first).
Remote source objects are recognized but not fetched. Generate in the source
repository or use a local `./` source so its native files can be inspected.

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

Override per-rule (or set `"*"` as a catch-all) in
`.cc-marketspec/catalog.yaml`:

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

- `.cc-marketspec/catalog.yaml` — marketplace-level presentation metadata and
  group taxonomy, with `schemaVersion: "1.1"` and a commented-out `coverage:`
  block ready to tune.
- `.cc-marketspec/entries/plugin-<id>.yaml` — per-plugin overlay stub for each
  local plugin found in `.claude-plugin/marketplace.json` with native metadata
  on disk.
- `.cc-marketspec/.gitignore` — ignores `/dist/`.

`init` creates authored files only; it does not generate the manifest.

## CI

The `--check` flag validates without writing anything — use it on PRs.

**GitHub Actions** (standalone workflow, or merge this job into the existing
`.github/workflows/ci.yml`):
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
Generate `.cc-marketspec/dist/manifest.json` only in a build job that needs it.
Do not commit that default output. If a later job in the same workflow needs the
file, a workflow artifact can transfer it temporarily; external consumers still
need a stable deployed endpoint.

## MCP

```bash
npx @xbluesky/cc-marketspec mcp
```

Starts a stdio MCP server. Five tools:

| Tool | What it does |
|------|-------------|
| `get_schema` | Returns the JSON Schema for `entry`, `catalog`, or `manifest` |
| `list_authoring_sections` | Lists the per-plugin entry authoring guide sections (id/title/when) |
| `get_authoring_guide` | Returns the full authoring guide markdown for one section |
| `check_coverage` | Runs the coverage gate against a plugin directory |
| `scaffold_entry` | Generates a `.cc-marketspec/entries/plugin-<id>.yaml` stub |

## Hosted MCP server

The same five MCP tools (`get_schema`, `list_authoring_sections`, `get_authoring_guide`,
`check_coverage`, `scaffold_entry`) are available over HTTP so contributors can query the schema
and be guided without installing anything. The handler is a platform-neutral
web-standard `fetch(Request) → Response` (`handleHttpRequest`, exported from the
package); Cloudflare Workers is the reference deployment but not a requirement.

### Use it (contributors)

Add the endpoint to any Streamable-HTTP-capable MCP client:

```
https://cc-marketspec-mcp.xbluesky.workers.dev
```

No credentials — the endpoint is intentionally open and read-only.

### Self-host (owners)

```bash
npm install
npm run worker:dev          # local: serves the handler (npx wrangler dev)
npx wrangler login          # one-time Cloudflare auth (or set CLOUDFLARE_API_TOKEN)
npm run deploy              # publishes the Worker; prints the public URL
```

Wrangler is **not** a dependency — `worker:dev` / `deploy` invoke it via `npx`, so
it stays out of the install tree (its platform binaries otherwise bloat `npm ci`).

The open/no-auth posture is deliberate (read-only tools, no secrets, file
contents are passed as parameters). If you later need abuse protection, add a
Cloudflare Rate Limiting rule — no code change required.

### Auto-deploy from CI

`.github/workflows/ci.yml` deploys the Worker on every push to `main` (once the
`validate` job is green), via `cloudflare/wrangler-action`. To enable it, add two
GitHub repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token scoped to **Workers Scripts: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (Workers dashboard → Account ID) |

The `deploy-worker` job runs in parallel with the npm `release` job — the Worker
going live does not wait on the npm publish, and a failed publish won't block the
deploy. Until both secrets are set the job fails loudly (never a silent skip), so
a missing secret is visible in the Actions tab.

## Install as a Claude Code plugin

cc-marketspec is itself an installable Claude Code plugin. Add this repo as a
marketplace and install it:

```bash
claude plugin marketplace add XBlueSky/cc-marketspec
claude plugin install cc-marketspec
```

You get:

- **The hosted MCP tools** (`get_schema`, `list_authoring_sections`, `get_authoring_guide`,
  `check_coverage`, `scaffold_entry`) wired in automatically — no endpoint config.
- **Slash commands** that run the generator against your current marketplace repo:
  - `/cc-generate` — write ignored `.cc-marketspec/dist/manifest.json`
  - `/cc-check` — validate without writing, with errors explained
  - `/cc-init` — scaffold `.cc-marketspec/catalog.yaml` and
    `.cc-marketspec/entries/plugin-<id>.yaml`
  - `/cc-migrate` — preview and safely migrate recognized format `1.0` YAML

This repo dogfoods the framework: its own ignored
`.cc-marketspec/dist/manifest.json` is generated from the namespaced authored
data in this repo.

- **Showcase site** — `site/` is a reference Astro app that generates and renders
  this repo's `.cc-marketspec/dist/manifest.json` during its build, live at
  [cc-marketspec.pages.dev](https://cc-marketspec.pages.dev). Downstream
  marketplaces can copy the same generated-data-to-site pattern.

## Format compatibility and package versions

Format versions use exactly `MAJOR.MINOR`; they are not SemVer. Format `1.0` is
the legacy flat layout, and format `1.1` is the current `.cc-marketspec/`
layout. npm package versions use independent SemVer and do not imply a format
version.

The runtime, rather than the JSON Schema shape alone, enforces compatibility.
An unsupported major, a future minor, or a layout/version mismatch is a hard
error; cc-marketspec does not silently reinterpret those inputs.

## Not in v1 (back-compatible additions later)

- An `x-*` extension hatch (kept strict in v1 so the Zod validator and the
  emitted JSON Schema stay identical).
- `lsp` / `output-styles` component types (pure-derive; additive MINOR).
