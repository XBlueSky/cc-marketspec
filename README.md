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
npm install -D cc-marketspec
# or run it without installing:
npx cc-marketspec
```

## Usage

```bash
# In a marketplace repo (defaults to cwd):
npx cc-marketspec
# -> writes ./manifest.json

# Validate only (CI gate) — report errors/warnings, write nothing:
npx cc-marketspec --check

cc-marketspec --help        # full flag list
cc-marketspec --version
```

A complete, runnable example marketplace (with its generated `manifest.json`)
lives in [`examples/marketplace/`](examples/marketplace) — it's also the golden
fixture the test suite regenerates and diffs.

Programmatic:

```ts
import { generateManifest, Manifest, Entry } from 'cc-marketspec';

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

## Versioning

The standard is semver; the manifest carries `schemaVersion` (`MAJOR.MINOR`).
Consumers gate on MAJOR; MINOR is additive / back-compatible.

## Not in v1 (back-compatible additions later)

- An `x-*` extension hatch (kept strict in v1 so the Zod validator and the
  emitted JSON Schema stay identical).
- `lsp` / `output-styles` component types (pure-derive; additive MINOR).
