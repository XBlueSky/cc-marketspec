# Namespaced authoring bundle and safe migration — design

**Date:** 2026-07-19
**Status:** Approved after adversarial review; pending written-spec review
**Scope:** Replace collision-prone presentation paths with a namespaced bundle,
keep generated output out of git by default, and migrate legacy repositories
safely.

## 1. Problem

cc-marketspec currently claims three generic paths downstream:

    catalog.yaml
    <plugin source>/entry.yaml
    manifest.json

These names can belong to another tool. A root-level plugin is worse: it puts
entry.yaml directly at the repository root. Current CI templates can also
commit generated manifest.json back to the development branch, creating branch
drift and merge conflicts in a file nobody should hand-edit.

The ownership boundary is also wrong. An entry describes how one marketplace
presents a plugin. It is marketplace data, not plugin runtime data, and should
not be stored in or distributed with the plugin source.

## 2. Goals

1. Namespace every cc-marketspec-owned path.
2. Keep authored marketplace data outside plugin runtime directories.
3. Track authored YAML while ignoring generated output by default.
4. Preserve native-only manifest generation.
5. Add a non-destructive, idempotent migration tool.
6. Enforce root containment and cross-platform filenames.
7. Produce deterministic bytes across runs and supported operating systems.
8. Enforce supported format versions, not only version-string syntax.

## 3. Non-goals

- Fetching remote GitHub, git, or npm plugin sources.
- Rewriting arbitrary downstream website source during migration.
- Running git add, rm, commit, or push from migrate.
- Merging legacy and namespaced authored data.
- Adding a version field to every entry.
- Choosing a downstream hosting vendor.

## 4. Canonical layout

    .claude-plugin/
    └── marketplace.json

    .cc-marketspec/
    ├── .gitignore
    ├── catalog.yaml
    ├── entries/
    │   ├── plugin-cc-marketspec.yaml
    │   └── plugin-another-tool.yaml
    └── dist/
        └── manifest.json

| Path | Tracked | Role |
|---|---:|---|
| .claude-plugin/marketplace.json | yes | Native Claude Code contract; unchanged |
| .cc-marketspec/catalog.yaml | yes | Bundle policy, taxonomy, language, version |
| .cc-marketspec/entries/plugin-<id>.yaml | yes | Presentation overlay for one plugin |
| .cc-marketspec/.gitignore | yes | Contains /dist/ |
| .cc-marketspec/dist/manifest.json | no | Deterministic generated consumer document |

Authored and generated data occupy separate subtrees. dist is disposable.

### 4.1 Entry filename mapping

The fixed plugin- prefix prevents ids such as con or nul from becoming Windows
reserved filenames. Plugin ids must pass the Claude Code kebab-case rule before
path construction. Duplicate ids are hard errors.

The generator resolves one expected entry path per marketplace plugin. It does
not rely on directory enumeration order. Unmatched plugin-*.yaml files are
reported as orphan warnings.

### 4.2 Optional presentation remains optional

Native marketplace and plugin files alone still produce a plain manifest.
init creates a minimal catalog and entry templates. If authored entries exist,
catalog is required because it supplies their bundle version. With no authored
presentation files, the generator uses the current supported version in memory
and does not invent authored YAML.

## 5. Generated output

Default output:

| Layout | Path |
|---|---|
| fresh or namespaced | .cc-marketspec/dist/manifest.json |
| legacy compatibility mode | manifest.json, with migration warning |

An explicit output remains available:

    cc-marketspec --output site/public/manifest.json

Custom output must be repository-relative. Absolute, UNC, drive-relative, and
parent-traversal paths are rejected. The resolved target must remain below the
marketplace root. JSON is written to a sibling temporary file and renamed into
place.

Fresh generation may create .cc-marketspec/dist and a missing tool-owned
.cc-marketspec/.gitignore. It does not create catalog or entries. An existing
.gitignore is never overwritten; if it does not ignore /dist/, generation
emits an actionable warning.

Generated output is not committed to the main development branch by default.
Explicit custom output and user-managed git policy remain an escape hatch.

## 6. Format versioning

schemaVersion is a format compatibility version in MAJOR.MINOR form. It must
not be called SemVer, which requires MAJOR.MINOR.PATCH. npm package versioning
remains independent SemVer.

| Layout | Version | Status |
|---|---|---|
| legacy flat | 1.0 | readable, deprecated, migratable |
| namespaced bundle | 1.1 | current |

Only catalog declares the authored bundle version; entries inherit it.
Generated manifest carries the validated resolved version. The generator must
not blindly copy a string that merely matches a version regex.

Compatibility rules:

- unsupported major: hard error;
- future minor in a supported major: hard error requesting tool upgrade;
- supported older minor with registered migration: readable with warning;
- current version: normal processing;
- layout/version mismatch: hard error with migration guidance.

One module owns parsing, compatibility, and migration lookup for check,
generate, init, and migrate.

## 7. Layout detection

The resolver returns namespaced, legacy, fresh, or ambiguous. Selection and
validation are separate: once namespaced authored candidates select the
namespaced layout, malformed data is a namespaced validation error and never a
reason to fall back to generic legacy paths.

1. The presence of .cc-marketspec/catalog.yaml or any file under
   .cc-marketspec/entries selects namespaced and is authoritative. A directory
   containing only .gitignore and dist remains fresh/native-only.
2. A strong cc-marketspec 1.0 signature selects legacy: root catalog.yaml must
   validate as a 1.0 catalog, at least one expected legacy entry must validate
   against a native marketplace plugin id and source, and every claimed mapping
   must be unique.
3. No namespaced authored candidate or generic legacy candidate is fresh.
4. Catalog-only, entry-only, malformed, or unmapped generic candidates are
   ambiguous rather than silently claimed or ignored.

Namespaced mode never merges legacy paths; recognized leftovers are warnings.
Legacy mode preserves old reads and root output during the compatibility window
and warns about migration. Fresh mode uses native data and current defaults.
Ambiguous mode does not guess; it requires init or migrate --from legacy.
This means a catalog-only legacy repository needs explicit migration: the 1.0
catalog schema has no unique ownership marker, so automatic compatibility
cannot safely distinguish it from another tool's generic catalog.yaml.

Generated root manifest.json alone is never evidence of an authored layout.

## 8. Path policy

Internal FileSource paths use POSIX separators on every host. Platform
separators are introduced only at the NodeFileSource boundary.

All source, migration, and output paths use one resolveWithinRoot policy:

1. reject absolute, UNC, drive-relative, and forbidden empty paths;
2. reject parent segments before normalization;
3. resolve against the marketplace root;
4. prove lexical containment below the root;
5. for existing paths and migration parents, prove realpath containment to
   prevent symlink escape.

Local plugin sources must start with ./, matching Claude Code. The implicit
plugins/<id> source remains a deprecated legacy fallback only. Remote source
objects are recognized but not fetched; unavailable native discovery is
reported instead of silently dropping the plugin.

## 9. Deterministic generation

Manifest bytes depend only on repository content:

- preserve marketplace.json plugins authored order;
- preserve catalog groups authored order;
- sort filesystem-discovered name-addressed components by canonical name;
- preserve entry array order where it conveys presentation intent;
- sort diagnostics by path and rule/component;
- use fixed JSON indentation and one trailing newline;
- emit no timestamps or absolute paths.

Equivalent file maps inserted in opposite orders and supported OSes must emit
byte-identical JSON.

## 10. Migration tool

### 10.1 CLI

    cc-marketspec migrate --dry-run [root]
    cc-marketspec migrate [root]
    cc-marketspec migrate --from legacy [root]

--from legacy resolves only an ambiguous source selection. It does not weaken
path, schema, or overwrite validation.

Exit 0 means a valid dry-run, successful migration, or current-format no-op.
Exit 1 means invalid input, unsupported version, ambiguity without selection,
collision, staged validation failure, or incomplete cleanup.

### 10.2 Module boundary

Migration follows the existing pure-plan style:

    inspectLayout(source): LayoutInspection
    planMigration(source, options): MigrationPlan
    applyMigration(root, plan, fileOps): MigrationResult

Planning performs no writes. MigrationPlan contains source/target versions,
operations, warnings, and preconditions. applyMigration alone mutates the
filesystem and accepts a small file-ops interface for failure injection.

### 10.3 Preflight

Before creating a target, migrate validates:

- marketplace JSON and duplicate/missing ids;
- legacy catalog and every legacy entry;
- source root containment;
- supported layout/version transition;
- one-to-one legacy-entry to target mapping;
- portable target filename;
- absence of the .cc-marketspec target for a legacy cutover;
- availability of every source scheduled for removal;
- a content digest for every source scheduled for removal;
- ability to generate a valid staged manifest.

Remote sources without local legacy entries are reported and untouched.
Multiple ids pointing at one legacy entry are an error.

### 10.4 Staged apply

1. Create a random sibling staging directory under the repository root.
2. Copy catalog and entries into a complete namespaced tree.
3. Preserve comments, quoting, and key order with a comment-preserving YAML
   document API while updating only schemaVersion.
4. Write .cc-marketspec/.gitignore content as /dist/.
5. Run namespaced generation and validation against staging.
6. Generate the staged deterministic manifest.
7. Rename the complete staging tree to .cc-marketspec on the same filesystem.
8. After cutover, remove only claimed, digest-unchanged legacy authored files.
   Remove root manifest.json only when it is byte-identical to output freshly
   generated from the validated legacy inputs.
9. Remove staging remnants on pre-cutover failure.

No target is overwritten and there is no force-overwrite option.

If cleanup fails after cutover, the complete namespaced bundle remains
authoritative. The command exits non-zero with exact remaining legacy paths.
Re-running migrate detects a cleanup-only plan: it validates equivalence with
the namespaced bundle and resumes safe deletion without replacing the bundle.
Namespaced repositories with unrelated generic files are normal no-ops; those
files are never cleanup candidates. Changed planned sources are left in place
and reported instead of being deleted. The command never operates git;
filesystem changes remain visible for user review.

Layout migration must not round-trip YAML through js-yaml because that discards
comments and formatting. Comment preservation is a functional requirement.

## 11. CLI and modules

CLI surface:

    cc-marketspec [root] [--check] [--strict-coverage] [--output <path>]
    cc-marketspec init [root]
    cc-marketspec migrate [root] [--dry-run] [--from legacy]
    cc-marketspec mcp

--check never writes or creates directories. Combining --check and --output is
an argument error.

New focused modules:

| Module | Responsibility |
|---|---|
| src/layout.ts | Canonical paths, layout inspection, entry filename mapping |
| src/path-policy.ts | Canonical paths and root containment |
| src/version.ts | Parser, compatibility table, migration lookup |
| src/migration.ts | Pure plan and staged apply |

generate remains the validated data join, init remains scaffold planning, cli
owns dispatch/output, coverage uses resolved paths, and MCP examples and
diagnostics use canonical namespaced paths. Public generateManifest stays pure
with respect to writing.

## 12. Init

Fresh init creates:

    .cc-marketspec/.gitignore
    .cc-marketspec/catalog.yaml
    .cc-marketspec/entries/plugin-<id>.yaml

It does not generate manifest. Existing files are never overwritten. Legacy
input leads to migration guidance rather than a parallel blank bundle.
Ambiguous generic files are not claimed.

## 13. CI and publishing

PR/MR validation remains read-only:

    npx @xbluesky/cc-marketspec --check

A same-repository site generates the namespaced manifest before compilation.
Workflow artifacts may pass output between jobs but are not permanent public
APIs. External consumers use Pages, a CDN, object storage, or another stable
publish endpoint.

marketplace-flow and bundled CI assets default to build/deploy and no longer
ask whether a bot should commit manifest to main. Auto-commit remains only as a
documented legacy escape hatch.

This repository dogfoods the new contract by moving authored data, removing the
tracked root manifest and auto-commit workflow, generating during site build,
updating site imports/tests, and keeping expected JSON as a named test fixture.

## 14. Diagnostics

Hard errors include unsupported version, layout/version mismatch, duplicate or
unsafe id, path escape, malformed authored data, unresolved ambiguity, target
collision, multiple ids mapped to one legacy entry, staged validation failure,
and silently unavailable native facts for a remote source.

Warnings include legacy mode, ignored recognized leftovers, orphan entry,
missing /dist/ ignore rule, and normal warning-severity coverage findings.

Every diagnostic names the canonical path and one next action. A failed
generation writes no final manifest. A pre-cutover migration failure leaves
legacy inputs untouched.

## 15. Verification matrix

Layout and collisions:

- unrelated root catalog.yaml, entry.yaml, and manifest.json are ignored by a
  namespaced bundle;
- root-level and arbitrary local plugins resolve namespaced entries;
- all four layout states behave as specified;
- namespaced mode wins over recognized leftovers;
- orphan diagnostics are stable.

Versioning:

- strong-signature legacy 1.0 warns and namespaced 1.1 is current;
- catalog-only legacy 1.0 requires migrate --from legacy;
- 0.9, namespaced 1.0, legacy 1.1, future 1.99, and 2.0 follow the matrix;
- arbitrary version strings cannot pass by regex alone;
- entries cannot override catalog version.

Paths and portability:

- reject absolute, UNC, drive-relative, parent, and symlink escapes;
- internal paths use forward slashes on every OS;
- ids including con and nul map to portable prefixed filenames;
- custom output cannot leave the root;
- Linux and Windows CI run path, CLI, and migration suites.

Determinism:

- opposite file insertion order emits identical bytes;
- discovered components are sorted;
- authored ordering is preserved where specified;
- output has no time, absolute path, or environment variation;
- Linux and Windows output fixtures match.

Migration:

- dry-run writes nothing;
- migration preserves comments, quoting, and content;
- collisions and malformed input produce zero mutations;
- staging failure preserves legacy input;
- injected write/rename failure is recoverable;
- cleanup failure can resume;
- current-format rerun is a successful no-op;
- root plugin, remote source, and duplicate mapping cases are explicit;
- no git command is invoked.

Integration:

- examples use namespaced authored data;
- expected manifest is a test fixture;
- schema drift, skill, commands, references, assets, docs, site, and CI paths
  contain no accidental legacy guidance;
- this repository site builds from ignored namespaced output.

## 16. Rollout

1. Release a package minor with format 1.1, migrate, legacy read support,
   warnings, and new CI guidance.
2. New init calls produce namespaced 1.1 only.
3. Auto-detected legacy repositories retain root output during the
   compatibility window; ambiguous legacy input requires explicit migration.
4. This repository migrates itself and removes auto-commit CI.
5. Removing automatic legacy detection is reserved for a future format-major
   decision; this spec invents no removal date.

The package is pre-1.0, but the data format already identifies as 1.x.
Compatibility is explicit and user-facing rather than dismissed based on the
package version.

## 17. Acceptance criteria

1. Fresh init produces only namespaced authored data.
2. Native-only generation remains valid with ignored namespaced output.
3. Namespaced mode never parses generic legacy-named files.
4. Strong-signature legacy 1.0 remains readable with warning; ambiguous legacy
   data is never claimed without migrate --from legacy.
5. Migration is dry-runnable, comment-preserving, idempotent, and non-overwriting.
6. Generated output is byte-identical across supported OSes.
7. Source and output paths cannot escape root.
8. Supported-version compatibility is enforced.
9. Default CI never commits generated manifest to the development branch.
10. Stable external consumption uses a publish endpoint, not temporary artifact.
11. Root-level plugins no longer claim root entry.yaml.
12. Full tests, schema drift, type check, lint, library build, site build, and
    new Linux/Windows path and migration tests pass before release.

## 18. References

- Claude Code plugin marketplaces:
  https://code.claude.com/docs/en/plugin-marketplaces
- Semantic Versioning 2.0.0: https://semver.org/
- Node.js filesystem API: https://nodejs.org/api/fs.html
- Microsoft file/path naming:
  https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
- GitHub workflow artifacts:
  https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
- GitHub Pages publishing:
  https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
