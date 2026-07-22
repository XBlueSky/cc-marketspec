---
name: cc-check
description: Validate namespaced marketplace authoring data without writing files.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest --check` in the current working directory.
This validates the marketplace data without writing any file.

- Authored catalog: `.cc-marketspec/catalog.yaml`
- Authored plugin entry: `.cc-marketspec/entries/plugin-<id>.yaml`
- Default generated output: `.cc-marketspec/dist/manifest.json`

`/cc-check` validates without writing any file. The generated output is ignored
and is not needed for validation.

For each error or warning reported, interpret it against the schema and suggest a
concrete fix — for example, "`.cc-marketspec/entries/plugin-<id>.yaml` references
group `x` that is not declared in `.cc-marketspec/catalog.yaml`; add it under
`groups:`." Do not just echo the raw output.
