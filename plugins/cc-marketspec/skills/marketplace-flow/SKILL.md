---
name: marketplace-flow
description: Use when a user asks to turn a repo into a Claude Code plugin marketplace, set up marketplace presentation data, migrate legacy marketplace YAML, generate a marketplace manifest, automate marketplace validation in CI, or mentions .cc-marketspec catalog, entry, or manifest files.
---

# Marketplace flow

Drive a downstream repo from native Claude Code marketplace data to namespaced
authoring, validation, and a consumer build. Keep git history source-only:
`.cc-marketspec/catalog.yaml` and
`.cc-marketspec/entries/plugin-<id>.yaml` are authored source;
`.cc-marketspec/dist/manifest.json` is ignored generated output.

## How to know which step the user is on

This skill is stateless. Do not keep a settings file. Inspect the repo each time
and use the first matching state:

0. No `.claude-plugin/marketplace.json` → bootstrap the native marketplace.
1. Generic `catalog.yaml` or expected legacy `entry.yaml` exists without a
   namespaced bundle → run `/cc-migrate`; use `--from legacy` only after the
   user explicitly confirms ambiguous files are cc-marketspec data.
2. No `.cc-marketspec/catalog.yaml` → run `/cc-init`.
3. Any `.cc-marketspec/entries/plugin-<id>.yaml` is still an all-comment
   scaffold → fill the presentation overlay.
4. `/cc-check` reports errors → fix and rerun; warnings remain advisory.
5. `.cc-marketspec/dist/manifest.json` is absent for a local build → run
   `/cc-generate`.
6. No CI validation/build step runs cc-marketspec → install the read-only
   platform template.
7. Validation and the consumer build are wired → done.

After every command or file edit, re-inspect and continue from the first
matching state.

## Step actions

### Step 0 — bootstrap native marketplace data

If `.claude-plugin/marketplace.json` is missing, read
`${CLAUDE_SKILL_DIR}/assets/marketplace.json.example`, infer the marketplace
name, owner, and one `plugins[]` item per directory under `plugins/`, then write
`.claude-plugin/marketplace.json`. Each local plugin uses `name` and
`source: ./plugins/<id>`. Ask only for owner details that cannot be inferred.

### Step 1 — migrate recognized legacy YAML

Run `/cc-migrate`. It first runs
`npx @xbluesky/cc-marketspec@latest migrate --dry-run` and reports every planned
write and removal. Apply the ordinary migration only when that plan is valid.

If generic candidates are ambiguous, explain which files would be claimed and
require explicit user confirmation before dry-running and applying
`migrate --from legacy`. Never bypass the dry-run. Migration performs no git
operations. If cleanup reports a remaining legacy path, report it and rerun the
migration; cleanup is resumable.

### Step 2 — scaffold authored files

Run `/cc-init`. It creates authored `.cc-marketspec/catalog.yaml` and one
`.cc-marketspec/entries/plugin-<id>.yaml` scaffold per marketplace plugin. It
does not generate `.cc-marketspec/dist/manifest.json`.

### Step 3 — fill the presentation overlays

For each `.cc-marketspec/entries/plugin-<id>.yaml`, uncomment and author
`tagline` and `intro`, then add useful skill triggers and command/agent copy.
Infer what is supported by native plugin files; ask the user only for editorial
choices that require judgment.

If the plugin has skills, add a `skills:` item with a `trigger` for each. The
coverage gate warns when a native skill has no authored trigger. A
`yaml-language-server` line must point to the published schema:
`../../node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json`.

Before authoring `tips`, `traps`, or per-component fields, call
`list_authoring_sections`, then `get_authoring_guide` for the relevant section.
The hosted MCP is the preferred current guide. If it is unavailable, read
`${CLAUDE_SKILL_DIR}/references/entry-authoring.md` instead.

Groups referenced by an entry must be declared in
`.cc-marketspec/catalog.yaml`.

### Step 4 — validate authored data

Run `/cc-check`, which executes `cc-marketspec --check` without writing any
file. Interpret each error against the schema, make or propose a concrete fix in
the named authored file, and rerun until errors clear. Surface warnings and
offer to address them, but do not block progress on warnings alone.

### Step 5 — build for a consumer

Run `/cc-generate`. It writes ignored output to
`.cc-marketspec/dist/manifest.json` by default. Report how many plugins were
emitted and surface warnings. `--output` is only an explicit consumer-build
escape hatch when the consumer requires another destination; it is not an
authoring or persistence mechanism.

### Step 6 — install read-only CI

Detect GitHub from `.github/` or a GitHub remote and GitLab from
`.gitlab-ci.yml` or a GitLab remote. Ask which platform only when ambiguous.

Default to source-only git history. Pull requests run `--check`. A same-pipeline
site job consumes `.cc-marketspec/dist/manifest.json` directly or via a
short-lived workflow artifact. If another repository or public client needs the
manifest, publish it with the site to Pages, a CDN, or object storage; a workflow
artifact is not a stable public endpoint.

Read the platform template from this skill and install or merge it:

- GitHub: read `${CLAUDE_SKILL_DIR}/assets/github-manifest.yml`, write
  `.github/workflows/manifest.yml`.
- GitLab: read `${CLAUDE_SKILL_DIR}/assets/gitlab-manifest.yml`, merge it into
  `.gitlab-ci.yml` without replacing unrelated jobs or stages.

The templates validate read-only, generate only ignored output, and transfer it
as a short-lived artifact. Do not add repository-write permissions or git
operations.

### Step 7 — hand off the consumer contract

Explain that authored `.cc-marketspec/catalog.yaml` and
`.cc-marketspec/entries/plugin-<id>.yaml` remain source-controlled, while the
site or deployment pipeline consumes the generated
`.cc-marketspec/dist/manifest.json`. External consumers require a stable deploy
endpoint such as Pages, a CDN, or object storage.

## Division of labor

Use `/cc-migrate`, `/cc-init`, `/cc-check`, and `/cc-generate` for repository
actions. The hosted MCP is the knowledge source: `get_schema`,
`list_authoring_sections`, and `get_authoring_guide` explain the contract. Its
`scaffold_entry` and `check_coverage` tools exist for bare HTTP MCP clients; when
this plugin is installed, use commands for actions and MCP tools for knowledge.

Writing the CI workflow is the only doing-step without a command. Copy the
matching `${CLAUDE_SKILL_DIR}/assets/` template and preserve unrelated platform
configuration.
