<!-- section: overview | when: first time authoring an entry.yaml; understand what to fill vs leave to native -->
## Overview: native vs presentation

`entry.yaml` is a **presentation overlay**. Native data (`plugin.json`,
`commands/*.md`, `skills/*/SKILL.md`, `.mcp.json`, `hooks.json`) already yields a
valid manifest. Everything in `entry.yaml` is **optional enrichment** — write
only what native can't express, or where you want curated copy.

Rule: presentation never restates native facts. The generator joins the two by
plugin id (= directory name). If a field has a native fallback (e.g. `tagline`
falls back to the plugin description), author it only when the curated wording
beats the native one.

Point your editor at the schema for completion:
`# yaml-language-server: $schema=node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json`

<!-- section: tagline-intro | when: writing the card summary and lede for a plugin -->
## tagline & intro

- `tagline` — one line for cards and meta. Falls back to the native plugin
  description. Write one only if you can beat it: concrete, benefit-first, no
  trailing period needed. ~60–80 chars reads best on a card.
- `intro` — the full lede (a short paragraph). Falls back to native description.
  Use YAML block scalar (`>`) for multi-line. Say what it does and who it's for;
  don't repeat the tagline verbatim.

```yaml
tagline: Headless data standard + generator for a marketplace's presentation
intro: >
  Describe your marketplace as data; cc-marketspec joins it with native plugin
  manifests, validates, and emits one render-agnostic manifest.json.
```

<!-- section: tips-traps | when: adding power-moves (tips) or pitfalls/gotchas (traps) to a plugin -->
## tips & traps

Both are arrays of short notes (≤ 280 chars each).

- `tips` — **positive power-moves**: non-obvious ways to get more out of the
  plugin. Imperative, specific.
- `traps` — **negative gotchas / pitfalls**: what bites people. Name the
  symptom and the fix.

Each item is either a plain string (simplest) **or** an object when you need a
link:

```yaml
tips:
  - Run /cc-check in CI to gate PRs before the manifest is regenerated.
  - text: Self-host the MCP on Cloudflare Workers for zero-install schema help.
    href: https://github.com/XBlueSky/cc-marketspec#hosted-mcp-server
    label: Hosted MCP guide
traps:
  - entry.yaml never restates native facts — a skill trigger that just repeats
    the SKILL.md description adds nothing and clutters the card.
```

Use the object form only when a link genuinely helps; otherwise the string form
keeps the file readable. `label` (≤ 120 chars) is the link text.

<!-- section: group-ccVersion | when: classifying a plugin into a catalog group or stating a min Claude Code version -->
## group & ccVersion

- `group` — the id of a `catalog.yaml` group (you author the group taxonomy
  there). Distinct from the native `category` in `marketplace.json`. Must match a
  declared group or the build errors.
- `ccVersion` — minimum Claude Code version. No native source, so author it if
  the plugin depends on a recent feature.

<!-- section: skills | when: enriching a skill entry (trigger, examples, link) -->
## skills

Per-skill overlay. `name` must match a skill dir on disk.

- `trigger` — a curated phrasing of *when this skill fires*. Falls back to the
  SKILL.md description. Author it when a tighter, user-facing phrasing reads
  better than the raw description.
- `examples` — short example invocations / prompts that should trigger it.
- `href` / `label` — a docs link for the skill.

```yaml
skills:
  - name: marketplace-flow
    trigger: When a user wants to turn a repo into a marketplace, fill
      presentation data, generate the manifest, or wire CI.
    examples:
      - "set up a marketplace"
      - "generate the manifest"
```

<!-- section: commands | when: enriching a slash-command entry -->
## commands

Per-command overlay. `name` must match a `commands/*.md` on disk.

- `description` — curated one-liner; falls back to the command's native
  description (first sentence). The argument table is derived natively — don't
  restate it.
- `examples` — example invocations.

```yaml
commands:
  - name: cc-check
    description: Validate the marketplace without writing; explains any errors.
    examples:
      - "/cc-check"
```

<!-- section: agents | when: enriching an agent entry (returns, not, summary) -->
## agents

Per-agent overlay. `name` must match an `agents/*.md` on disk. Tools are derived
natively from frontmatter — don't restate them.

- `description` — curated summary; falls back to native.
- `returns` — what the agent hands back (its output contract). No native source.
- `not` — explicit non-goals / what it won't do. Sets expectations; prevents
  misuse.
- `examples` — when to reach for it.

```yaml
agents:
  - name: coverage-auditor
    returns: A list of plugins missing presentation metadata, by dot-path.
    not:
      - It does not edit your entry.yaml — it only reports.
```

<!-- section: mcp | when: enriching an MCP server entry (provides, install, auth, setup, env) -->
## mcp

Per-MCP overlay. `name` must match a server in `.mcp.json`. Transport and env
var keys are derived natively. Author the human-facing context:

- `provides` — the capabilities/tools it exposes, in plain language.
- `install` — how to add it (one line or short steps).
- `auth` — what credentials it needs and how to get them. Omit if none.
- `setup` — any post-install configuration.
- `env` — descriptions for env var keys (keys must already exist in `.mcp.json`;
  an undescribed key is a warning, a phantom key is an error).
- `repo` — source repository link.
- `config` — settings the user can tune.

```yaml
mcp:
  - name: cc-marketspec
    provides:
      - get_schema
      - list_authoring_sections
      - get_authoring_guide
      - check_coverage
      - scaffold_entry
    install: Add the hosted endpoint to any Streamable-HTTP MCP client.
    auth: None — the endpoint is open and read-only.
```

<!-- section: hooks | when: explaining why a hook exists -->
## hooks

Per-hook overlay. `event` / `matcher` must match a real entry in `hooks.json`
(the generator checks). The only authored field:

- `why` — why this hook exists / what it protects. No native source; the hook
  config says what fires, not why it matters.

```yaml
hooks:
  - event: PreToolUse
    matcher: Write|Edit
    why: Blocks writes that would desync the generated manifest from source.
```

<!-- section: configuration | when: documenting plugin-local settings (.claude/<plugin>.local.md) -->
## configuration

Document the plugin's local settings (the `.claude/<plugin>.local.md` file
users create). Each entry describes a setting: its key, what it does, and the
default. No native source — this is pure documentation of your plugin's config
surface.

```yaml
configuration:
  - key: strict_coverage
    description: Fail the build on coverage warnings, not just errors.
    default: "false"
```
