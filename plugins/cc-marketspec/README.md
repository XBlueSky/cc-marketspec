# cc-marketspec

Scaffold, validate, migrate, and build marketplace presentation data for a Claude
Code plugin marketplace — driven end to end by the `marketplace-flow` skill.

## Install

```bash
claude plugin marketplace add XBlueSky/cc-marketspec
claude plugin install cc-marketspec
```

## Overview

A Claude Code plugin marketplace is described by **native** files your plugins
already have: `.claude-plugin/marketplace.json`, each plugin's
`.claude-plugin/plugin.json`, its `commands/*.md`, `.mcp.json`, and skills.
Those alone already produce a valid generated manifest.

`.cc-marketspec/entries/plugin-<id>.yaml` (per plugin) and
`.cc-marketspec/catalog.yaml` (marketplace-wide) are optional authored
**presentation overlay** on top of that native data — taglines, intros, group
labels, skill triggers. cc-marketspec joins native + overlay, validates the
result, and emits the ignored generated output
`.cc-marketspec/dist/manifest.json` that a site build can consume. Authored files
stay in git; generated output does not. It ships data, not design.

## What it provides

- **`marketplace-flow` skill** — auto-triggers when you want to turn a repo into
  a marketplace; walks you through the whole flow (bootstrap → fill → validate →
  generate → wire CI), inferring each step from your repo's files.
- **`/cc-init`** — scaffold authored `.cc-marketspec/catalog.yaml` and
  `.cc-marketspec/entries/plugin-<id>.yaml` templates only.
- **`/cc-migrate`** — safely migrate recognized legacy authoring YAML into
  `.cc-marketspec/` with a dry-run and resumable cleanup.
- **`/cc-check`** — validate the marketplace without writing; explains errors.
- **`/cc-generate`** — build ignored `.cc-marketspec/dist/manifest.json`; use
  `--output` only as an explicit consumer-build escape hatch.
- **`cc-marketspec` MCP** — hosted tools for schema lookup, field explanation,
  coverage checks, and entry scaffolding.

## How it works

Just say what you want — e.g. "turn this repo into a Claude Code marketplace" —
and the `marketplace-flow` skill takes over, figuring out which step you're on
and driving it. The four commands are the single-step workers it invokes; you
can also run them directly.

Interactive commands shell out to `npx @xbluesky/cc-marketspec`, so the
published CLI is fetched on first use. CLI use through `npx` works without a
repository-local dependency.

The generated entry contains this editor directive:

```yaml
# yaml-language-server: $schema=../../node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json
```

Editor completion through that path requires an exact devDependency in the
marketplace repository. Install it once (this also prepares reproducible CI),
then commit `package.json` and `package-lock.json`:

```bash
npm install --save-dev --save-exact @xbluesky/cc-marketspec@latest
```

This repository-local package is separate from Claude's plugin runtime.

## MCP server

The plugin wires up a **hosted, read-only** MCP server
(`https://cc-marketspec-mcp.xbluesky.workers.dev`). It needs no token and no
setup. Its tools (`get_schema`, `list_authoring_sections`, `get_authoring_guide`,
`check_coverage`, `scaffold_entry`) take only the schema/field/file content you pass them — it
stores nothing and returns schema and validation help.

## Requirements

- Node.js >= 20 (the `npx @xbluesky/cc-marketspec` CLI is ESM, Node 20+).

## Author

XBlueSky · MIT License (see LICENSE).
