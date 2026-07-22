---
name: cc-generate
description: Build the ignored marketplace manifest for an explicit consumer.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest` in the current working directory to
build the ignored output from native marketplace data and these authored files:

- Authored catalog: `.cc-marketspec/catalog.yaml`
- Authored plugin entry: `.cc-marketspec/entries/plugin-<id>.yaml`
- Default generated output: `.cc-marketspec/dist/manifest.json`

`/cc-generate` writes ignored output by default. `--output <path>` is the
explicit consumer-build escape hatch when a consuming build requires a different
destination; it is not a persistence strategy for authored source.

After it runs, report how many plugins were emitted and surface any warnings.
The marketplace-flow skill can scaffold read-only validation and a same-pipeline
artifact build. External consumers need the generated file deployed with the
site, to Pages, a CDN, or object storage.
