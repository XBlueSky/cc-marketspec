---
name: cc-generate
description: Generate manifest.json for the marketplace in the current directory.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest` in the current working directory to
generate `manifest.json` from `.claude-plugin/marketplace.json`, `catalog.yaml`,
and each plugin's `entry.yaml`.

After it runs, report how many plugins were emitted and surface any warnings.
If `manifest.json` changed, remind the user to persist it: either commit it to
the repo (a stable raw URL any site can fetch) or upload it as a CI artifact
for a same-pipeline site job. The marketplace-flow skill can scaffold the CI
workflow that automates this on every push to main.
