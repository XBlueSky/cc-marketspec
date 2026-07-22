---
name: cc-migrate
description: Safely migrate legacy cc-marketspec YAML into .cc-marketspec/.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest migrate --dry-run` first and report
every planned write/removal. If the plan is valid, run
`npx @xbluesky/cc-marketspec@latest migrate`.

When generic legacy candidates are intentionally cc-marketspec data but cannot
be identified strongly, rerun the dry-run with `--from legacy`, explain that
this explicitly claims those files, and require the user's explicit confirmation
before applying with
`npx @xbluesky/cc-marketspec@latest migrate --from legacy`.

Never add a force flag and never perform git operations. Report any remaining
legacy path after a cleanup error; a rerun safely resumes cleanup.
