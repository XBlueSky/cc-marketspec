# cc-marketspec

Scaffold, validate, and generate the presentation `manifest.json` for a Claude
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
Those alone already produce a valid `manifest.json`.

`entry.yaml` (per plugin) and `catalog.yaml` (marketplace-wide) are an optional
**presentation overlay** on top of that native data — taglines, intros, group
labels, skill triggers. cc-marketspec joins native + overlay, validates the
result, and emits one render-agnostic `manifest.json` that any site can consume.
It ships data, not design.

## What it provides

- **`marketplace-flow` skill** — auto-triggers when you want to turn a repo into
  a marketplace; walks you through the whole flow (bootstrap → fill → validate →
  generate → wire CI), inferring each step from your repo's files.
- **`/cc-init`** — scaffold `catalog.yaml` and per-plugin `entry.yaml` templates.
- **`/cc-check`** — validate the marketplace without writing; explains errors.
- **`/cc-generate`** — generate `manifest.json` from your marketplace data.
- **`cc-marketspec` MCP** — hosted tools for schema lookup, field explanation,
  coverage checks, and entry scaffolding.

## How it works

Just say what you want — e.g. "turn this repo into a Claude Code marketplace" —
and the `marketplace-flow` skill takes over, figuring out which step you're on
and driving it. The three commands are the single-step workers it invokes; you
can also run them directly.

The commands shell out to `npx @xbluesky/cc-marketspec`, so the published CLI is
fetched on first use.

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
