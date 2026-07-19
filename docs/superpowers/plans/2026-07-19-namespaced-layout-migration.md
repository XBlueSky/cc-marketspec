# Namespaced Layout and Safe Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cc-marketspec-owned authoring data into `.cc-marketspec/`, enforce format version 1.1 and safe paths, generate ignored deterministic output, and provide a comment-preserving legacy migration command.

**Architecture:** A pure compatibility/layout layer resolves marketplace plugins and authored paths before generation. Filesystem mutation stays at the CLI/output/migration edges: generation and migration planning operate over `FileSource`, while atomic output and staged migration use root-contained Node filesystem adapters. Legacy auto-detection requires a strong signature; ambiguous generic files are touched only after explicit `migrate --from legacy`.

**Tech Stack:** TypeScript ESM, Node.js >=20, Zod 4, `node:test`, `yaml` v2 Document API, tsup, Astro, GitHub Actions.

## Global Constraints

- Canonical authored paths are `.cc-marketspec/catalog.yaml` and `.cc-marketspec/entries/plugin-<id>.yaml`.
- Canonical generated output is `.cc-marketspec/dist/manifest.json`; `.cc-marketspec/.gitignore` contains exactly `/dist/`.
- Legacy flat layout is format `1.0`; namespaced layout is format `1.1`; entries inherit the catalog version.
- Format versions use `MAJOR.MINOR` compatibility semantics and are not npm SemVer.
- Plugin ids remain Claude Code kebab-case; the fixed `plugin-` filename prefix makes ids such as `con` and `nul` portable on Windows.
- Internal paths use POSIX separators. Absolute, UNC, drive-relative, parent-traversal, and symlink-escape paths are rejected.
- `--check` performs zero filesystem writes; `--check --output` is an argument error.
- Generated JSON has two-space indentation, one trailing newline, no timestamps or absolute paths, and stable ordering across supported operating systems.
- Migration is dry-runnable, non-overwriting, idempotent, comment/quote/key-order preserving, and never executes git commands.
- Migration has no force-overwrite option. Post-cutover cleanup deletes only digest-unchanged files proven to belong to the migration.
- A transient `.cc-marketspec/.migration-state.json` receipt carries source and target digests across crashes and is deleted only after cleanup succeeds.
- Receipt removal paths are re-authorized against the current marketplace's legacy catalog, manifest, and resolved entry-path allowlist; the receipt is never an arbitrary delete list.
- Remote marketplace sources are recognized but not fetched; unavailable native facts produce an explicit diagnostic.
- Default CI validates/builds without committing generated output to the development branch.
- Preserve the existing public `generateManifest` API's no-write behavior.

---

## File Structure

### New production modules

- `src/version.ts` — format constants and the only compatibility decision table.
- `src/path-policy.ts` — POSIX-relative normalization plus lexical/realpath root containment.
- `src/layout.ts` — plugin source resolution, canonical filenames, legacy signature inspection, and four-state layout selection.
- `src/output.ts` — atomic JSON writes and the namespaced `/dist/` ignore contract.
- `src/migration.ts` — pure migration planning, comment-preserving catalog rewrite, staged cutover, and cleanup recovery.

### New tests and fixtures

- `test/version.test.ts`
- `test/path-policy.test.ts`
- `test/layout.test.ts`
- `test/output.test.ts`
- `test/migration.test.ts`
- `test/fixtures/example-manifest.json`

### Existing implementation files changed

- `src/fs-source.ts`, `src/native.ts`, `src/generate.ts`, `src/init.ts`, `src/cli.ts`, `src/index.ts`
- `src/catalog.ts`, `src/manifest.ts`, `src/coverage.ts`, `src/mcp.ts`, `src/authoring.md`, `src/build.ts`
- Generated artifacts: `src/authoring.generated.ts`, `src/schemas.generated.ts`, `schemas/*.schema.json`

### Existing tests changed

- `test/fs-source.test.ts`, `test/native.test.ts`, `test/generate.test.ts`, `test/init.test.ts`, `test/cli.test.ts`
- `test/coverage.test.ts`, `test/mcp.test.ts`, `test/schemas.test.ts`, `test/example.test.ts`, `test/marketplace-flow-skill.test.ts`
- `site/test/build.test.ts`

### Authored data, docs, plugin, example, site, and CI changed

- Add `.cc-marketspec/.gitignore`, `.cc-marketspec/catalog.yaml`, `.cc-marketspec/entries/plugin-cc-marketspec.yaml`
- Add `examples/marketplace/.cc-marketspec/.gitignore`, `examples/marketplace/.cc-marketspec/catalog.yaml`, `examples/marketplace/.cc-marketspec/entries/plugin-hello-plugin.yaml`
- Remove tracked `catalog.yaml`, `plugins/cc-marketspec/entry.yaml`, `manifest.json`, `examples/marketplace/catalog.yaml`, `examples/marketplace/plugins/hello-plugin/entry.yaml`, `examples/marketplace/manifest.json`
- Remove `.github/workflows/manifest.yml`; modify `.github/workflows/ci.yml` and `.github/workflows/site.yml`
- Modify `site/package.json`, `site/src/components/{Hero,MentalModel,Pipeline,Showcase}.astro`, `site/astro.config.mjs`
- Modify `README.md`, `package.json`, `package-lock.json`, issue templates, plugin README/commands/skill/reference/assets
- Add `plugins/cc-marketspec/commands/cc-migrate.md`

---

### Task 1: Centralize format-version compatibility

**Files:**
- Create: `src/version.ts`
- Create: `test/version.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `LEGACY_FORMAT_VERSION: '1.0'`, `CURRENT_FORMAT_VERSION: '1.1'`
- Produces: `type AuthoredLayout = 'legacy' | 'namespaced'`
- Produces: `checkFormatVersion(value, layout): VersionCheck`
- Consumes: nothing from later tasks

- [ ] **Step 1: Write the failing compatibility-table tests**

```ts
// test/version.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_FORMAT_VERSION,
  LEGACY_FORMAT_VERSION,
  checkFormatVersion
} from '../src/version.ts';

test('declares legacy 1.0 and current 1.1 independently of package SemVer', () => {
  assert.equal(LEGACY_FORMAT_VERSION, '1.0');
  assert.equal(CURRENT_FORMAT_VERSION, '1.1');
});

test('accepts the version matching its authored layout', () => {
  assert.deepEqual(checkFormatVersion('1.1', 'namespaced'), {
    ok: true,
    version: '1.1'
  });
  const legacy = checkFormatVersion('1.0', 'legacy');
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.match(legacy.warning ?? '', /deprecated|migrate/i);
});

for (const [value, layout, message] of [
  ['1.0', 'namespaced', 'requires schemaVersion 1.1'],
  ['1.1', 'legacy', 'requires schemaVersion 1.0'],
  ['0.9', 'legacy', 'unsupported format major 0'],
  ['1.99', 'namespaced', 'future format minor 99'],
  ['2.0', 'namespaced', 'unsupported format major 2'],
  ['1.0.0', 'namespaced', 'MAJOR.MINOR']
] as const) {
  test(`rejects ${value} for ${layout}`, () => {
    const result = checkFormatVersion(value, layout);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, new RegExp(message.replace(/[.]/g, '\\.'), 'i'));
  });
}

test('rejects non-string versions', () => {
  const result = checkFormatVersion(1.1, 'namespaced');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /string.*MAJOR\.MINOR/i);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test test/version.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/version.ts`.

- [ ] **Step 3: Implement the complete compatibility table**

```ts
// src/version.ts
export const LEGACY_FORMAT_VERSION = '1.0' as const;
export const CURRENT_FORMAT_VERSION = '1.1' as const;

export type AuthoredLayout = 'legacy' | 'namespaced';
export type VersionCheck =
  | { ok: true; version: typeof LEGACY_FORMAT_VERSION | typeof CURRENT_FORMAT_VERSION; warning?: string }
  | { ok: false; error: string };

const FORMAT = /^(\d+)\.(\d+)$/;

export function checkFormatVersion(value: unknown, layout: AuthoredLayout): VersionCheck {
  if (typeof value !== 'string') {
    return { ok: false, error: 'schemaVersion must be a string in MAJOR.MINOR form' };
  }
  const match = FORMAT.exec(value);
  if (!match) return { ok: false, error: `schemaVersion "${value}" must use MAJOR.MINOR form` };

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 1) return { ok: false, error: `unsupported format major ${major}; install a compatible cc-marketspec` };
  if (minor > 1) return { ok: false, error: `future format minor ${minor}; upgrade cc-marketspec` };

  const required = layout === 'legacy' ? LEGACY_FORMAT_VERSION : CURRENT_FORMAT_VERSION;
  if (value !== required) {
    return { ok: false, error: `${layout} layout requires schemaVersion ${required}; found ${value}` };
  }
  return layout === 'legacy'
    ? { ok: true, version: LEGACY_FORMAT_VERSION, warning: 'legacy schemaVersion 1.0 is deprecated; run cc-marketspec migrate' }
    : { ok: true, version: CURRENT_FORMAT_VERSION };
}
```

Append these exports to `src/index.ts`:

```ts
export {
  CURRENT_FORMAT_VERSION,
  LEGACY_FORMAT_VERSION,
  checkFormatVersion,
  type AuthoredLayout,
  type VersionCheck
} from './version.ts';
```

- [ ] **Step 4: Run focused and type tests**

Run: `node --test test/version.test.ts && npm run type-check`

Expected: all version tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the compatibility contract**

```bash
git add src/version.ts src/index.ts test/version.test.ts
git commit -m "feat: enforce format version compatibility"
```

---

### Task 2: Enforce root-contained POSIX paths and deterministic file sources

**Files:**
- Create: `src/path-policy.ts`
- Create: `test/path-policy.test.ts`
- Modify: `src/fs-source.ts`
- Modify: `test/fs-source.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `normalizeInternalPath(raw, { allowRoot }): string`
- Produces: `resolveWithinRoot(root, relativePath, { allowRoot }): string`
- Produces: `OverlayFileSource(base, overrides)`
- Preserves: exported `normalize()` as a compatibility alias that now rejects unsafe input
- Consumes: no later interfaces

- [ ] **Step 1: Write failing lexical, symlink, and ordering tests**

```ts
// test/path-policy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeInternalPath, resolveWithinRoot } from '../src/path-policy.ts';

test('normalizes only safe POSIX-relative paths', () => {
  assert.equal(normalizeInternalPath('./plugins/a'), 'plugins/a');
  assert.equal(normalizeInternalPath('./', { allowRoot: true }), '');
  for (const path of ['../outside', 'a/../outside', '/abs', 'C:/abs', 'C:relative', '\\\\server\\share', 'a\\b']) {
    assert.throws(() => normalizeInternalPath(path), /relative|parent|POSIX|drive|UNC/i);
  }
});

test('resolveWithinRoot rejects a realpath escape through a link', () => {
  const parent = mkdtempSync(join(tmpdir(), 'ccms-path-'));
  const root = join(parent, 'root');
  const outside = join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret'), 'x');
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.throws(() => resolveWithinRoot(root, 'escape/secret'), /escapes marketplace root/i);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
```

Add these assertions to `test/fs-source.test.ts`:

```ts
test('list order is canonical regardless of insertion order', () => {
  const a = new MemoryFileSource({ 'z/file': 'z', 'a/file': 'a' });
  const b = new MemoryFileSource({ 'a/file': 'a', 'z/file': 'z' });
  assert.deepEqual(a.list(''), ['a', 'z']);
  assert.deepEqual(a.list(''), b.list(''));
});

test('unsafe paths are rejected instead of normalized outside the root', () => {
  assert.throws(() => normalize('../outside'), /parent/i);
  assert.throws(() => fs.read('../catalog.yaml'), /parent/i);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/path-policy.test.ts test/fs-source.test.ts`

Expected: FAIL because `src/path-policy.ts` and safe ordering do not exist.

- [ ] **Step 3: Implement path policy**

```ts
// src/path-policy.ts
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path';

export class PathPolicyError extends Error {}

export function normalizeInternalPath(raw: string, options: { allowRoot?: boolean } = {}): string {
  if (typeof raw !== 'string') throw new PathPolicyError('path must be a string');
  if (raw.includes('\\')) throw new PathPolicyError('internal paths must use POSIX separators');
  if (isAbsolute(raw) || win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith('//')) {
    throw new PathPolicyError('path must be repository-relative; absolute, drive, and UNC paths are forbidden');
  }
  const stripped = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  const parts = stripped === '' || stripped === '.' ? [] : stripped.split('/');
  if (parts.some((part) => part === '..')) throw new PathPolicyError('parent path segments are forbidden');
  if (parts.some((part) => part === '')) throw new PathPolicyError('empty path segments are forbidden');
  if (parts.length === 0 && !options.allowRoot) throw new PathPolicyError('path must not name the repository root');
  return parts.filter((part) => part !== '.').join('/');
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new PathPolicyError('resolved path escapes marketplace root');
  }
}

export function resolveWithinRoot(
  root: string,
  relativePath: string,
  options: { allowRoot?: boolean } = {}
): string {
  const canonical = normalizeInternalPath(relativePath, options);
  const rootReal = realpathSync(resolve(root));
  const target = resolve(rootReal, ...canonical.split('/').filter(Boolean));
  assertContained(rootReal, target);

  let probe = existsSync(target) ? target : dirname(target);
  while (!existsSync(probe)) probe = dirname(probe);
  const probeReal = realpathSync(probe);
  assertContained(rootReal, probeReal);
  if (existsSync(target)) assertContained(rootReal, realpathSync(target));
  return target;
}
```

- [ ] **Step 4: Make both file sources use the policy and stable ordering**

Replace `normalize` and the `NodeFileSource.abs` implementation in `src/fs-source.ts`, sort both `list()` results, and add the overlay:

```ts
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeInternalPath, resolveWithinRoot } from './path-policy.ts';

export function normalize(p: string): string {
  return normalizeInternalPath(p, { allowRoot: true });
}

export class NodeFileSource implements FileSource {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private abs(p: string): string {
    return resolveWithinRoot(this.root, p, { allowRoot: true });
  }
  read(p: string): string | null {
    const a = this.abs(p);
    if (!existsSync(a) || !statSync(a).isFile()) return null;
    return readFileSync(a, 'utf8');
  }
  exists(p: string): boolean {
    return existsSync(this.abs(p));
  }
  isDir(p: string): boolean {
    const a = this.abs(p);
    return existsSync(a) && statSync(a).isDirectory();
  }
  list(p: string): string[] {
    return this.isDir(p) ? readdirSync(this.abs(p)).sort() : [];
  }
}

export class OverlayFileSource implements FileSource {
  private readonly overlay: MemoryFileSource;
  constructor(private readonly base: FileSource, files: Record<string, string>) {
    this.overlay = new MemoryFileSource(files);
  }
  read(path: string): string | null {
    return this.overlay.read(path) ?? this.base.read(path);
  }
  exists(path: string): boolean {
    return this.overlay.exists(path) || this.base.exists(path);
  }
  isDir(path: string): boolean {
    return this.overlay.isDir(path) || this.base.isDir(path);
  }
  list(path: string): string[] {
    return [...new Set([...this.base.list(path), ...this.overlay.list(path)])].sort();
  }
}
```

Use these exact constructor and list bodies in `MemoryFileSource`:

```ts
constructor(files: Record<string, string>) {
  for (const [raw, content] of Object.entries(files)) {
    const path = normalizeInternalPath(raw, { allowRoot: true });
    this.files.set(path, content);
    for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) this.dirs.add(dir);
  }
}

list(path: string): string[] {
  const base = normalizeInternalPath(path, { allowRoot: true });
  const prefix = base === '' ? '' : base + '/';
  const names = new Set<string>();
  for (const candidate of [...this.files.keys(), ...this.dirs]) {
    if (candidate === base || !candidate.startsWith(prefix)) continue;
    const name = candidate.slice(prefix.length).split('/')[0];
    if (name) names.add(name);
  }
  return [...names].sort();
}
```

Append to `src/index.ts`:

```ts
export { normalizeInternalPath, resolveWithinRoot, PathPolicyError } from './path-policy.ts';
export { OverlayFileSource } from './fs-source.ts';
```

- [ ] **Step 5: Run focused tests and type checking**

Run: `node --test test/path-policy.test.ts test/fs-source.test.ts && npm run type-check`

Expected: all focused tests PASS and TypeScript exits 0 on Linux and Windows.

- [ ] **Step 6: Commit the path boundary**

```bash
git add src/path-policy.ts src/fs-source.ts src/index.ts test/path-policy.test.ts test/fs-source.test.ts
git commit -m "feat: enforce root-contained portable paths"
```

---

### Task 3: Resolve plugins and detect namespaced, legacy, fresh, and ambiguous layouts

**Files:**
- Create: `src/layout.ts`
- Create: `test/layout.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `normalizeInternalPath()`, format constants
- Produces: canonical path constants and `entryPathForPlugin(id)`
- Produces: `resolveMarketplacePlugins(raw): PluginResolution`
- Produces: `inspectLegacyCandidates(source, plugins): LegacyInspection`
- Produces: `inspectLayout(source, plugins): LayoutInspection`
- Later tasks consume `ResolvedPlugin`, `LayoutKind`, and layout-specific catalog/entry paths

- [ ] **Step 1: Write failing layout and source-resolution tests**

```ts
// test/layout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSource } from '../src/fs-source.ts';
import {
  CATALOG_PATH,
  DIST_MANIFEST_PATH,
  entryPathForPlugin,
  inspectLayout,
  resolveMarketplacePlugins
} from '../src/layout.ts';

const marketplace = (...plugins: Record<string, unknown>[]) =>
  resolveMarketplacePlugins(plugins);

test('maps ids to prefixed portable entry filenames', () => {
  assert.equal(CATALOG_PATH, '.cc-marketspec/catalog.yaml');
  assert.equal(DIST_MANIFEST_PATH, '.cc-marketspec/dist/manifest.json');
  assert.equal(entryPathForPlugin('con'), '.cc-marketspec/entries/plugin-con.yaml');
  assert.equal(entryPathForPlugin('nul'), '.cc-marketspec/entries/plugin-nul.yaml');
});

test('requires explicit ./ for local sources and permits the repo root', () => {
  assert.equal(marketplace({ name: 'root', source: './' }).plugins[0].dir, '');
  assert.match(marketplace({ name: 'bad', source: 'plugins/bad' }).errors[0], /start with \.\//);
  assert.match(marketplace({ name: 'bad', source: './../outside' }).errors[0], /parent/i);
});

test('reports duplicate ids and duplicate resolved legacy entry paths', () => {
  const duplicate = marketplace(
    { name: 'same', source: './plugins/a' },
    { name: 'same', source: './plugins/b' }
  );
  assert.ok(duplicate.errors.some((error) => /duplicate plugin id/i.test(error)));
  const samePath = marketplace(
    { name: 'a', source: './plugins/shared' },
    { name: 'b', source: './plugins/shared' }
  );
  assert.ok(samePath.errors.some((error) => /same legacy entry path/i.test(error)));
});

test('classifies namespaced authored candidates without reading generic files', () => {
  const resolved = marketplace({ name: 'p', source: './plugins/p' });
  const layout = inspectLayout(new MemoryFileSource({
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
    'catalog.yaml': 'owned-by: another-tool\n',
    'plugins/p/entry.yaml': 'also: another-tool\n'
  }), resolved.plugins);
  assert.equal(layout.kind, 'namespaced');
  assert.equal(layout.catalogPath, '.cc-marketspec/catalog.yaml');
});

test('requires a strong signature before auto-selecting legacy', () => {
  const resolved = marketplace({ name: 'p', source: './plugins/p' });
  const strong = inspectLayout(new MemoryFileSource({
    'catalog.yaml': 'schemaVersion: "1.0"\n',
    'plugins/p/entry.yaml': 'tagline: Legacy presentation\n'
  }), resolved.plugins);
  assert.equal(strong.kind, 'legacy');

  const catalogOnly = inspectLayout(new MemoryFileSource({
    'catalog.yaml': 'schemaVersion: "1.0"\n'
  }), resolved.plugins);
  assert.equal(catalogOnly.kind, 'ambiguous');
});

test('root manifest alone is fresh, and dist-only namespace is fresh', () => {
  const resolved = marketplace({ name: 'p', source: './plugins/p' });
  assert.equal(inspectLayout(new MemoryFileSource({ 'manifest.json': '{}' }), resolved.plugins).kind, 'fresh');
  assert.equal(inspectLayout(new MemoryFileSource({
    '.cc-marketspec/.gitignore': '/dist/\n',
    '.cc-marketspec/dist/manifest.json': '{}'
  }), resolved.plugins).kind, 'fresh');
});

test('recognizes remote objects without inventing a local directory', () => {
  const result = marketplace({ name: 'remote', source: { source: 'github', repo: 'o/r' } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.plugins[0].sourceKind, 'remote');
  assert.equal(result.plugins[0].dir, null);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/layout.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/layout.ts`.

- [ ] **Step 3: Implement canonical mapping and plugin resolution**

Create `src/layout.ts` with these public declarations and resolution rules:

```ts
import { posix } from 'node:path';
import { Catalog } from './catalog.ts';
import { Entry } from './entry.ts';
import type { FileSource } from './fs-source.ts';
import { normalizeInternalPath } from './path-policy.ts';
import { loadYaml } from './native.ts';
import { LEGACY_FORMAT_VERSION } from './version.ts';

export const SPEC_DIR = '.cc-marketspec';
export const CATALOG_PATH = '.cc-marketspec/catalog.yaml';
export const ENTRIES_DIR = '.cc-marketspec/entries';
export const DIST_MANIFEST_PATH = '.cc-marketspec/dist/manifest.json';
export const SPEC_GITIGNORE_PATH = '.cc-marketspec/.gitignore';
export const LEGACY_CATALOG_PATH = 'catalog.yaml';
export const LEGACY_MANIFEST_PATH = 'manifest.json';

export type LayoutKind = 'namespaced' | 'legacy' | 'fresh' | 'ambiguous';
export interface ResolvedPlugin {
  id: string;
  dir: string | null;
  sourceKind: 'local' | 'remote';
  marketEntry: Record<string, unknown>;
  namespacedEntryPath: string;
  legacyEntryPath: string | null;
}
export interface PluginResolution {
  plugins: ResolvedPlugin[];
  errors: string[];
  warnings: string[];
}
export interface LegacyInspection {
  hasCandidates: boolean;
  strong: boolean;
  catalog: unknown;
  catalogRaw: string | null;
  entries: Map<string, { path: string; raw: string }>;
  errors: string[];
}
export interface LayoutInspection {
  kind: LayoutKind;
  catalogPath: string | null;
  errors: string[];
  warnings: string[];
  legacy: LegacyInspection;
}

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function entryPathForPlugin(id: string): string {
  if (!ID.test(id)) throw new Error(`unsafe plugin id "${id}"; expected kebab-case`);
  return posix.join(ENTRIES_DIR, `plugin-${id}.yaml`);
}

export function resolveMarketplacePlugins(raw: unknown): PluginResolution {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plugins: ResolvedPlugin[] = [];
  const ids = new Set<string>();
  const legacyPaths = new Map<string, string>();
  if (!Array.isArray(raw)) return { plugins, errors: ['marketplace.json plugins must be an array'], warnings };

  for (const value of raw) {
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const id = typeof entry.name === 'string' ? entry.name : '';
    if (!ID.test(id)) {
      errors.push(`marketplace plugin id "${id}" must be kebab-case`);
      continue;
    }
    if (ids.has(id)) errors.push(`duplicate plugin id "${id}"`);
    ids.add(id);

    let dir: string | null;
    let sourceKind: 'local' | 'remote';
    if (entry.source === undefined) {
      dir = posix.join('plugins', id);
      sourceKind = 'local';
      warnings.push(`${id}: implicit plugins/${id} source is deprecated; add source: "./plugins/${id}"`);
    } else if (typeof entry.source === 'string') {
      if (!entry.source.startsWith('./')) {
        errors.push(`${id}: local source must start with ./`);
        continue;
      }
      try {
        dir = normalizeInternalPath(entry.source.slice(2), { allowRoot: true });
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      sourceKind = 'local';
    } else if (entry.source && typeof entry.source === 'object') {
      dir = null;
      sourceKind = 'remote';
    } else {
      errors.push(`${id}: source must be a ./ local path or a remote source object`);
      continue;
    }

    const legacyEntryPath = dir === null ? null : posix.join(dir, 'entry.yaml');
    if (legacyEntryPath !== null) {
      const prior = legacyPaths.get(legacyEntryPath);
      if (prior && prior !== id) errors.push(`${prior} and ${id} resolve to the same legacy entry path ${legacyEntryPath}`);
      legacyPaths.set(legacyEntryPath, id);
    }
    plugins.push({
      id,
      dir,
      sourceKind,
      marketEntry: entry,
      namespacedEntryPath: entryPathForPlugin(id),
      legacyEntryPath
    });
  }
  return { plugins, errors: errors.sort(compare), warnings: warnings.sort(compare) };
}
```

- [ ] **Step 4: Implement strict legacy inspection and four-state selection**

Add these functions to `src/layout.ts`:

```ts
function parseYaml(source: FileSource, path: string): unknown {
  try {
    return loadYaml(source, path);
  } catch {
    return undefined;
  }
}

export function inspectLegacyCandidates(source: FileSource, plugins: ResolvedPlugin[]): LegacyInspection {
  const catalogRaw = source.read(LEGACY_CATALOG_PATH);
  const candidateEntries = plugins.filter((plugin) =>
    plugin.legacyEntryPath !== null && source.read(plugin.legacyEntryPath) !== null
  );
  const hasCandidates = catalogRaw !== null || candidateEntries.length > 0;
  const errors: string[] = [];
  const entries = new Map<string, { path: string; raw: string }>();
  const catalog = catalogRaw === null ? null : parseYaml(source, LEGACY_CATALOG_PATH);
  const catalogResult = Catalog.safeParse(catalog);
  if (catalogRaw !== null && !catalogResult.success) errors.push('catalog.yaml does not validate as a cc-marketspec catalog');
  if (catalogResult.success && catalogResult.data.schemaVersion !== LEGACY_FORMAT_VERSION) {
    errors.push(`catalog.yaml schemaVersion must be ${LEGACY_FORMAT_VERSION} for legacy layout`);
  }
  for (const plugin of candidateEntries) {
    const path = plugin.legacyEntryPath as string;
    const raw = source.read(path) as string;
    if (!Entry.safeParse(parseYaml(source, path)).success) {
      errors.push(`${path} does not validate as a cc-marketspec entry`);
    } else {
      entries.set(plugin.id, { path, raw });
    }
  }
  const strong = catalogResult.success
    && catalogResult.data.schemaVersion === LEGACY_FORMAT_VERSION
    && entries.size > 0
    && errors.length === 0;
  return { hasCandidates, strong, catalog, catalogRaw, entries, errors: errors.sort(compare) };
}

export function inspectLayout(source: FileSource, plugins: ResolvedPlugin[]): LayoutInspection {
  const legacy = inspectLegacyCandidates(source, plugins);
  const namespacedCandidates = source.read(CATALOG_PATH) !== null
    || (source.isDir(ENTRIES_DIR) && source.list(ENTRIES_DIR).length > 0);
  if (namespacedCandidates) {
    const expected = new Set(plugins.map((plugin) => posix.basename(plugin.namespacedEntryPath)));
    const warnings = source.isDir(ENTRIES_DIR)
      ? source.list(ENTRIES_DIR)
          .filter((name) => name.endsWith('.yaml') && !expected.has(name))
          .map((name) => `${posix.join(ENTRIES_DIR, name)}: orphan entry has no marketplace plugin`)
      : [];
    if (legacy.strong) warnings.push('recognized legacy files remain; run cc-marketspec migrate to resume safe cleanup');
    return { kind: 'namespaced', catalogPath: CATALOG_PATH, errors: [], warnings: warnings.sort(compare), legacy };
  }
  if (!legacy.hasCandidates) return { kind: 'fresh', catalogPath: null, errors: [], warnings: [], legacy };
  if (legacy.strong) {
    return {
      kind: 'legacy',
      catalogPath: LEGACY_CATALOG_PATH,
      errors: [],
      warnings: ['legacy layout is deprecated; run cc-marketspec migrate'],
      legacy
    };
  }
  return {
    kind: 'ambiguous',
    catalogPath: null,
    errors: ['generic catalog.yaml/entry.yaml candidates cannot be safely claimed; run cc-marketspec migrate --from legacy'],
    warnings: [],
    legacy
  };
}

export function entryPathForLayout(layout: LayoutKind, plugin: ResolvedPlugin): string | null {
  if (layout === 'namespaced') return plugin.namespacedEntryPath;
  if (layout === 'legacy') return plugin.legacyEntryPath;
  return null;
}
```

Append these exact public layout exports to `src/index.ts`:

```ts
export {
  CATALOG_PATH,
  DIST_MANIFEST_PATH,
  ENTRIES_DIR,
  LEGACY_CATALOG_PATH,
  LEGACY_MANIFEST_PATH,
  SPEC_DIR,
  SPEC_GITIGNORE_PATH,
  entryPathForLayout,
  entryPathForPlugin,
  inspectLayout,
  inspectLegacyCandidates,
  resolveMarketplacePlugins,
  type LayoutInspection,
  type LayoutKind,
  type LegacyInspection,
  type PluginResolution,
  type ResolvedPlugin
} from './layout.ts';
```

- [ ] **Step 5: Run focused tests and all pre-existing pure tests**

Run: `node --test test/layout.test.ts test/fs-source.test.ts test/version.test.ts && npm run type-check`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit layout resolution**

```bash
git add src/layout.ts src/index.ts test/layout.test.ts
git commit -m "feat: detect namespaced and legacy layouts"
```

---

### Task 4: Make generation layout-aware, version-gated, explicit, and deterministic

**Files:**
- Modify: `src/generate.ts`
- Modify: `src/native.ts`
- Modify: `src/coverage.ts`
- Modify: `test/generate.test.ts`
- Modify: `test/native.test.ts`
- Modify: `test/coverage.test.ts`

**Interfaces:**
- Consumes: `resolveMarketplacePlugins()`, `inspectLayout()`, `entryPathForLayout()`, `checkFormatVersion()`
- Changes: `GenerateResult` adds `layout: LayoutKind`
- Preserves: `generateManifest(FileSource | string, options)` remains pure with respect to writes
- Produces: stable sorted `errors` and `warnings` for CLI, migration, Worker, and tests

- [ ] **Step 1: Move generator fixtures to the new paths and write failing behavior tests**

In `test/generate.test.ts`, use these helpers for all presentation fixtures:

```ts
const catalog = (body = '') => `schemaVersion: "1.1"\n${body}`;
const entryPath = (id: string) => `.cc-marketspec/entries/plugin-${id}.yaml`;
```

Replace existing `catalog.yaml` fixture keys with `.cc-marketspec/catalog.yaml`, and replace plugin-local `entry.yaml` fixture keys with `entryPath(id)`. Add:

```ts
test('native-only generation uses current 1.1 without authoring files', () => {
  const { manifest, errors, layout } = run({
    '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
    'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' })
  });
  assert.deepEqual(errors, []);
  assert.equal(layout, 'fresh');
  assert.equal((manifest as { schemaVersion: string }).schemaVersion, '1.1');
});

test('namespaced layout ignores unrelated generic root files', () => {
  const { manifest, errors } = run({
    '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
    'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
    '.cc-marketspec/catalog.yaml': catalog('lang: en\n'),
    [entryPath('sample')]: 'tagline: Namespaced value\n',
    'catalog.yaml': 'not: ours\n',
    'plugins/sample/entry.yaml': 'not: ours\n',
    'manifest.json': '{"ownedBy":"another-tool"}'
  });
  assert.deepEqual(errors, []);
  assert.equal((manifest as { plugins: { tagline?: string }[] }).plugins[0].tagline, 'Namespaced value');
});

test('strong legacy 1.0 remains readable with a migration warning', () => {
  const { manifest, errors, warnings, layout } = run({
    '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
    'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
    'catalog.yaml': 'schemaVersion: "1.0"\n',
    'plugins/sample/entry.yaml': 'tagline: Legacy value\n'
  });
  assert.deepEqual(errors, []);
  assert.equal(layout, 'legacy');
  assert.equal((manifest as { schemaVersion: string }).schemaVersion, '1.0');
  assert.ok(warnings.some((warning) => /migrate/i.test(warning)));
});

test('catalog-only legacy input is ambiguous and not silently read', () => {
  const { errors, layout } = run({
    '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
    'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
    'catalog.yaml': 'schemaVersion: "1.0"\n'
  });
  assert.equal(layout, 'ambiguous');
  assert.ok(errors.some((error) => /--from legacy/i.test(error)));
});

test('rejects syntactically valid but unsupported format versions', () => {
  for (const version of ['1.0', '1.99', '2.0']) {
    const { errors } = run({
      '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
      'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
      '.cc-marketspec/catalog.yaml': `schemaVersion: "${version}"\n`
    });
    assert.ok(errors.some((error) => error.includes(version)), `missing error for ${version}`);
  }
});

test('reports remote plugin discovery instead of silently dropping it', () => {
  const { errors, manifest } = run({
    '.claude-plugin/marketplace.json': market({
      name: 'remote',
      source: { source: 'github', repo: 'owner/repo' }
    })
  });
  assert.ok(errors.some((error) => /remote.*cannot inspect|cannot inspect.*remote/i.test(error)));
  assert.deepEqual((manifest as { plugins: unknown[] }).plugins, []);
});

test('diagnostics and discovered component arrays are deterministic', () => {
  const files = {
    '.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
    'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
    'plugins/sample/skills/zeta/SKILL.md': '---\nname: zeta\ndescription: z\n---\n',
    'plugins/sample/skills/alpha/SKILL.md': '---\nname: alpha\ndescription: a\n---\n'
  };
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  const left = run(files);
  const right = run(reversed);
  assert.equal(JSON.stringify(left.manifest), JSON.stringify(right.manifest));
  assert.deepEqual(left.errors, right.errors);
  assert.deepEqual(left.warnings, right.warnings);
  assert.deepEqual(
    (left.manifest as { plugins: { skills: { name: string }[] }[] }).plugins[0].skills.map((skill) => skill.name),
    ['alpha', 'zeta']
  );
});
```

- [ ] **Step 2: Run the generator tests and verify old hard-coded paths fail**

Run: `node --test test/generate.test.ts test/native.test.ts test/coverage.test.ts`

Expected: FAIL because generation still reads root `catalog.yaml`, plugin-local `entry.yaml`, and emits version `1.0`.

- [ ] **Step 3: Route generation through plugin and layout resolution**

In `src/generate.ts`, replace Node `join` with `posix.join`, remove `DEFAULT_SCHEMA_VERSION` and `PLUGINS`, add the layout/version imports, and change the result:

```ts
import { posix } from 'node:path';
import {
  entryPathForLayout,
  inspectLayout,
  resolveMarketplacePlugins,
  type LayoutKind,
  type ResolvedPlugin
} from './layout.ts';
import { checkFormatVersion, CURRENT_FORMAT_VERSION } from './version.ts';

export interface GenerateResult {
  manifest: unknown;
  errors: string[];
  warnings: string[];
  layout: LayoutKind;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
```

After reading marketplace JSON, resolve plugins and layout exactly once:

```ts
const resolution = resolveMarketplacePlugins(market.plugins);
errors.push(...resolution.errors);
warns.push(...resolution.warnings);
const inspected = inspectLayout(source, resolution.plugins);
errors.push(...inspected.errors);
warns.push(...inspected.warnings);
const layout = inspected.kind;
```

Replace the catalog loader with:

```ts
const catalog = (() => {
  if (layout === 'fresh') return null;
  if (layout === 'ambiguous' || inspected.catalogPath === null) return null;
  const raw = loadYaml<unknown>(source, inspected.catalogPath);
  if (raw == null) {
    err(`${inspected.catalogPath}: catalog is required when authored entries exist`);
    return null;
  }
  const parsed = Catalog.safeParse(raw);
  if (!parsed.success) {
    err(`${inspected.catalogPath}: ${parsed.error.issues.map((issue) =>
      `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
    return null;
  }
  const compatible = checkFormatVersion(parsed.data.schemaVersion, layout);
  if (!compatible.ok) {
    err(`${inspected.catalogPath}: ${compatible.error}`);
    return null;
  }
  if (compatible.warning) warn(compatible.warning);
  return parsed.data;
})();
```

Change `buildPlugin` to receive `plugin: ResolvedPlugin`, derive `id`, `dir`, and `entryPath` once, and use that path for loading, validation, coverage, and diagnostics:

```ts
function buildPlugin(
  plugin: ResolvedPlugin,
  groupIds: Set<string>,
  coverageCfg: CoverageConfig = {}
) {
  const { id, dir, marketEntry } = plugin;
  if (plugin.sourceKind === 'remote' || dir === null) {
    err(`${id}: remote source cannot be inspected; use a local ./ source or pre-generate in the source repository`);
    return null;
  }
  const entryPath = entryPathForLayout(layout, plugin);
  const entry = (() => {
    if (entryPath === null) return null;
    const raw = loadYaml<unknown>(source, entryPath);
    if (raw == null) return null;
    const parsed = Entry.safeParse(raw);
    if (!parsed.success) {
      err(`${entryPath}: ${parsed.error.issues.map((issue) =>
        `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
      return null;
    }
    return parsed.data;
  })();
  const pj = readJSON(source, posix.join(dir, '.claude-plugin', 'plugin.json'));
  // The current schema validation and native skill/command/agent/MCP/hook joins
  // remain byte-for-byte unchanged because they contain no layout decision.
  // Their path-bearing coverage call is replaced by the line below.
  const cov = analyzeCoverage(facts, entry, coverageCfg, id, entryPath ?? plugin.namespacedEntryPath);
}
```

In `src/native.ts`, replace `import { join, basename } from 'node:path'`
with `import { posix, basename } from 'node:path'`, then replace each internal
`join(...)` call with the matching POSIX call:

```ts
posix.join(pluginDir, '.claude-plugin', 'plugin.json')
posix.join(dir, 'skills')
posix.join(dir, 'commands')
posix.join(dir, 'agents')
posix.join(dir, '.mcp.json')
posix.join(dir, 'hooks', 'hooks.json')
```

All presentation diagnostics use `entryPath`; group diagnostics name
`${inspected.catalogPath ?? CATALOG_PATH}`. No plugin source directory is
used to construct a namespaced entry path.

The plugin loop must preserve marketplace order and diagnose unavailable local data:

```ts
const plugins = resolution.plugins
  .map((plugin) => {
    try {
      if (plugin.sourceKind === 'local' && plugin.dir !== null
        && !source.exists(posix.join(plugin.dir, '.claude-plugin', 'plugin.json'))) {
        err(`${plugin.id}: local source is missing .claude-plugin/plugin.json at ${plugin.dir || '.'}`);
        return null;
      }
      return buildPlugin(plugin, groupIds, coverageCfg);
    } catch (error) {
      err(`${plugin.id}: failed to process — ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  })
  .filter((plugin): plugin is NonNullable<typeof plugin> => plugin !== null);
```

Set manifest version and every return path consistently:

```ts
const manifest = {
  schemaVersion: catalog?.schemaVersion ?? CURRENT_FORMAT_VERSION,
  marketplace: prune({ name: market.name, description: market.description, lang: catalog?.lang, owner: market.owner }),
  groups: catalog?.groups,
  plugins
};

return {
  manifest,
  errors: [...new Set(errors)].sort(compare),
  warnings: [...new Set(warns)].sort(compare),
  layout
};
```

When marketplace JSON cannot be read, return `layout: 'fresh'`. Do not return before constructing a minimal manifest after other recoverable diagnostics.

- [ ] **Step 4: Sort every filesystem-discovered component**

In `src/native.ts`, introduce:

```ts
const compareName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
```

Append `.sort(compareName)` to the results of `deriveSkills`, `deriveCommands`, and `deriveAgents`. Sort MCP entries before mapping and hooks before return:

```ts
return Object.entries(servers)
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  .map(([name, server]) => ({
    name,
    type: server.type ?? (server.url ? 'http' : 'stdio'),
    envKeys: Object.entries(server.env ?? {})
      .filter(([, value]) => typeof value === 'string' && value.includes('${'))
      .map(([key]) => key)
      .sort()
  }));
```

```ts
return out.sort((left, right) => {
  const a = `${left.event}\0${left.matcher ?? ''}`;
  const b = `${right.event}\0${right.matcher ?? ''}`;
  return a < b ? -1 : a > b ? 1 : 0;
});
```

Change `src/coverage.ts`'s fallback path to `entryPathForPlugin(pluginId)`; callers for legacy mode continue passing the explicit legacy path.

- [ ] **Step 5: Run generator, native, coverage, and type tests**

Run: `node --test test/generate.test.ts test/native.test.ts test/coverage.test.ts && npm run type-check`

Expected: all focused tests PASS; opposite insertion order emits identical manifest bytes and diagnostics.

- [ ] **Step 6: Commit deterministic layout-aware generation**

```bash
git add src/generate.ts src/native.ts src/coverage.ts test/generate.test.ts test/native.test.ts test/coverage.test.ts
git commit -m "feat: generate deterministic namespaced manifests"
```

---

### Task 5: Add safe output selection and CLI parsing

**Files:**
- Create: `src/output.ts`
- Create: `test/output.test.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `LayoutKind`, `DIST_MANIFEST_PATH`, `resolveWithinRoot()`
- Produces: `defaultOutputPath(layout): string`
- Produces: `writeManifestOutput(root, relativePath, manifest): void`
- Produces: `ensureNamespacedDistIgnore(root): string[]`
- CLI adds `--output <repo-relative-path>`; migration dispatch is reserved for Task 8

- [ ] **Step 1: Write failing atomic-output and CLI tests**

```ts
// test/output.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultOutputPath,
  ensureNamespacedDistIgnore,
  writeManifestOutput
} from '../src/output.ts';

test('selects root output only for legacy compatibility', () => {
  assert.equal(defaultOutputPath('legacy'), 'manifest.json');
  assert.equal(defaultOutputPath('fresh'), '.cc-marketspec/dist/manifest.json');
  assert.equal(defaultOutputPath('namespaced'), '.cc-marketspec/dist/manifest.json');
});

test('writes fixed JSON bytes and creates the tool-owned ignore file', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
  try {
    assert.deepEqual(ensureNamespacedDistIgnore(root), []);
    writeManifestOutput(root, '.cc-marketspec/dist/manifest.json', { b: 2 });
    assert.equal(readFileSync(join(root, '.cc-marketspec/.gitignore'), 'utf8'), '/dist/\n');
    assert.equal(readFileSync(join(root, '.cc-marketspec/dist/manifest.json'), 'utf8'), '{\n  "b": 2\n}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not overwrite an existing ignore file and warns when /dist/ is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
  try {
    mkdirSync(join(root, '.cc-marketspec'), { recursive: true });
    writeFileSync(join(root, '.cc-marketspec/.gitignore'), '# user rules\n');
    const warnings = ensureNamespacedDistIgnore(root);
    assert.equal(readFileSync(join(root, '.cc-marketspec/.gitignore'), 'utf8'), '# user rules\n');
    assert.ok(warnings.some((warning) => warning.includes('/dist/')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects custom output traversal and symlink escape', () => {
  const parent = mkdtempSync(join(tmpdir(), 'ccms-output-'));
  const root = join(parent, 'root');
  const outside = join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.throws(() => writeManifestOutput(root, '../outside.json', {}), /parent/i);
    assert.throws(() => writeManifestOutput(root, 'escape/manifest.json', {}), /escapes marketplace root/i);
    assert.equal(existsSync(join(outside, 'manifest.json')), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
```

Replace the old root-output assertions in `test/cli.test.ts` and add:

```ts
test('default fresh mode writes ignored namespaced output', () => {
  const root = makeMarket(VALID);
  try {
    const { code } = capture(['node', 'cli', root]);
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, '.cc-marketspec/dist/manifest.json')), true);
    assert.equal(existsSync(join(root, 'manifest.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--output writes a safe custom repo-relative target', () => {
  const root = makeMarket(VALID);
  try {
    const { code } = capture(['node', 'cli', root, '--output', 'site/public/marketplace.json']);
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, 'site/public/marketplace.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--check --output is rejected and writes nothing', () => {
  const root = makeMarket(VALID);
  try {
    const result = capture(['node', 'cli', root, '--check', '--output', 'out.json']);
    assert.equal(result.code, 1);
    assert.match(result.out, /cannot.*--check.*--output/i);
    assert.equal(existsSync(join(root, 'out.json')), false);
    assert.equal(existsSync(join(root, '.cc-marketspec')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const output of ['../outside.json', '/tmp/out.json', 'C:/out.json', 'C:out.json', '\\\\server\\out.json']) {
  test(`--output rejects ${output}`, () => {
    const root = makeMarket(VALID);
    try {
      const result = capture(['node', 'cli', root, '--output', output]);
      assert.equal(result.code, 1);
      assert.equal(existsSync(join(root, 'manifest.json')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 2: Run output and CLI tests and verify they fail**

Run: `node --test test/output.test.ts test/cli.test.ts`

Expected: FAIL because `src/output.ts` is missing and CLI still writes root `manifest.json`.

- [ ] **Step 3: Implement atomic output and ignore-file policy**

```ts
// src/output.ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DIST_MANIFEST_PATH, SPEC_GITIGNORE_PATH, type LayoutKind } from './layout.ts';
import { resolveWithinRoot } from './path-policy.ts';

export const DIST_IGNORE_CONTENT = '/dist/\n';

export function defaultOutputPath(layout: LayoutKind): string {
  return layout === 'legacy' ? 'manifest.json' : DIST_MANIFEST_PATH;
}

function writeTextAtomic(root: string, relativePath: string, content: string): void {
  const targetBeforeCreate = resolveWithinRoot(root, relativePath);
  mkdirSync(dirname(targetBeforeCreate), { recursive: true });
  const target = resolveWithinRoot(root, relativePath);
  const temporaryRelative = `${relativePath}.tmp-${randomUUID()}`;
  const temporary = resolveWithinRoot(root, temporaryRelative);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function ensureNamespacedDistIgnore(root: string): string[] {
  const path = resolveWithinRoot(root, SPEC_GITIGNORE_PATH);
  if (!existsSync(path)) {
    writeTextAtomic(root, SPEC_GITIGNORE_PATH, DIST_IGNORE_CONTENT);
    return [];
  }
  const body = readFileSync(path, 'utf8');
  return body.split(/\r?\n/).some((line) => line.trim() === '/dist/')
    ? []
    : [`${SPEC_GITIGNORE_PATH}: add /dist/ so generated output stays out of git`];
}

export function writeManifestOutput(root: string, relativePath: string, manifest: unknown): void {
  writeTextAtomic(root, relativePath, JSON.stringify(manifest, null, 2) + '\n');
}
```

Export these functions from `src/index.ts`.

- [ ] **Step 4: Parse `--output`, preserve check purity, and select defaults**

Update `USAGE` in `src/cli.ts` to document `--output <path>` and the namespaced default. Parse the option with an index-based loop so its value cannot be mistaken for the root:

```ts
function optionValue(args: string[], name: string): { value?: string; error?: string } {
  const index = args.indexOf(name);
  if (index === -1) return {};
  const value = args[index + 1];
  if (!value || value.startsWith('-')) return { error: `${name} requires a value` };
  if (args.indexOf(name, index + 1) !== -1) return { error: `${name} may be specified only once` };
  return { value };
}

function positionalRoot(args: string[], optionsWithValues: Set<string>): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

function validateOptions(
  args: string[],
  flags: Set<string>,
  optionsWithValues: Set<string>
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith('-') && !flags.has(arg)) return `unknown option ${arg}`;
  }
  return undefined;
}
```

In generate dispatch:

```ts
const outputOption = optionValue(args, '--output');
if (outputOption.error) {
  console.error('ERROR ' + outputOption.error);
  return 1;
}
if (check && outputOption.value) {
  console.error('ERROR --check and --output cannot be combined');
  return 1;
}
const root = resolve(positionalRoot(args, new Set(['--output'])) ?? process.cwd());
const result = generateManifest(root, { strictCoverage: strict });
for (const warning of result.warnings) console.warn('WARN ' + warning);
if (result.errors.length > 0) {
  for (const error of result.errors) console.error('ERROR ' + error);
  console.error(`\n${result.errors.length} error(s) — manifest NOT written.`);
  return 1;
}
if (check) {
  console.log(`cc-marketspec: OK — ${result.manifest.plugins.length} plugins, ${result.warnings.length} warning(s). (--check: nothing written)`);
  return 0;
}

const output = outputOption.value ?? defaultOutputPath(result.layout);
try {
  if (!outputOption.value && result.layout !== 'legacy') {
    for (const warning of ensureNamespacedDistIgnore(root)) console.warn('WARN ' + warning);
  }
  writeManifestOutput(root, output, result.manifest);
  console.log(`cc-marketspec: wrote ${output} — ${result.manifest.plugins.length} plugins, ${result.warnings.length} warning(s).`);
  return 0;
} catch (error) {
  console.error('ERROR ' + (error instanceof Error ? error.message : String(error)));
  return 1;
}
```

Keep manifest typing local rather than using unchecked property access in the final implementation.

- [ ] **Step 5: Run output, CLI, check-purity, and type tests**

Run: `node --test test/output.test.ts test/cli.test.ts && npm run type-check`

Expected: all tests PASS; every error case leaves both root `manifest.json` and `.cc-marketspec/` absent.

- [ ] **Step 6: Commit safe CLI output**

```bash
git add src/output.ts src/cli.ts src/index.ts test/output.test.ts test/cli.test.ts
git commit -m "feat: write manifests to safe namespaced output"
```

---

### Task 6: Scaffold only namespaced authoring data

**Files:**
- Modify: `src/init.ts`
- Modify: `src/cli.ts`
- Modify: `test/init.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: canonical layout paths, plugin resolution, and layout inspection
- Changes: `planInit(source): InitPlan` adds `errors` and `warnings`
- Preserves: planning remains pure; CLI alone writes returned files

- [ ] **Step 1: Replace old init expectations with failing namespaced cases**

```ts
// Core assertions to replace/add in test/init.test.ts
test('fresh init creates only namespaced authored files at version 1.1', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      plugins: [{ name: 'root', source: './' }, { name: 'con', source: './plugins/con' }]
    }),
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'root', version: '1.0.0' }),
    'plugins/con/.claude-plugin/plugin.json': JSON.stringify({ name: 'con', version: '1.0.0' })
  });
  const plan = planInit(source);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.writes['.cc-marketspec/.gitignore'], '/dist/\n');
  assert.match(plan.writes['.cc-marketspec/catalog.yaml'], /schemaVersion: "1\.1"/);
  assert.ok(plan.writes['.cc-marketspec/entries/plugin-root.yaml']);
  assert.ok(plan.writes['.cc-marketspec/entries/plugin-con.yaml']);
  assert.equal('catalog.yaml' in plan.writes, false);
  assert.equal('entry.yaml' in plan.writes, false);
});

test('init never overwrites namespaced files', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    '.cc-marketspec/.gitignore': '# custom\n',
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\nlang: zh-TW\n'
  });
  const plan = planInit(source);
  assert.equal(Object.keys(plan.writes).length, 0);
  assert.ok(plan.actions.every((action) => action.status === 'skipped'));
});

test('legacy and ambiguous generic data get migration guidance and zero writes', () => {
  for (const files of [
    { 'catalog.yaml': 'schemaVersion: "1.0"\n' },
    { 'catalog.yaml': 'schemaVersion: "1.0"\n', 'plugins/p/entry.yaml': 'tagline: legacy\n' }
  ]) {
    const source = new MemoryFileSource({
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'mk',
        plugins: [{ name: 'p', source: './plugins/p' }]
      }),
      'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
      ...files
    });
    const plan = planInit(source);
    assert.equal(Object.keys(plan.writes).length, 0);
    assert.ok([...plan.errors, ...plan.warnings].some((message) => /migrate/i.test(message)));
  }
});

test('remote plugins are explicit and do not receive fabricated entry files', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      plugins: [{ name: 'remote', source: { source: 'github', repo: 'o/r' } }]
    })
  });
  const plan = planInit(source);
  assert.equal('.cc-marketspec/entries/plugin-remote.yaml' in plan.writes, false);
  assert.ok(plan.warnings.some((warning) => /remote/i.test(warning)));
});
```

Add this CLI integration test:

```ts
test('init writes namespaced authored files but no generated manifest', () => {
  const root = makeMarket(VALID);
  try {
    const result = capture(['node', 'cli', 'init', root]);
    assert.equal(result.code, 0);
    assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/entries/plugin-sample.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/dist/manifest.json')), false);
    assert.equal(existsSync(join(root, 'catalog.yaml')), false);
    assert.equal(existsSync(join(root, 'plugins/sample/entry.yaml')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run init and CLI tests and verify they fail**

Run: `node --test test/init.test.ts test/cli.test.ts`

Expected: FAIL because init still creates root `catalog.yaml` and plugin-local `entry.yaml`.

- [ ] **Step 3: Replace init planning with namespaced planning**

Update `src/init.ts` constants and result type:

```ts
import {
  CATALOG_PATH,
  SPEC_GITIGNORE_PATH,
  entryPathForPlugin,
  inspectLayout,
  resolveMarketplacePlugins
} from './layout.ts';
import { CURRENT_FORMAT_VERSION } from './version.ts';

export interface InitPlan {
  actions: InitAction[];
  writes: Record<string, string>;
  ciSnippet: string;
  errors: string[];
  warnings: string[];
}

const CATALOG_TEMPLATE = `# Marketplace-level presentation data owned by cc-marketspec.
# Native metadata (name/owner) remains in .claude-plugin/marketplace.json.
schemaVersion: "${CURRENT_FORMAT_VERSION}"
lang: en
groups:
  - id: examples
    label: Examples
    note: Illustrative plugins
# Optional coverage severity overrides use <component>.<field> or "*".
# coverage:
#   skill.trigger: warn
`;

const CI_SNIPPET = `# Read-only pull-request gate:
#   npx @xbluesky/cc-marketspec --check
# Generate during the site/deploy build; default output:
#   .cc-marketspec/dist/manifest.json
`;
```

After reading marketplace JSON, call `resolveMarketplacePlugins(market.plugins ?? [])` and `inspectLayout(source, resolution.plugins)`. Block every write when plugin resolution failed or generic legacy data needs migration:

```ts
const resolution = resolveMarketplacePlugins(market.plugins ?? []);
const layout = inspectLayout(source, resolution.plugins);
if (resolution.errors.length > 0 || layout.kind === 'legacy' || layout.kind === 'ambiguous') {
  return {
    actions: [],
    writes: {},
    ciSnippet: CI_SNIPPET,
    errors: [...resolution.errors, ...layout.errors].sort(compare),
    warnings: [...resolution.warnings, ...layout.warnings].sort(compare)
  };
}
```

For `fresh` or `namespaced`, plan each missing path with this exact helper:

```ts
const planWrite = (path: string, content: string) => {
  if (source.exists(path)) {
    actions.push({ path, status: 'skipped', reason: 'already exists' });
  } else {
    writes[path] = content;
    actions.push({ path, status: 'created' });
  }
};

planWrite(SPEC_GITIGNORE_PATH, '/dist/\n');
planWrite(CATALOG_PATH, CATALOG_TEMPLATE);
for (const plugin of resolution.plugins) {
  if (plugin.sourceKind === 'remote' || plugin.dir === null) {
    warnings.push(`${plugin.id}: remote source cannot be scaffolded without local native files`);
    continue;
  }
  if (!source.exists(posix.join(plugin.dir, '.claude-plugin', 'plugin.json'))) {
    warnings.push(`${plugin.id}: local plugin.json is missing; entry was not scaffolded`);
    continue;
  }
  planWrite(entryPathForPlugin(plugin.id), entryTemplate(plugin.id));
}
return {
  actions,
  writes,
  ciSnippet: CI_SNIPPET,
  errors: [...resolution.errors].sort(compare),
  warnings: [...resolution.warnings, ...warnings].sort(compare)
};
```

Set the entry template to:

```ts
function entryTemplate(pluginId: string): string {
  return `# Marketplace presentation overlay for ${pluginId}. Every field is optional.
# yaml-language-server: $schema=node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json
# Groups are declared in .cc-marketspec/catalog.yaml.
# Field guide: marketplace-flow/references/entry-authoring.md or the hosted MCP.
#
# tagline: add a concise card summary when it improves the native description
# intro: add a short marketplace-facing lede
# group: add an id declared in .cc-marketspec/catalog.yaml
# tips:
#   - add a concrete power move
# traps:
#   - add a concrete pitfall and remedy
`;
}
```

- [ ] **Step 4: Make CLI init fail safely on plan errors**

In `src/cli.ts`, print init warnings, return 1 without writing when `errors.length > 0`, and only then flush `writes` using `resolveWithinRoot(root, rel)` instead of `join(root, rel)`.

```ts
const plan = planInit(new NodeFileSource(root));
for (const warning of plan.warnings) console.warn('WARN ' + warning);
if (plan.errors.length > 0) {
  for (const error of plan.errors) console.error('ERROR ' + error);
  return 1;
}
for (const [relativePath, content] of Object.entries(plan.writes)) {
  const absolutePath = resolveWithinRoot(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
}
```

- [ ] **Step 5: Run focused tests and type checking**

Run: `node --test test/init.test.ts test/cli.test.ts && npm run type-check`

Expected: all tests PASS; init writes no `manifest.json` and never claims generic legacy names.

- [ ] **Step 6: Commit namespaced scaffolding**

```bash
git add src/init.ts src/cli.ts test/init.test.ts test/cli.test.ts
git commit -m "feat: scaffold namespaced marketplace data"
```

---

### Task 7: Build a pure, comment-preserving migration planner

**Files:**
- Create: `src/migration.ts`
- Create: `test/migration.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: layout inspection, plugin resolution, `OverlayFileSource`, format constants, and pure `generateManifest()`
- Produces: `MigrationPlan`, `PlannedRemoval`, `MigrationOptions`
- Produces: `planMigration(source, options): MigrationPlan`
- Produces: writes already containing a validated namespaced catalog, entries, `.gitignore`, and deterministic manifest
- Task 8 consumes the plan without re-deciding ownership or compatibility

- [ ] **Step 1: Install the direct comment-preserving YAML dependency**

Run: `npm install yaml@^2`

Expected: `package.json` has a direct `yaml` dependency and `package-lock.json` resolves it. Keep `js-yaml` because native/frontmatter parsing still uses it.

- [ ] **Step 2: Write failing pure-plan tests**

Start `test/migration.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSource } from '../src/fs-source.ts';
import { planMigration } from '../src/migration.ts';

function legacy(extra: Record<string, string> = {}): MemoryFileSource {
  return new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      plugins: [{ name: 'sample', source: './plugins/sample' }]
    }),
    'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({
      name: 'sample',
      version: '1.0.0'
    }),
    'catalog.yaml': [
      '# catalog comment',
      'schemaVersion: "1.0" # keep quote',
      'lang: en',
      'groups:',
      '  - id: tools',
      '    label: Tools',
      ''
    ].join('\n'),
    'plugins/sample/entry.yaml': [
      '# entry comment',
      'group: tools',
      'tagline: Legacy presentation',
      ''
    ].join('\n'),
    ...extra
  });
}

test('plans a complete 1.0 to 1.1 tree without mutating the source', () => {
  const source = legacy();
  const beforeCatalog = source.read('catalog.yaml');
  const plan = planMigration(source);
  assert.equal(plan.kind, 'migrate');
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.sourceVersion, '1.0');
  assert.equal(plan.targetVersion, '1.1');
  assert.equal(plan.writes['.cc-marketspec/.gitignore'], '/dist/\n');
  assert.ok(plan.writes['.cc-marketspec/catalog.yaml']);
  assert.ok(plan.writes['.cc-marketspec/entries/plugin-sample.yaml']);
  assert.ok(plan.writes['.cc-marketspec/dist/manifest.json']);
  assert.ok(plan.writes['.cc-marketspec/.migration-state.json']);
  assert.equal(source.read('catalog.yaml'), beforeCatalog);
});

test('catalog rewrite preserves comments, quoting, and key order', () => {
  const plan = planMigration(legacy());
  const catalog = plan.writes['.cc-marketspec/catalog.yaml'];
  assert.match(catalog, /^# catalog comment/m);
  assert.match(catalog, /schemaVersion: "1\.1" # keep quote/);
  assert.ok(catalog.indexOf('schemaVersion') < catalog.indexOf('lang:'));
  assert.ok(catalog.indexOf('lang:') < catalog.indexOf('groups:'));
  assert.match(plan.writes['.cc-marketspec/entries/plugin-sample.yaml'], /^# entry comment/m);
});

test('dry planning accepts explicitly claimed catalog-only legacy input', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    'catalog.yaml': '# ours\nschemaVersion: "1.0"\nlang: en\n'
  });
  assert.ok(planMigration(source).errors.some((error) => /--from legacy/i.test(error)));
  const plan = planMigration(source, { from: 'legacy' });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.kind, 'migrate');
});

test('--from legacy does not weaken schema or overwrite checks', () => {
  const malformed = planMigration(new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    'catalog.yaml': 'schemaVersion: "1.0"\nunknown: value\n'
  }), { from: 'legacy' });
  assert.ok(malformed.errors.some((error) => /catalog/i.test(error)));

  const collision = planMigration(new MemoryFileSource({
    ...Object.fromEntries([
      ['.claude-plugin/marketplace.json', JSON.stringify({ name: 'mk', plugins: [] })],
      ['catalog.yaml', 'schemaVersion: "1.0"\n'],
      ['.cc-marketspec/unrelated', 'occupied']
    ])
  }), { from: 'legacy' });
  assert.ok(collision.errors.some((error) => /target|\.cc-marketspec/i.test(error)));
});

test('removes root manifest only when bytes match legacy generation', () => {
  const basePlan = planMigration(legacy());
  const migrated = JSON.parse(basePlan.writes['.cc-marketspec/dist/manifest.json']) as Record<string, unknown>;
  const legacyManifest = JSON.stringify({ ...migrated, schemaVersion: '1.0' }, null, 2) + '\n';
  const matching = planMigration(legacy({ 'manifest.json': legacyManifest }));
  assert.ok(matching.removals.some((removal) => removal.path === 'manifest.json'));

  const unrelated = planMigration(legacy({ 'manifest.json': '{"owner":"another-tool"}\n' }));
  assert.equal(unrelated.removals.some((removal) => removal.path === 'manifest.json'), false);
  assert.ok(unrelated.warnings.some((warning) => /manifest\.json.*left untouched/i.test(warning)));
});

test('plans cleanup-only from a valid receipt and never infers cleanup without one', () => {
  const first = planMigration(legacy());
  const files = {
    '.claude-plugin/marketplace.json': legacy().read('.claude-plugin/marketplace.json') as string,
    'plugins/sample/.claude-plugin/plugin.json': legacy().read('plugins/sample/.claude-plugin/plugin.json') as string,
    'catalog.yaml': legacy().read('catalog.yaml') as string,
    'plugins/sample/entry.yaml': legacy().read('plugins/sample/entry.yaml') as string,
    ...first.writes
  };
  const cleanup = planMigration(new MemoryFileSource(files));
  assert.equal(cleanup.kind, 'cleanup');
  assert.deepEqual(cleanup.writes, {});
  assert.ok(cleanup.removals.some((removal) => removal.path === 'catalog.yaml'));

  const changed = planMigration(new MemoryFileSource({
    ...files,
    'plugins/sample/entry.yaml': 'tagline: changed after cutover\n'
  }));
  assert.ok(changed.errors.some((error) => /digest|changed/i.test(error)));

  const nativeChanged = planMigration(new MemoryFileSource({
    ...files,
    'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({
      name: 'sample',
      version: '2.0.0'
    })
  }));
  assert.ok(nativeChanged.errors.some((error) => /generated bytes changed after cutover/i.test(error)));

  const noReceipt: Record<string, string> = { ...files };
  delete noReceipt['.cc-marketspec/.migration-state.json'];
  const unrelated = planMigration(new MemoryFileSource(noReceipt));
  assert.equal(unrelated.kind, 'noop');
  assert.equal(unrelated.removals.length, 0);

  const invalidCurrent = planMigration(new MemoryFileSource({
    ...noReceipt,
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "9.9"\n'
  }));
  assert.ok(invalidCurrent.errors.some((error) => /catalog|schemaVersion/i.test(error)));
});

test('rejects a forged receipt and never follows receipt traversal paths', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
    '.cc-marketspec/.migration-state.json': JSON.stringify({
      receiptVersion: 1,
      sourceVersion: '1.0',
      targetVersion: '1.1',
      targetDigests: {},
      removals: [{ path: '../outside', digest: 'forged' }]
    })
  });
  const plan = planMigration(source);
  assert.equal(plan.kind, 'noop');
  assert.ok(plan.errors.some((error) => /malformed migration receipt/i.test(error)));
  assert.deepEqual(plan.removals, []);
});

test('rejects a forged receipt that claims an unrelated root-contained file', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    '.cc-marketspec/.gitignore': '/dist/\n',
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
    '.cc-marketspec/dist/manifest.json': '{}\n',
    '.cc-marketspec/.migration-state.json': JSON.stringify({
      receiptVersion: 1,
      sourceVersion: '1.0',
      targetVersion: '1.1',
      targetDigests: {
        '.cc-marketspec/.gitignore': '0'.repeat(64),
        '.cc-marketspec/catalog.yaml': '0'.repeat(64),
        '.cc-marketspec/dist/manifest.json': '0'.repeat(64)
      },
      removals: [{ path: 'README.md', digest: '0'.repeat(64) }]
    }),
    'README.md': 'do not delete\n'
  });
  const plan = planMigration(source);
  assert.equal(plan.kind, 'noop');
  assert.ok(plan.errors.some((error) => /unauthorized cleanup path.*README\.md/i.test(error)));
  assert.deepEqual(plan.removals, []);
});

test('remote sources fail staged validation explicitly and produce no writes', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      plugins: [{ name: 'remote', source: { source: 'github', repo: 'o/r' } }]
    }),
    'catalog.yaml': 'schemaVersion: "1.0"\n'
  });
  const plan = planMigration(source, { from: 'legacy' });
  assert.ok(plan.errors.some((error) => /remote.*cannot inspect|cannot inspect.*remote/i.test(error)));
  assert.deepEqual(plan.writes, {});
  assert.deepEqual(plan.removals, []);
});

test('root plugin legacy entry maps into the prefixed namespaced entry path', () => {
  const source = new MemoryFileSource({
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      plugins: [{ name: 'root', source: './' }]
    }),
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'root', version: '1.0.0' }),
    'catalog.yaml': 'schemaVersion: "1.0"\n',
    'entry.yaml': 'tagline: Root plugin\n'
  });
  const plan = planMigration(source);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.writes['.cc-marketspec/entries/plugin-root.yaml'], 'tagline: Root plugin\n');
  assert.ok(plan.removals.some((item) => item.path === 'entry.yaml'));
});
```

- [ ] **Step 3: Run pure migration tests and verify the module is missing**

Run: `node --test test/migration.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/migration.ts`.

- [ ] **Step 4: Define migration plan types and loss-minimizing YAML rewrite**

```ts
// src/migration.ts (types and pure helpers)
import { createHash } from 'node:crypto';
import { isScalar, parseDocument } from 'yaml';
import { Catalog } from './catalog.ts';
import { Entry } from './entry.ts';
import { OverlayFileSource, type FileSource } from './fs-source.ts';
import { generateManifest } from './generate.ts';
import {
  CATALOG_PATH,
  DIST_MANIFEST_PATH,
  LEGACY_CATALOG_PATH,
  LEGACY_MANIFEST_PATH,
  SPEC_DIR,
  SPEC_GITIGNORE_PATH,
  inspectLayout,
  inspectLegacyCandidates,
  resolveMarketplacePlugins,
  type LegacyInspection,
  type ResolvedPlugin
} from './layout.ts';
import { loadYaml, readJSON } from './native.ts';
import { normalizeInternalPath } from './path-policy.ts';
import { CURRENT_FORMAT_VERSION, LEGACY_FORMAT_VERSION } from './version.ts';

export interface PlannedRemoval {
  path: string;
  digest: string;
}
export interface MigrationOptions {
  from?: 'legacy';
}
export interface MigrationPlan {
  kind: 'migrate' | 'cleanup' | 'noop';
  sourceVersion: '1.0' | '1.1' | null;
  targetVersion: '1.1';
  writes: Record<string, string>;
  removals: PlannedRemoval[];
  warnings: string[];
  errors: string[];
}
interface MigrationReceipt {
  receiptVersion: 1;
  sourceVersion: '1.0';
  targetVersion: '1.1';
  targetDigests: Record<string, string>;
  removals: PlannedRemoval[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const removal = (path: string, body: string): PlannedRemoval => ({ path, digest: digest(body) });
export const MIGRATION_RECEIPT_PATH = '.cc-marketspec/.migration-state.json';

function rewriteCatalogVersion(raw: string): { content?: string; error?: string } {
  const document = parseDocument(raw, { keepSourceTokens: true });
  if (document.errors.length > 0) {
    return { error: `catalog.yaml: ${document.errors.map((error) => error.message).join('; ')}` };
  }
  const versionNode = document.get('schemaVersion', true);
  if (!isScalar(versionNode) || typeof versionNode.value !== 'string') {
    return { error: 'catalog.yaml: schemaVersion must be a scalar string' };
  }
  versionNode.value = CURRENT_FORMAT_VERSION;
  return { content: document.toString({ lineWidth: 0 }) };
}

function readMarketplace(source: FileSource): {
  plugins: ResolvedPlugin[];
  errors: string[];
  warnings: string[];
} {
  try {
    const marketplace = readJSON(source, '.claude-plugin/marketplace.json');
    const resolution = resolveMarketplacePlugins(marketplace.plugins);
    return resolution;
  } catch (error) {
    return {
      plugins: [],
      errors: [`cannot read .claude-plugin/marketplace.json: ${error instanceof Error ? error.message : String(error)}`],
      warnings: []
    };
  }
}
```

- [ ] **Step 5: Implement initial migration planning and staged virtual validation**

Add to `src/migration.ts`:

```ts
interface BuiltTarget {
  writes: Record<string, string>;
  removals: PlannedRemoval[];
  warnings: string[];
  errors: string[];
}

function buildTarget(
  source: FileSource,
  plugins: ResolvedPlugin[],
  legacy: LegacyInspection
): BuiltTarget {
  const errors = [...legacy.errors];
  const warnings: string[] = [];
  const catalogRaw = legacy.catalogRaw;
  const parsedCatalog = Catalog.safeParse(legacy.catalog);
  if (!parsedCatalog.success || parsedCatalog.data.schemaVersion !== LEGACY_FORMAT_VERSION || catalogRaw === null) {
    errors.push('catalog.yaml must be a valid schemaVersion 1.0 catalog before migration');
  }
  const rewritten = catalogRaw === null ? {} : rewriteCatalogVersion(catalogRaw);
  if (rewritten.error) errors.push(rewritten.error);
  if (errors.length > 0 || rewritten.content === undefined || catalogRaw === null) {
    return { writes: {}, removals: [], warnings, errors: [...new Set(errors)].sort(compare) };
  }

  const writes: Record<string, string> = {
    [SPEC_GITIGNORE_PATH]: '/dist/\n',
    [CATALOG_PATH]: rewritten.content
  };
  for (const plugin of plugins) {
    const found = legacy.entries.get(plugin.id);
    if (found) writes[plugin.namespacedEntryPath] = found.raw;
  }

  const virtual = new OverlayFileSource(source, writes);
  const generated = generateManifest(virtual);
  errors.push(...generated.errors);
  warnings.push(...generated.warnings.filter((warning) => !/legacy files remain/.test(warning)));
  if (errors.length === 0) {
    writes[DIST_MANIFEST_PATH] = JSON.stringify(generated.manifest, null, 2) + '\n';
  }

  const removals: PlannedRemoval[] = [removal(LEGACY_CATALOG_PATH, catalogRaw)];
  for (const { path, raw } of legacy.entries.values()) removals.push(removal(path, raw));
  const rootManifest = source.read(LEGACY_MANIFEST_PATH);
  if (rootManifest !== null && writes[DIST_MANIFEST_PATH]) {
    const current = JSON.parse(writes[DIST_MANIFEST_PATH]) as Record<string, unknown>;
    const expectedLegacy = JSON.stringify({ ...current, schemaVersion: LEGACY_FORMAT_VERSION }, null, 2) + '\n';
    if (rootManifest === expectedLegacy) removals.push(removal(LEGACY_MANIFEST_PATH, rootManifest));
    else warnings.push('manifest.json is not byte-identical to cc-marketspec legacy output; left untouched');
  }

  const sortedRemovals = removals.sort((left, right) => compare(left.path, right.path));
  const receipt: MigrationReceipt = {
    receiptVersion: 1,
    sourceVersion: LEGACY_FORMAT_VERSION,
    targetVersion: CURRENT_FORMAT_VERSION,
    targetDigests: Object.fromEntries(
      Object.entries(writes)
        .sort(([left], [right]) => compare(left, right))
        .map(([path, content]) => [path, digest(content)])
    ),
    removals: sortedRemovals
  };
  writes[MIGRATION_RECEIPT_PATH] = JSON.stringify(receipt, null, 2) + '\n';
  return {
    writes: errors.length === 0 ? writes : {},
    removals: errors.length === 0 ? sortedRemovals : [],
    warnings: [...new Set(warnings)].sort(compare),
    errors: [...new Set(errors)].sort(compare)
  };
}

function initialPlan(
  source: FileSource,
  plugins: ResolvedPlugin[],
  legacy: LegacyInspection
): MigrationPlan {
  if (source.exists(SPEC_DIR)) {
    return {
      kind: 'noop',
      sourceVersion: LEGACY_FORMAT_VERSION,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: [],
      errors: [`${SPEC_DIR}: migration target already exists`]
    };
  }
  const built = buildTarget(source, plugins, legacy);
  return {
    kind: built.errors.length === 0 ? 'migrate' : 'noop',
    sourceVersion: LEGACY_FORMAT_VERSION,
    targetVersion: CURRENT_FORMAT_VERSION,
    writes: built.writes,
    removals: built.removals,
    warnings: built.warnings,
    errors: built.errors
  };
}
```

- [ ] **Step 6: Implement explicit claiming, cleanup recovery, and no-op behavior**

Add to `src/migration.ts`:

```ts
function parseReceipt(raw: string): { receipt?: MigrationReceipt; error?: string } {
  try {
    const value = JSON.parse(raw) as Partial<MigrationReceipt>;
    const isDigest = (candidate: unknown): candidate is string =>
      typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate);
    const safePath = (path: string, insideSpec: boolean): boolean => {
      try {
        const normalized = normalizeInternalPath(path);
        return normalized === path && (insideSpec ? path.startsWith(SPEC_DIR + '/') : !path.startsWith(SPEC_DIR + '/'));
      } catch {
        return false;
      }
    };
    const validTargets = value.targetDigests
      && typeof value.targetDigests === 'object'
      && !Array.isArray(value.targetDigests)
      && Object.entries(value.targetDigests).every(([path, hash]) =>
        safePath(path, true) && path !== MIGRATION_RECEIPT_PATH && isDigest(hash)
      )
      && [SPEC_GITIGNORE_PATH, CATALOG_PATH, DIST_MANIFEST_PATH]
        .every((path) => isDigest(value.targetDigests?.[path]));
    const validRemovals = Array.isArray(value.removals)
      && value.removals.every((item) =>
        item
        && typeof item.path === 'string'
        && safePath(item.path, false)
        && isDigest(item.digest)
      )
      && new Set(value.removals.map((item) => item.path)).size === value.removals.length;
    if (value.receiptVersion !== 1
      || value.sourceVersion !== LEGACY_FORMAT_VERSION
      || value.targetVersion !== CURRENT_FORMAT_VERSION
      || !validTargets
      || !validRemovals) {
      return { error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt` };
    }
    return { receipt: value as MigrationReceipt };
  } catch (error) {
    return {
      error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function cleanupPlan(
  source: FileSource,
  rawReceipt: string,
  plugins: ResolvedPlugin[]
): MigrationPlan {
  const parsed = parseReceipt(rawReceipt);
  const errors: string[] = parsed.error ? [parsed.error] : [];
  const receipt = parsed.receipt;
  if (receipt) {
    const legacyEntryPaths = new Set(
      plugins.flatMap((plugin) => plugin.legacyEntryPath === null ? [] : [plugin.legacyEntryPath])
    );
    const allowedRemovals = new Set([
      LEGACY_CATALOG_PATH,
      LEGACY_MANIFEST_PATH,
      ...legacyEntryPaths
    ]);
    const removalPaths = new Set(receipt.removals.map((item) => item.path));
    if (!removalPaths.has(LEGACY_CATALOG_PATH)) {
      errors.push(`${MIGRATION_RECEIPT_PATH}: receipt lacks legacy catalog provenance`);
    }
    for (const planned of receipt.removals) {
      if (!allowedRemovals.has(planned.path)) {
        errors.push(`${MIGRATION_RECEIPT_PATH}: unauthorized cleanup path ${planned.path}`);
      }
    }
    for (const [path, expected] of Object.entries(receipt.targetDigests)) {
      const body = source.read(path);
      if (body === null || digest(body) !== expected) {
        errors.push(`${path}: target digest does not match migration receipt`);
      }
    }
    for (const planned of receipt.removals) {
      const body = source.read(planned.path);
      if (body !== null && digest(body) !== planned.digest) {
        errors.push(`${planned.path}: source changed after cutover; left untouched`);
        continue;
      }
      if (body !== null && planned.path === LEGACY_CATALOG_PATH) {
        const parsedCatalog = Catalog.safeParse(loadYaml(source, planned.path));
        if (!parsedCatalog.success || parsedCatalog.data.schemaVersion !== LEGACY_FORMAT_VERSION) {
          errors.push(`${planned.path}: remaining source is not a legacy cc-marketspec catalog`);
        }
      }
      if (body !== null && legacyEntryPaths.has(planned.path)
        && !Entry.safeParse(loadYaml(source, planned.path)).success) {
        errors.push(`${planned.path}: remaining source is not a cc-marketspec entry`);
      }
      if (body !== null && planned.path === LEGACY_MANIFEST_PATH) {
        const current = source.read(DIST_MANIFEST_PATH);
        try {
          const namespaced = JSON.parse(current ?? '') as Record<string, unknown>;
          const expectedLegacy = JSON.stringify(
            { ...namespaced, schemaVersion: LEGACY_FORMAT_VERSION },
            null,
            2
          ) + '\n';
          if (body !== expectedLegacy) {
            errors.push(`${planned.path}: no longer matches derived legacy output; left untouched`);
          }
        } catch {
          errors.push(`${planned.path}: cannot prove legacy manifest ownership; left untouched`);
        }
      }
    }
  }
  const validation = generateManifest(source);
  errors.push(...validation.errors);
  if (validation.errors.length === 0) {
    const onDiskManifest = source.read(DIST_MANIFEST_PATH);
    const regeneratedManifest = JSON.stringify(validation.manifest, null, 2) + '\n';
    if (onDiskManifest !== regeneratedManifest) {
      errors.push(`${DIST_MANIFEST_PATH}: generated bytes changed after cutover; cleanup is unsafe`);
    }
  }
  return {
    kind: errors.length === 0 ? 'cleanup' : 'noop',
    sourceVersion: CURRENT_FORMAT_VERSION,
    targetVersion: CURRENT_FORMAT_VERSION,
    writes: {},
    removals: errors.length === 0 && receipt ? receipt.removals : [],
    warnings: errors.length === 0 ? ['resuming cleanup from migration receipt'] : [],
    errors: errors.sort(compare)
  };
}

function planMigrationUnchecked(source: FileSource, options: MigrationOptions): MigrationPlan {
  const marketplace = readMarketplace(source);
  if (marketplace.errors.length > 0) {
    return {
      kind: 'noop',
      sourceVersion: null,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: marketplace.warnings,
      errors: marketplace.errors
    };
  }
  const layout = inspectLayout(source, marketplace.plugins);
  if (layout.kind === 'namespaced') {
    const rawReceipt = source.read(MIGRATION_RECEIPT_PATH);
    if (rawReceipt !== null) return cleanupPlan(source, rawReceipt, marketplace.plugins);
    const validation = generateManifest(source);
    return {
      kind: 'noop',
      sourceVersion: CURRENT_FORMAT_VERSION,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: [...new Set([
        ...validation.warnings,
        ...(layout.legacy.hasCandidates
          ? ['generic legacy-named files exist without a migration receipt; left untouched']
          : [])
      ])].sort(compare),
      errors: [...new Set(validation.errors)].sort(compare)
    };
  }
  if (layout.kind === 'fresh') {
    return {
      kind: 'noop',
      sourceVersion: null,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: ['no legacy cc-marketspec authoring files found'],
      errors: []
    };
  }
  if (layout.kind === 'ambiguous' && options.from !== 'legacy') {
    return {
      kind: 'noop',
      sourceVersion: null,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: [],
      errors: ['ambiguous generic files require cc-marketspec migrate --from legacy']
    };
  }
  const legacy = inspectLegacyCandidates(source, marketplace.plugins);
  return initialPlan(source, marketplace.plugins, legacy);
}

export function planMigration(source: FileSource, options: MigrationOptions = {}): MigrationPlan {
  try {
    return planMigrationUnchecked(source, options);
  } catch (error) {
    return {
      kind: 'noop',
      sourceVersion: null,
      targetVersion: CURRENT_FORMAT_VERSION,
      writes: {},
      removals: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
```

Export `MIGRATION_RECEIPT_PATH`, migration types, and `planMigration` from `src/index.ts`.

- [ ] **Step 7: Run pure migration, generation, and type tests**

Run: `node --test test/migration.test.ts test/generate.test.ts test/layout.test.ts && npm run type-check`

Expected: all tests PASS; source maps are unchanged; unrelated root `manifest.json` is never a removal.

- [ ] **Step 8: Commit pure migration planning**

```bash
git add package.json package-lock.json src/migration.ts src/index.ts test/migration.test.ts
git commit -m "feat: plan safe marketplace migrations"
```

---

### Task 8: Apply migrations transactionally and expose the migrate CLI

**Files:**
- Modify: `src/migration.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `test/migration.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: immutable `MigrationPlan`
- Produces: `MigrationFileOps`, `MigrationResult`, `NODE_MIGRATION_FILE_OPS`
- Produces: `applyMigration(root, plan, fileOps): MigrationResult`
- CLI adds `migrate [root] [--dry-run] [--from legacy]`

- [ ] **Step 1: Add failing apply, recovery, and CLI tests**

Append to `test/migration.test.ts`:

```ts
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  NODE_MIGRATION_FILE_OPS,
  applyMigration,
  type MigrationFileOps
} from '../src/migration.ts';
import { NodeFileSource } from '../src/fs-source.ts';

function materialize(source: MemoryFileSource, paths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ccms-migrate-'));
  for (const path of paths) {
    const body = source.read(path);
    if (body === null) continue;
    const absolute = join(root, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  return root;
}

const LEGACY_PATHS = [
  '.claude-plugin/marketplace.json',
  'plugins/sample/.claude-plugin/plugin.json',
  'catalog.yaml',
  'plugins/sample/entry.yaml',
  'manifest.json'
];

test('apply cuts over a complete tree then removes digest-unchanged legacy files', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  try {
    const plan = planMigration(new NodeFileSource(root));
    const result = applyMigration(root, plan);
    assert.deepEqual(result.errors, []);
    assert.equal(result.changed, true);
    assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/dist/manifest.json')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/.migration-state.json')), false);
    assert.equal(existsSync(join(root, 'catalog.yaml')), false);
    assert.equal(existsSync(join(root, 'plugins/sample/entry.yaml')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pre-cutover rename failure preserves legacy and removes staging remnants', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  const failing: MigrationFileOps = {
    ...NODE_MIGRATION_FILE_OPS,
    rename: () => { throw new Error('injected rename failure'); }
  };
  try {
    const result = applyMigration(root, planMigration(new NodeFileSource(root)), failing);
    assert.ok(result.errors.some((error) => /injected rename failure/.test(error)));
    assert.equal(existsSync(join(root, 'catalog.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec')), false);
    assert.equal(
      NODE_MIGRATION_FILE_OPS.list(root).some((name) => name.startsWith('.cc-marketspec-migrate-')),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('staged read-back validation rejects corrupted writes before cutover', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  const corrupting: MigrationFileOps = {
    ...NODE_MIGRATION_FILE_OPS,
    writeExclusive: (path, content) => NODE_MIGRATION_FILE_OPS.writeExclusive(
      path,
      path.endsWith('catalog.yaml') ? content.replace('schemaVersion: "1.1"', 'schemaVersion: "9.9"') : content
    )
  };
  try {
    const result = applyMigration(root, planMigration(new NodeFileSource(root)), corrupting);
    assert.ok(result.errors.some((error) => /staged validation|manifest bytes/i.test(error)));
    assert.equal(existsSync(join(root, 'catalog.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply rejects a caller-crafted target traversal before any cutover', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  try {
    const plan = planMigration(new NodeFileSource(root));
    const forged = {
      ...plan,
      writes: { ...plan.writes, '.cc-marketspec/../outside': 'must not escape\n' }
    };
    const result = applyMigration(root, forged);
    assert.ok(result.errors.some((error) => /unexpected migration target|parent path/i.test(error)));
    assert.equal(existsSync(join(root, 'outside')), false);
    assert.equal(existsSync(join(root, '.cc-marketspec')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup failure leaves authoritative target and rerun resumes safely', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  let failed = false;
  const failing: MigrationFileOps = {
    ...NODE_MIGRATION_FILE_OPS,
    unlink: (path) => {
      if (!failed && path.endsWith('plugins/sample/entry.yaml')) {
        failed = true;
        throw new Error('injected cleanup failure');
      }
      NODE_MIGRATION_FILE_OPS.unlink(path);
    }
  };
  try {
    const first = applyMigration(root, planMigration(new NodeFileSource(root)), failing);
    assert.ok(first.errors.some((error) => /cleanup failure/.test(error)));
    assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), true);
    assert.equal(existsSync(join(root, '.cc-marketspec/.migration-state.json')), true);
    assert.equal(existsSync(join(root, 'plugins/sample/entry.yaml')), true);

    const resumed = planMigration(new NodeFileSource(root));
    assert.equal(resumed.kind, 'cleanup');
    assert.deepEqual(applyMigration(root, resumed).errors, []);
    assert.equal(existsSync(join(root, 'plugins/sample/entry.yaml')), false);
    assert.equal(existsSync(join(root, '.cc-marketspec/.migration-state.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changed cleanup source is reported and not deleted', () => {
  const source = legacy();
  const root = materialize(source, LEGACY_PATHS);
  try {
    const plan = planMigration(new NodeFileSource(root));
    writeFileSync(join(root, 'catalog.yaml'), 'schemaVersion: "1.0"\nlang: changed\n');
    const result = applyMigration(root, plan);
    assert.ok(result.errors.some((error) => /changed since planning/i.test(error)));
    assert.equal(existsSync(join(root, 'catalog.yaml')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration rejects a symlinked target that escapes the repository', () => {
  const parent = mkdtempSync(join(tmpdir(), 'ccms-migrate-link-'));
  const root = join(parent, 'root');
  const outside = join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  const source = legacy();
  for (const path of LEGACY_PATHS) {
    const body = source.read(path);
    if (body === null) continue;
    const absolute = join(root, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  symlinkSync(outside, join(root, '.cc-marketspec'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const plan = planMigration(new NodeFileSource(root));
    assert.ok(plan.errors.some((error) => /escapes marketplace root/i.test(error)));
    assert.deepEqual(plan.writes, {});
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
```

Append to `test/cli.test.ts`:

```ts
test('migrate --dry-run prints a plan and writes nothing', () => {
  const root = makeMarket({
    ...VALID,
    'catalog.yaml': 'schemaVersion: "1.0"\n',
    'plugins/sample/entry.yaml': 'tagline: legacy\n'
  });
  try {
    const before = readFileSync(join(root, 'catalog.yaml'), 'utf8');
    const result = capture(['node', 'cli', 'migrate', '--dry-run', root]);
    assert.equal(result.code, 0);
    assert.match(result.out, /WRITE \.cc-marketspec\/catalog\.yaml/);
    assert.equal(readFileSync(join(root, 'catalog.yaml'), 'utf8'), before);
    assert.equal(existsSync(join(root, '.cc-marketspec')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migrate --from legacy claims catalog-only input explicitly', () => {
  const root = makeMarket({
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
    'catalog.yaml': 'schemaVersion: "1.0"\n'
  });
  try {
    assert.equal(capture(['node', 'cli', 'migrate', root]).code, 1);
    assert.equal(capture(['node', 'cli', 'migrate', '--from', 'legacy', root]).code, 0);
    assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migrate rejects unknown --from values and never offers force', () => {
  const result = capture(['node', 'cli', 'migrate', '--from', 'flat']);
  assert.equal(result.code, 1);
  assert.match(result.out, /--from.*legacy/i);
  assert.doesNotMatch(capture(['node', 'cli', '--help']).out, /--force/);
});

test('migrate on a valid current bundle is a successful no-op', () => {
  const root = makeMarket({
    ...VALID,
    '.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n'
  });
  try {
    const result = capture(['node', 'cli', 'migrate', root]);
    assert.equal(result.code, 0);
    assert.match(result.out, /migration not needed/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run migration and CLI tests and verify apply is missing**

Run: `node --test test/migration.test.ts test/cli.test.ts`

Expected: FAIL because `applyMigration` and migrate dispatch do not exist.

- [ ] **Step 3: Implement the injected filesystem boundary**

Add to `src/migration.ts`:

```ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { resolveWithinRoot } from './path-policy.ts';
```

Extend the existing filesystem-source import at the top of `src/migration.ts`:

```ts
import { NodeFileSource, OverlayFileSource, type FileSource } from './fs-source.ts';
```

Continue the filesystem boundary:

```ts
export interface MigrationFileOps {
  exists(path: string): boolean;
  mkdir(path: string): void;
  mkdtemp(prefix: string): string;
  read(path: string): string;
  writeExclusive(path: string, content: string): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  removeTree(path: string): void;
  list(path: string): string[];
}
export interface MigrationResult {
  changed: boolean;
  errors: string[];
  warnings: string[];
}

export const NODE_MIGRATION_FILE_OPS: MigrationFileOps = {
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  mkdtemp: mkdtempSync,
  read: (path) => readFileSync(path, 'utf8'),
  writeExclusive: (path, content) => writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' }),
  rename: renameSync,
  unlink: unlinkSync,
  removeTree: (path) => rmSync(path, { recursive: true, force: true }),
  list: (path) => readdirSync(path).sort()
};
```

- [ ] **Step 4: Implement staged cutover and digest-checked cleanup**

Add to `src/migration.ts`:

```ts
function applyRemovals(
  root: string,
  removals: PlannedRemoval[],
  fileOps: MigrationFileOps
): { removed: number; errors: string[] } {
  const errors: string[] = [];
  let removed = 0;
  for (const planned of removals) {
    const absolute = resolveWithinRoot(root, planned.path);
    if (!fileOps.exists(absolute)) continue;
    try {
      const current = fileOps.read(absolute);
      if (digest(current) !== planned.digest) {
        errors.push(`${planned.path}: changed since planning; left untouched`);
        continue;
      }
      fileOps.unlink(absolute);
      removed += 1;
    } catch (error) {
      errors.push(`${planned.path}: cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, errors: errors.sort(compare) };
}

function finishCleanup(
  root: string,
  removals: PlannedRemoval[],
  fileOps: MigrationFileOps
): { removed: number; errors: string[] } {
  const result = applyRemovals(root, removals, fileOps);
  if (result.errors.length > 0) return result;
  const receipt = resolveWithinRoot(root, MIGRATION_RECEIPT_PATH);
  try {
    if (fileOps.exists(receipt)) fileOps.unlink(receipt);
  } catch (error) {
    result.errors.push(`${MIGRATION_RECEIPT_PATH}: cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

export function applyMigration(
  root: string,
  plan: MigrationPlan,
  fileOps: MigrationFileOps = NODE_MIGRATION_FILE_OPS
): MigrationResult {
  if (plan.errors.length > 0) return { changed: false, errors: plan.errors, warnings: plan.warnings };
  if (plan.kind === 'noop') return { changed: false, errors: [], warnings: plan.warnings };
  if (plan.kind === 'cleanup') {
    const cleanup = finishCleanup(root, plan.removals, fileOps);
    return { changed: cleanup.removed > 0, errors: cleanup.errors, warnings: plan.warnings };
  }

  const target = resolveWithinRoot(root, SPEC_DIR);
  if (fileOps.exists(target)) {
    return { changed: false, errors: [`${SPEC_DIR}: target appeared after planning; refusing overwrite`], warnings: plan.warnings };
  }
  const stagingPrefix = resolveWithinRoot(root, '.cc-marketspec-migrate-stage');
  const staging = fileOps.mkdtemp(stagingPrefix + '-');
  let cutOver = false;
  try {
    for (const [targetPath, content] of Object.entries(plan.writes).sort(([a], [b]) => compare(a, b))) {
      const prefix = SPEC_DIR + '/';
      const normalized = normalizeInternalPath(targetPath);
      if (normalized !== targetPath || !targetPath.startsWith(prefix)) {
        throw new Error(`unexpected migration target ${targetPath}`);
      }
      const stagedRelative = targetPath.slice(prefix.length);
      const stagedAbsolute = resolveWithinRoot(staging, stagedRelative);
      fileOps.mkdir(dirname(stagedAbsolute));
      fileOps.writeExclusive(stagedAbsolute, content);
    }
    const stagedWrites: Record<string, string> = {};
    for (const targetPath of Object.keys(plan.writes).sort(compare)) {
      const stagedRelative = targetPath.slice((SPEC_DIR + '/').length);
      const stagedAbsolute = resolveWithinRoot(staging, stagedRelative);
      stagedWrites[targetPath] = fileOps.read(stagedAbsolute);
      if (stagedWrites[targetPath] !== plan.writes[targetPath]) {
        throw new Error(`${targetPath}: staged bytes differ from the migration plan`);
      }
    }
    const stagedSource = new OverlayFileSource(new NodeFileSource(root), stagedWrites);
    const validation = generateManifest(stagedSource);
    if (validation.errors.length > 0) {
      throw new Error(`staged validation failed: ${validation.errors.join('; ')}`);
    }
    const validatedManifest = JSON.stringify(validation.manifest, null, 2) + '\n';
    if (validatedManifest !== stagedWrites[DIST_MANIFEST_PATH]) {
      throw new Error('staged validation manifest bytes differ from the migration plan');
    }
    fileOps.rename(staging, target);
    cutOver = true;
  } catch (error) {
    if (!cutOver && fileOps.exists(staging)) fileOps.removeTree(staging);
    return {
      changed: false,
      errors: [`migration cutover failed: ${error instanceof Error ? error.message : String(error)}`],
      warnings: plan.warnings
    };
  }
  const cleanup = finishCleanup(root, plan.removals, fileOps);
  return { changed: true, errors: cleanup.errors, warnings: plan.warnings };
}
```

The staging prefix is a tool-owned explicit child of the resolved repository root. The random suffix comes from `mkdtempSync`; only that returned directory may be recursively removed.

- [ ] **Step 5: Add migrate parsing and dispatch**

Update CLI usage with:

```text
cc-marketspec migrate [root] [--dry-run] [--from legacy]
```

Add this dispatch before default generation:

```ts
if (args[0] === 'migrate') {
  const migrateArgs = args.slice(1);
  const optionError = validateOptions(migrateArgs, new Set(['--dry-run']), new Set(['--from']));
  if (optionError) {
    console.error('ERROR ' + optionError);
    return 1;
  }
  const from = optionValue(migrateArgs, '--from');
  if (from.error || (from.value !== undefined && from.value !== 'legacy')) {
    console.error('ERROR --from accepts only "legacy"');
    return 1;
  }
  const root = resolve(positionalRoot(migrateArgs, new Set(['--from'])) ?? process.cwd());
  const dryRun = migrateArgs.includes('--dry-run');
  const plan = planMigration(new NodeFileSource(root), {
    from: from.value === 'legacy' ? 'legacy' : undefined
  });
  for (const warning of plan.warnings) console.warn('WARN ' + warning);
  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error('ERROR ' + error);
    return 1;
  }
  if (plan.kind === 'noop') {
    console.log('cc-marketspec: migration not needed');
    return 0;
  }
  if (dryRun) {
    for (const path of Object.keys(plan.writes).sort()) console.log('WRITE ' + path);
    for (const item of plan.removals) console.log('REMOVE ' + item.path);
    console.log('cc-marketspec: dry-run complete; nothing written');
    return 0;
  }
  const result = applyMigration(root, plan);
  for (const warning of result.warnings) console.warn('WARN ' + warning);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error('ERROR ' + error);
    return 1;
  }
  console.log(`cc-marketspec: ${plan.kind === 'cleanup' ? 'cleanup resumed' : 'migration complete'}`);
  return 0;
}
```

Call `validateOptions(args, new Set(['--check', '--strict-coverage']), new Set(['--output']))`
for generation and `validateOptions(initArgs, new Set(), new Set())` for init.
This makes `--dry-run` valid only for migrate. Export
`applyMigration`, `NODE_MIGRATION_FILE_OPS`, `MigrationFileOps`, and
`MigrationResult` from `src/index.ts`.

- [ ] **Step 6: Run failure-injection, CLI, and no-git tests**

Add this source-boundary assertion to `test/migration.test.ts`:

```ts
test('migration implementation has no process execution dependency', () => {
  const body = readFileSync(new URL('../src/migration.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(body, /node:child_process|execFile|spawn\(/);
});
```

Run: `node --test test/migration.test.ts test/cli.test.ts && npm run type-check`

Expected: all tests PASS; failure injection leaves either the complete legacy tree or the complete authoritative namespaced tree.

- [ ] **Step 7: Commit transactional migration**

```bash
git add src/migration.ts src/cli.ts src/index.ts test/migration.test.ts test/cli.test.ts
git commit -m "feat: add transactional migration command"
```

---

### Task 9: Update MCP and the bundled marketplace workflow

**Files:**
- Modify: `src/mcp.ts`
- Modify: `test/mcp.test.ts`
- Modify: `src/authoring.md`
- Modify: `test/marketplace-flow-skill.test.ts`
- Modify: `plugins/cc-marketspec/README.md`
- Modify: `plugins/cc-marketspec/commands/cc-generate.md`
- Modify: `plugins/cc-marketspec/commands/cc-init.md`
- Modify: `plugins/cc-marketspec/commands/cc-check.md`
- Create: `plugins/cc-marketspec/commands/cc-migrate.md`
- Modify: `plugins/cc-marketspec/skills/marketplace-flow/SKILL.md`
- Modify: `plugins/cc-marketspec/skills/marketplace-flow/assets/github-manifest.yml`
- Modify: `plugins/cc-marketspec/skills/marketplace-flow/assets/gitlab-manifest.yml`
- Regenerate: `src/authoring.generated.ts`
- Regenerate: `plugins/cc-marketspec/skills/marketplace-flow/references/entry-authoring.md`

**Interfaces:**
- Consumes: `entryPathForPlugin(id)`
- Preserves: five hosted MCP tools and their transport contracts
- Changes: MCP pasted-file examples and diagnostics use namespaced entry paths
- Changes: marketplace-flow defaults to validate/build with temporary job artifacts; it never recommends committing generated output to main

- [ ] **Step 1: Write failing MCP and plugin-contract tests**

Append to `test/mcp.test.ts`:

```ts
test('checkCoverage reads the canonical namespaced entry path', () => {
  const report = checkCoverage({
    pluginId: 'p',
    files: {
      'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
      'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n',
      '.cc-marketspec/entries/plugin-p.yaml': 'skills:\n  - name: greet\n    trigger: when greeting\n'
    }
  });
  assert.equal(report.findings.some((finding) => finding.ruleId === 'skill.trigger'), false);
});

test('scaffoldEntry labels the canonical destination', () => {
  const body = scaffoldEntry({
    pluginId: 'con',
    files: { 'plugins/con/.claude-plugin/plugin.json': JSON.stringify({ name: 'con' }) }
  });
  assert.match(body, /^# \.cc-marketspec\/entries\/plugin-con\.yaml/m);
});
```

Append to `test/marketplace-flow-skill.test.ts`:

```ts
test('workflow guidance uses namespaced paths and never commits generated output', () => {
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /\.cc-marketspec\/catalog\.yaml/);
  assert.match(skill, /\.cc-marketspec\/entries\/plugin-<id>\.yaml/);
  assert.match(skill, /\.cc-marketspec\/dist\/manifest\.json/);
  assert.match(skill, /migrate --from legacy/);
  assert.doesNotMatch(skill, /commit (the )?manifest|git path|push.*manifest/i);

  for (const name of ['github-manifest.yml', 'gitlab-manifest.yml']) {
    const body = readFileSync(new URL(`assets/${name}`, `file://${SKILL_DIR}`), 'utf8');
    assert.match(body, /--check/);
    assert.match(body, /\.cc-marketspec\/dist\/manifest\.json/);
    assert.doesNotMatch(body, /git add|git commit|git push|contents:\s*write/);
  }
});

test('plugin exposes a migration command', () => {
  const path = new URL('../plugins/cc-marketspec/commands/cc-migrate.md', import.meta.url);
  assert.equal(existsSync(path), true);
  const body = readFileSync(path, 'utf8');
  assert.match(body, /cc-marketspec@latest migrate/);
  assert.match(body, /--dry-run/);
});
```

- [ ] **Step 2: Run focused tests and verify old guidance fails**

Run: `node --test test/mcp.test.ts test/marketplace-flow-skill.test.ts`

Expected: FAIL because MCP and plugin guidance still use plugin-local/root generic paths and commit-based CI.

- [ ] **Step 3: Make MCP paths canonical without changing tool count**

In `src/mcp.ts`, import `entryPathForPlugin` and replace both plugin-local entry references:

```ts
export function checkCoverage(args: { files: Record<string, string>; pluginId: string }): CoverageReport & { needsMoreWork: boolean } {
  const source = new MemoryFileSource(args.files);
  const facts = extractNativeFacts(source, `plugins/${args.pluginId}`);
  const path = entryPathForPlugin(args.pluginId);
  const entryRaw = args.files[path];
  const entry = entryRaw ? (yaml.load(entryRaw) as never) : null;
  const report = analyzeCoverage(facts, entry, {}, args.pluginId, path);
  return { ...report, needsMoreWork: report.findings.length > 0 };
}

export function scaffoldEntry(args: { files: Record<string, string>; pluginId: string }): string {
  const source = new MemoryFileSource(args.files);
  const facts = extractNativeFacts(source, `plugins/${args.pluginId}`);
  const lines = [`# ${entryPathForPlugin(args.pluginId)} skeleton (generated)`];
  if (!facts.plugin.description) lines.push('# tagline: add a concise card summary');
  for (const skill of facts.skills) lines.push(`# skill ${skill.name}: add trigger/examples`);
  for (const server of facts.mcp) {
    for (const key of server.envKeys) lines.push(`# mcp ${server.name} env ${key}: add a human description`);
  }
  return lines.join('\n') + '\n';
}
```

Update the `TOOLS` descriptions and comments from generic `entry.yaml` to `.cc-marketspec/entries/plugin-<id>.yaml`; keep the same five names and input schemas.

- [ ] **Step 4: Rewrite command instructions and add migration command**

Set `plugins/cc-marketspec/commands/cc-migrate.md` to:

```markdown
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
this explicitly claims those files, and only then apply with
`npx @xbluesky/cc-marketspec@latest migrate --from legacy`.

Never add a force flag and never perform git operations. Report any remaining
legacy path after a cleanup error; a rerun safely resumes cleanup.
```

Use these exact path statements in the existing commands:

```markdown
- Authored catalog: `.cc-marketspec/catalog.yaml`
- Authored plugin entry: `.cc-marketspec/entries/plugin-<id>.yaml`
- Default generated output: `.cc-marketspec/dist/manifest.json`
- `/cc-init` creates authored files only; it does not generate output.
- `/cc-check` validates without writing any file.
- `/cc-generate` writes ignored output by default; `--output` is the explicit consumer-build escape hatch.
```

Remove every instruction to commit generated output. Update the plugin README's command list to include `/cc-migrate`.

- [ ] **Step 5: Rewrite marketplace-flow detection and persistence guidance**

Replace the skill's state detection with:

```markdown
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
```

The CI step must state:

```markdown
Default to source-only git history. Pull requests run `--check`. A same-pipeline
site job consumes `.cc-marketspec/dist/manifest.json` directly or via a
short-lived workflow artifact. If another repository or public client needs the
manifest, publish it with the site to Pages, a CDN, or object storage; a workflow
artifact is not a stable public endpoint.
```

Replace the authoring guide's opening contract with:

```markdown
`.cc-marketspec/entries/plugin-<id>.yaml` is a marketplace-owned presentation
overlay. It is keyed by the native marketplace plugin id and stays outside the
plugin source, so installing the plugin does not distribute marketplace-specific
copy. Native `plugin.json`, commands, skills, agents, MCP, and hooks still
provide fallbacks. Groups referenced by an entry are declared in
`.cc-marketspec/catalog.yaml`.
```

Change the editor example to the same published entry schema URL, and replace
the remaining prose labels `entry.yaml` and `catalog.yaml` with their
canonical full paths. Examples inside YAML remain versionless.

- [ ] **Step 6: Replace bundled CI assets with read-only templates**

Set the GitHub asset's operational core to:

```yaml
name: Marketplace data

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx @xbluesky/cc-marketspec --check

  generate:
    needs: validate
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx @xbluesky/cc-marketspec
      - uses: actions/upload-artifact@v4
        with:
          name: cc-marketspec-manifest
          path: .cc-marketspec/dist/manifest.json
          if-no-files-found: error
```

Set the GitLab asset's operational core to:

```yaml
stages: [validate, build]

validate-marketplace:
  stage: validate
  image: node:22
  script:
    - npx @xbluesky/cc-marketspec --check

generate-marketplace:
  stage: build
  image: node:22
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - npx @xbluesky/cc-marketspec
  artifacts:
    paths:
      - .cc-marketspec/dist/manifest.json
```

Header comments must say artifacts are for same-pipeline transfer/inspection and external consumers require a stable deploy endpoint.

- [ ] **Step 7: Regenerate the authoring single source and run focused tests**

Run: `npm run build:schemas`

Expected: updates `src/authoring.generated.ts` and the plugin reference copy in addition to schema artifacts.

Run: `node --test test/mcp.test.ts test/http.test.ts test/marketplace-flow-skill.test.ts test/authoring-drift.test.ts && npm run type-check`

Expected: all tests PASS and HTTP still lists exactly five MCP tools.

- [ ] **Step 8: Commit MCP and workflow guidance**

```bash
git add src/mcp.ts src/authoring.md src/authoring.generated.ts test/mcp.test.ts test/marketplace-flow-skill.test.ts plugins/cc-marketspec
git commit -m "feat: update marketplace workflow for namespaced data"
```

---

### Task 10: Migrate this repository and the example, then dogfood ignored build output

**Files:**
- Add: `.cc-marketspec/.gitignore`
- Add: `.cc-marketspec/catalog.yaml`
- Add: `.cc-marketspec/entries/plugin-cc-marketspec.yaml`
- Add: `examples/marketplace/.cc-marketspec/.gitignore`
- Add: `examples/marketplace/.cc-marketspec/catalog.yaml`
- Add: `examples/marketplace/.cc-marketspec/entries/plugin-hello-plugin.yaml`
- Create: `test/fixtures/example-manifest.json`
- Remove: root/example legacy YAML and root/example tracked manifests listed in File Structure
- Remove: `.github/workflows/manifest.yml`
- Modify: `test/example.test.ts`
- Modify: `site/package.json`
- Modify: `site/src/components/Hero.astro`
- Modify: `site/src/components/MentalModel.astro`
- Modify: `site/src/components/Pipeline.astro`
- Modify: `site/src/components/Showcase.astro`
- Modify: `site/astro.config.mjs`
- Modify: `site/test/build.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/site.yml`

**Interfaces:**
- Consumes: completed CLI generation and migration
- Produces: the repository itself as a namespaced 1.1 integration fixture
- Produces: expected example JSON as a named test fixture, never as canonical generated output
- Produces: Linux/Windows CI coverage for path, layout, CLI, and migration

- [ ] **Step 1: Change integration tests to require the new dogfood contract**

Replace `test/example.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generate.ts';
import { NodeFileSource } from '../src/fs-source.ts';

const root = fileURLToPath(new URL('../examples/marketplace', import.meta.url));

test('the namespaced example reproduces its named fixture', () => {
  const { manifest, errors, warnings, layout } = generateManifest(new NodeFileSource(root));
  assert.equal(layout, 'namespaced');
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const expected = JSON.parse(readFileSync(new URL('./fixtures/example-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, expected);
});
```

In `site/test/build.test.ts`, replace the root manifest test with:

```ts
test('build regenerates ignored namespaced manifest output', () => {
  const path = `${repoRoot}/.cc-marketspec/dist/manifest.json`;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(manifest.schemaVersion, '1.1');
  assert.equal(manifest.marketplace.name, 'cc-marketspec');
  assert.ok(Array.isArray(manifest.plugins) && manifest.plugins.length >= 1);
});
```

Add assertions that root `manifest.json`, root `catalog.yaml`, and `plugins/cc-marketspec/entry.yaml` do not exist after the site build.

- [ ] **Step 2: Run integration tests and verify legacy dogfood fails**

Run: `node --test test/example.test.ts site/test/build.test.ts`

Expected: FAIL because authored data and site imports still use legacy paths.

- [ ] **Step 3: Build the new CLI and dry-run both migrations**

Run:

```bash
npm run build
node dist/cli.js .
node dist/cli.js examples/marketplace
node dist/cli.js migrate --dry-run .
node dist/cli.js migrate --dry-run examples/marketplace
```

Expected: legacy generation first refreshes each known tool-owned root manifest.
Each dry-run then reports canonical catalog/entry/dist writes plus the exact
legacy YAML and root manifest removals, with no unrelated removal.

- [ ] **Step 4: Preserve the example fixture, apply migrations, and verify layouts**

Run:

```bash
node dist/cli.js migrate .
node dist/cli.js migrate examples/marketplace
mkdir -p test/fixtures
cp examples/marketplace/.cc-marketspec/dist/manifest.json test/fixtures/example-manifest.json
node dist/cli.js --check .
node dist/cli.js --check examples/marketplace
cmp examples/marketplace/.cc-marketspec/dist/manifest.json test/fixtures/example-manifest.json
```

Expected: both checks report namespaced 1.1 with no errors. The named fixture is
an exact copy of current deterministic output, while both canonical `dist/`
files remain ignored.

- [ ] **Step 5: Point site build and presentation copy at canonical output**

Keep `site/package.json`'s build-time generation, but make the generated path explicit in the script name:

```json
"scripts": {
  "fonts:inline": "node scripts/gen-fonts.mjs",
  "generate:manifest": "npm run build --prefix .. && node ../dist/cli.js ..",
  "generate": "npm run fonts:inline && npm run generate:manifest",
  "dev": "npm run generate && astro dev",
  "build": "npm run generate && astro build",
  "preview": "astro preview"
}
```

Change `Showcase.astro` to:

```ts
import manifest from '../../../.cc-marketspec/dist/manifest.json';
```

Use these exact visible labels throughout Hero, MentalModel, Pipeline, Showcase, and astro config comments:

```text
.cc-marketspec/catalog.yaml
.cc-marketspec/entries/plugin-<id>.yaml
.cc-marketspec/dist/manifest.json
schemaVersion: "1.1"
cc-marketspec: wrote .cc-marketspec/dist/manifest.json — 1 plugins, 0 warning(s).
Generated during build; not committed.
```

Update the Hero's mirrored-source comment to `.cc-marketspec/entries/plugin-cc-marketspec.yaml`. Update the Pipeline's final description from “Commit or emit in CI” to “Consume in the build or publish with the site.”

- [ ] **Step 6: Remove manifest auto-commit and add cross-platform core CI**

Delete `.github/workflows/manifest.yml`. Add this job to `.github/workflows/ci.yml`:

```yaml
  portable-core:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci --registry=https://registry.npmjs.org
      - name: Portable layout, path, CLI, and migration tests
        run: node --test test/version.test.ts test/path-policy.test.ts test/layout.test.ts test/output.test.ts test/cli.test.ts test/migration.test.ts
```

Keep `.github/workflows/site.yml` read-only and update comments to say the site build creates ignored output before Astro compilation. Do not add write permissions or workflow artifact publishing to this repository's same-job site build.

- [ ] **Step 7: Regenerate ignored output and run integration tests**

Run:

```bash
node dist/cli.js .
node dist/cli.js examples/marketplace
node --test test/example.test.ts
npm test --prefix site
```

Expected: the example fixture matches, site build reads `.cc-marketspec/dist/manifest.json`, and no root manifest reappears.

- [ ] **Step 8: Stage only authored data and code, then commit dogfood migration**

```bash
git add .cc-marketspec/.gitignore .cc-marketspec/catalog.yaml .cc-marketspec/entries
git add examples/marketplace/.cc-marketspec/.gitignore examples/marketplace/.cc-marketspec/catalog.yaml examples/marketplace/.cc-marketspec/entries
git add test/fixtures test/example.test.ts site .github/workflows
git add -u catalog.yaml manifest.json plugins/cc-marketspec/entry.yaml examples/marketplace
git commit -m "feat: migrate repository data to namespaced layout"
```

Before committing, run `git status --short --ignored=matching .cc-marketspec examples/marketplace/.cc-marketspec` and verify both `dist/` directories are ignored and unstaged.

---

### Task 11: Update the public contract, regenerate schemas, and run the release gate

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/catalog.ts`
- Modify: `src/manifest.ts`
- Modify: `src/build.ts`
- Modify: `test/schemas.test.ts`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.md`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.md`
- Regenerate: `schemas/catalog.schema.json`
- Regenerate: `schemas/entry.schema.json`
- Regenerate: `schemas/manifest.schema.json`
- Regenerate: `src/schemas.generated.ts`

**Interfaces:**
- Consumes: the implemented 1.1 layout and compatibility behavior
- Produces: public docs that distinguish package SemVer from format `MAJOR.MINOR`
- Produces: generated schemas and inlined Worker schemas with no drift

- [ ] **Step 1: Change schema tests to express syntax versus compatibility**

In `test/schemas.test.ts`, use `1.1` for namespaced/current positive fixtures and add:

```ts
test('catalog schema validates MAJOR.MINOR shape while runtime owns compatibility', () => {
  ok(Catalog, { schemaVersion: '1.1' }, 'current syntax');
  ok(Catalog, { schemaVersion: '99.99' }, 'shape only; version.ts rejects unsupported compatibility');
  bad(Catalog, { schemaVersion: '1.1.0' }, 'format versions are not SemVer');
});

test('manifest current fixture carries format 1.1', () => {
  ok(Manifest, {
    schemaVersion: '1.1',
    marketplace: { name: 'mk' },
    plugins: []
  }, 'current manifest');
});
```

Remove duplicate old `1.0` positive tests that imply it is current; retain legacy behavior in `test/version.test.ts` and `test/generate.test.ts`.

- [ ] **Step 2: Run schema tests and verify descriptions/fixtures are stale**

Run: `node --test test/schemas.test.ts test/version.test.ts`

Expected: schema shape tests pass after fixture edits, while the subsequent drift check will show generated descriptions still need rebuilding.

- [ ] **Step 3: Rewrite the public README around the namespaced bundle**

The README's canonical layout section must show:

```text
.claude-plugin/marketplace.json
.cc-marketspec/
├── .gitignore              # /dist/
├── catalog.yaml            # authored, schemaVersion: "1.1"
├── entries/
│   └── plugin-<id>.yaml    # authored marketplace presentation
└── dist/
    └── manifest.json       # generated, ignored
```

Document these commands and behaviors:

```bash
npx @xbluesky/cc-marketspec init
npx @xbluesky/cc-marketspec --check
npx @xbluesky/cc-marketspec
npx @xbluesky/cc-marketspec --output site/public/manifest.json
npx @xbluesky/cc-marketspec migrate --dry-run
npx @xbluesky/cc-marketspec migrate
npx @xbluesky/cc-marketspec migrate --from legacy
```

State explicitly:

- Author `.cc-marketspec/catalog.yaml` and `.cc-marketspec/entries/plugin-<id>.yaml`.
- Do not hand-edit or commit default `.cc-marketspec/dist/manifest.json`.
- Same-repository sites generate before build; external consumers use a stable Pages/CDN/object-storage endpoint.
- Workflow artifacts are temporary job-transfer objects, not public APIs.
- Format `1.0` is legacy flat, format `1.1` is namespaced current, and npm package versions use independent SemVer.
- Unsupported major, future minor, and layout/version mismatch are hard errors.
- Catalog-only generic legacy input requires explicit `migrate --from legacy`.
- Migration preserves YAML comments/quoting/key order, never overwrites a target, never invokes git, and safely resumes cleanup.
- Remote source objects are recognized but not fetched.

Update the editor schema example so only its filesystem location changes; entry document fields remain versionless.

- [ ] **Step 4: Update package/schema wording and issue templates**

Set `package.json` description to:

```json
"description": "Headless data standard and deterministic generator for Claude Code marketplace presentation bundles."
```

Change catalog and manifest `schemaVersion` descriptions to:

```ts
.describe('MAJOR.MINOR format compatibility version. This is not package SemVer; runtime compatibility is enforced by version.ts.')
```

Update comments in `src/catalog.ts`, `src/manifest.ts`, and `src/build.ts` to name canonical paths. Update issue templates to request `.cc-marketspec/catalog.yaml`, the relevant `.cc-marketspec/entries/plugin-<id>.yaml`, and the command output; do not ask users to paste generated output unless the issue concerns generation bytes.

- [ ] **Step 5: Regenerate schemas and verify zero drift**

Run: `npm run build:schemas`

Expected: committed JSON schemas, `src/schemas.generated.ts`, `src/authoring.generated.ts`, and the plugin authoring reference all match their sources.

Run:

```bash
git diff --exit-code -- schemas/ src/schemas.generated.ts src/authoring.generated.ts plugins/cc-marketspec/skills/marketplace-flow/references/entry-authoring.md
```

Expected: exit 0 after generated outputs are staged or, before staging, the only differences are the intentional regenerated artifacts.

- [ ] **Step 6: Scan for accidental active legacy guidance**

Run:

```bash
rg -n -uu -g '!node_modules/**' -g '!site/node_modules/**' -g '!.git/**' -g '!CHANGELOG.md' -g '!docs/superpowers/**' -g '!.superpowers/**' '(^|[^.])catalog\.yaml|plugins/<id>/entry\.yaml|writes? (\./)?manifest\.json|git (add|commit|push).*manifest|schemaVersion: "1\.0"' README.md package.json src test examples plugins site .github
```

Expected: matches exist only in explicit legacy migration tests/guidance or prose explaining the old layout. Fix every active authoring, generation, site, command, skill, asset, or CI match.

- [ ] **Step 7: Run the complete verification gate**

Run each command separately and stop on the first failure:

```bash
npm run build:schemas
npm run type-check
npm run lint
npm test
npm run build
npm test --prefix site
node dist/cli.js --check .
node dist/cli.js --check examples/marketplace
node dist/cli.js .
git diff --exit-code -- schemas/ src/schemas.generated.ts src/authoring.generated.ts plugins/cc-marketspec/skills/marketplace-flow/references/entry-authoring.md
git diff --check
```

Expected: every command exits 0. Generation changes only ignored `.cc-marketspec/dist/manifest.json`; `git status --short` contains no generated manifest.

- [ ] **Step 8: Commit public docs and generated contracts**

```bash
git add README.md package.json package-lock.json src/catalog.ts src/manifest.ts src/build.ts
git add schemas src/schemas.generated.ts src/authoring.generated.ts
git add test/schemas.test.ts .github/ISSUE_TEMPLATE plugins/cc-marketspec/skills/marketplace-flow/references/entry-authoring.md
git commit -m "docs: publish namespaced format 1.1 contract"
```

- [ ] **Step 9: Verify the final branch**

Run:

```bash
git status --short
git log --oneline --decorate -12
```

Expected: clean worktree and one focused commit for each completed task.

---

## Implementation Notes

- The YAML migration must use the `yaml` v2 Document API because `parseDocument()` retains comments and node metadata; check `document.errors` before editing the scalar node. Reference: https://eemeli.org/yaml/
- Tests that create a Windows link use a junction to avoid administrator-only symlink requirements.
- A root `manifest.json` is never layout evidence and is deleted only after an exact byte comparison against legacy generated output.
- Historical references in `CHANGELOG.md` remain unchanged.
