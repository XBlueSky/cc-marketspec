---
name: cc-check
description: Validate the marketplace without writing manifest.json; explain any errors.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest --check` in the current working directory.
This validates the marketplace data without writing `manifest.json`.

For each error or warning reported, interpret it against the schema and suggest a
concrete fix — for example, "`entry.yaml` references group `x` that is not declared
in `catalog.yaml`; add it under `groups:`." Do not just echo the raw output.
