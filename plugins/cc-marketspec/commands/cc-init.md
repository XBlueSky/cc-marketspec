---
name: cc-init
description: Scaffold catalog.yaml and per-plugin entry.yaml templates from existing plugins.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest init` in the current working directory.
This detects existing plugins and scaffolds a `catalog.yaml` and a per-plugin
`entry.yaml` template for each.

After it runs, tell the user which template fields to fill in next (taglines,
skill triggers, command descriptions) and point them at `/cc-check` to validate.
