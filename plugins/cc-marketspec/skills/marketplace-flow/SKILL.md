---
name: marketplace-flow
description: This skill should be used when the user asks to "turn this repo into a Claude Code plugin marketplace", "set up a marketplace", "add presentation data to my plugins", "generate the marketplace manifest", "automate the manifest in CI", or mentions catalog.yaml / entry.yaml / manifest.json in a marketplace context. It walks the user end to end through scaffolding, filling presentation data, validating, generating, and wiring CI.
---

# Marketplace flow

Drive a downstream user from an ordinary plugin repo to a fully automated
marketplace: scaffold presentation data, fill it, validate, generate the
manifest, and wire CI so it regenerates on every push to main. Stay hands-on —
do each step directly and only stop to ask when a choice is genuinely the
user's (which persist strategy; what a tagline should say).

## How to know which step the user is on

This skill is stateless. Do not keep a settings file. Each time, inspect the
repo's files and infer the current step. The list below is numbered to match the
Step headings under `## Step actions`:

0. No `.claude-plugin/marketplace.json` → not a marketplace repo yet.
1. No `catalog.yaml` → presentation data not scaffolded.
2. Any `entry.yaml` still all-comment (only `# ...` TODO lines) → not filled.
3. `/cc-check` reports errors → not valid. (Warnings are advisory and do not
   block — surface them, but do not get stuck here on warnings alone.)
4. No `manifest.json`, or regenerating it would produce a `git diff` → not generated.
5. No CI workflow that runs `cc-marketspec` (e.g. `.github/workflows/*.yml` or
   `.gitlab-ci.yml`) → CI not wired.
6. All of the above satisfied → done; explain how the site consumes the manifest.

Advance one step at a time. After running a command or writing a file,
re-inspect and move to the next step.

## Step actions

### Step 0 — not a marketplace repo

If `.claude-plugin/marketplace.json` is missing, bootstrap it. Read the starter
template at `${CLAUDE_SKILL_DIR}/assets/marketplace.json.example`, fill it from
what you can see in the user's repo (the marketplace name, the owner, and a
`plugins[]` entry per plugin directory found under `plugins/` — each with `name`
and `source: ./plugins/<id>`), and write it to `.claude-plugin/marketplace.json`.
Confirm the owner name/url with the user if not inferable. Then re-inspect and
proceed to scaffolding.

### Step 1 — scaffold (no catalog.yaml)

Run `/cc-init`. It scaffolds `catalog.yaml` and a per-plugin `entry.yaml`
template. Then re-inspect and proceed to filling.

### Step 2 — fill entry.yaml (templates are all-comment TODO)

Help fill each plugin's `entry.yaml`: uncomment and write `tagline` and `intro`
(the template scaffolds these as commented lines), and author skill triggers and
command/agent descriptions from scratch where useful. Use the JSON Schema referenced in
the file's `yaml-language-server` line for field meanings. If the plugin ships
skills, add a `skills:` entry with a `trigger` for each — the coverage gate warns
on skills with no authored trigger, so this is the common source of the warnings
seen in Step 3. Write what can be inferred from the plugin's own files; stop and
ask the user only for values that require their judgment (the exact tagline
wording, intro copy). If `entry.yaml`
carries a `# yaml-language-server: $schema=` line for editor validation, point
it at the published schema — `node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json`
— not a repo-relative path (a downstream repo's schemas live in node_modules).
Then re-inspect.

For anything beyond `tagline`/`intro` — `tips`/`traps`, per-component fields
(skill `trigger`, agent `returns`/`not`, mcp `provides`/`auth`/`setup`, hook
`why`), the full field guide is bundled at
`${CLAUDE_SKILL_DIR}/references/entry-authoring.md` (read it before authoring
those). The same guide is queryable from the cc-marketspec MCP without install:
call `list_authoring_sections`, then `get_authoring_guide` for the section you
need.

### Step 3 — validate (--check is red)

Run `/cc-check`. Errors block — interpret each against the schema and apply or
propose a concrete fix in the right file (do not just echo raw output), then
re-run until errors clear. Warnings are advisory (the coverage gate lets them
through, exit 0): surface them and offer to address them, but do not block
progress on warnings alone. Once there are no errors, proceed.

### Step 4 — generate manifest (--check is clean, manifest missing or out of date)

To tell whether the committed `manifest.json` is out of date, regenerate and check for a diff (do not compare file mtimes — git does not preserve them). Run `/cc-generate`. It writes `manifest.json` from the marketplace data. Report
how many plugins were emitted and surface any warnings, then proceed to wiring CI
so this regenerates automatically.

### Step 5 — wire CI (no manifest workflow)

This is the only step with no command — write the CI workflow directly.

First detect the platform: GitHub if `.github/` exists or the git remote points
at github; GitLab if `.gitlab-ci.yml` exists or the remote points at gitlab. If
ambiguous, ask.

Then ask the one decision only the user can make: **commit the manifest to git,
or keep it as a build artifact?**
- Independent / third-party site repo → commit to git (a stable raw URL any
  site can fetch without running your CI).
- Site in the same repo/pipeline → artifact (keep git to source only; a
  downstream job consumes the artifact).

Read the matching template from this skill's bundled assets and write it into
the user's repo. Use the `${CLAUDE_SKILL_DIR}` variable — it resolves to this
skill's own directory regardless of the user's working directory (the plugin is
installed in a managed cache, NOT the user's repo, so a bare relative path would
fail):
- GitHub → Read `${CLAUDE_SKILL_DIR}/assets/github-manifest.yml`, write to `.github/workflows/manifest.yml`
- GitLab → Read `${CLAUDE_SKILL_DIR}/assets/gitlab-manifest.yml`, merge into `.gitlab-ci.yml`

Keep only the block (git path vs artifact path) for the chosen strategy; delete
the other, per the comments in the template. Tell the user about any required
secret (GitLab git path needs a `GIT_PUSH_TOKEN` project access token).

### Step 6 — done

Explain how the site consumes `manifest.json`: for the git path, fetch the
committed file (raw URL / submodule / checkout); for the artifact path, a
downstream pipeline job or cross-repo artifact download reads it. The validate
gate (`cc-marketspec --check` on PRs/MRs) keeps contributors honest; remind the
user to add it to PR/MR CI if not present.

## Division of labor

This skill decides which step the user is on and drives it. The commands do the
single-step work: `/cc-init` (scaffold), `/cc-check` (validate + explain),
`/cc-generate` (write manifest). Do not re-implement their `npx` calls here —
invoke the command. Writing the CI workflow in Step 5 is the one action no
command covers, so do it directly by reading `${CLAUDE_SKILL_DIR}/assets/`.
