import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryFileSource, NodeFileSource } from '../src/fs-source.ts';
import {
	CATALOG_PATH,
	DIST_MANIFEST_PATH,
	entryPathForLayout,
	entryPathForPlugin,
	inspectLayout,
	resolveMarketplacePlugins
} from '../src/layout.ts';

const marketplace = (...plugins: Record<string, unknown>[]) => resolveMarketplacePlugins(plugins);

test('maps ids to prefixed portable entry filenames', () => {
	assert.equal(CATALOG_PATH, '.cc-marketspec/catalog.yaml');
	assert.equal(DIST_MANIFEST_PATH, '.cc-marketspec/dist/manifest.json');
	assert.equal(entryPathForPlugin('con'), '.cc-marketspec/entries/plugin-con.yaml');
	assert.equal(entryPathForPlugin('nul'), '.cc-marketspec/entries/plugin-nul.yaml');
});

test('maps plugin entry paths for namespaced, legacy, and fresh layouts', () => {
	const plugin = marketplace({ name: 'p', source: './plugins/p' }).plugins[0];

	assert.equal(entryPathForLayout('namespaced', plugin), '.cc-marketspec/entries/plugin-p.yaml');
	assert.equal(entryPathForLayout('legacy', plugin), 'plugins/p/entry.yaml');
	assert.equal(entryPathForLayout('fresh', plugin), null);
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

test('duplicate ids prevent a strong legacy signature', () => {
	const resolved = marketplace(
		{ name: 'same', source: './plugins/a' },
		{ name: 'same', source: './plugins/b' }
	);
	const layout = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'plugins/a/entry.yaml': 'tagline: First\n',
			'plugins/b/entry.yaml': 'tagline: Second\n'
		}),
		resolved.plugins
	);

	assert.equal(layout.kind, 'ambiguous');
	assert.equal(layout.legacy.strong, false);
	assert.ok(layout.legacy.errors.some((error) => /duplicate plugin id/i.test(error)));
});

test('duplicate legacy entry paths prevent a strong legacy signature', () => {
	const resolved = marketplace(
		{ name: 'a', source: './plugins/shared' },
		{ name: 'b', source: './plugins/shared' }
	);
	const layout = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'plugins/shared/entry.yaml': 'tagline: Shared\n'
		}),
		resolved.plugins
	);

	assert.equal(layout.kind, 'ambiguous');
	assert.equal(layout.legacy.strong, false);
	assert.ok(layout.legacy.errors.some((error) => /same legacy entry path/i.test(error)));
});

test('classifies namespaced authored candidates without reading generic files', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({
			'.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
			'catalog.yaml': 'owned-by: another-tool\n',
			'plugins/p/entry.yaml': 'also: another-tool\n'
		}),
		resolved.plugins
	);
	assert.equal(layout.kind, 'namespaced');
	assert.equal(layout.catalogPath, '.cc-marketspec/catalog.yaml');
});

test('a malformed namespaced entry candidate still selects namespaced', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({
			'.cc-marketspec/entries/plugin-p.yaml': 'tagline: [unterminated\n'
		}),
		resolved.plugins
	);

	assert.equal(layout.kind, 'namespaced');
	assert.equal(layout.catalogPath, '.cc-marketspec/catalog.yaml');
});

test('a nested namespaced file takes precedence over strong legacy leftovers', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({
			'.cc-marketspec/entries/archive/plugin-p.yaml': 'tagline: Archived\n',
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'plugins/p/entry.yaml': 'tagline: Legacy\n'
		}),
		resolved.plugins
	);

	assert.equal(layout.kind, 'namespaced');
	assert.deepEqual(layout.warnings, [
		'.cc-marketspec/entries/archive/plugin-p.yaml: orphan entry has no marketplace plugin',
		'recognized legacy files remain; run cc-marketspec migrate to resume safe cleanup'
	]);
});

test('reports namespaced orphan entries in deterministic order', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({
			'.cc-marketspec/entries/plugin-z.yaml': '{}\n',
			'.cc-marketspec/entries/plugin-p.yaml': '{}\n',
			'.cc-marketspec/entries/plugin-a.yaml': '{}\n'
		}),
		resolved.plugins
	);

	assert.deepEqual(layout.warnings, [
		'.cc-marketspec/entries/plugin-a.yaml: orphan entry has no marketplace plugin',
		'.cc-marketspec/entries/plugin-z.yaml: orphan entry has no marketplace plugin'
	]);
});

test('an empty child directory under namespaced entries stays fresh', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'cc-marketspec-layout-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, '.cc-marketspec', 'entries', 'empty', 'deeper'), { recursive: true });
	const resolved = marketplace({ name: 'p', source: './plugins/p' });

	assert.equal(inspectLayout(new NodeFileSource(root), resolved.plugins).kind, 'fresh');
});

test('requires a strong signature before auto-selecting legacy', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const strong = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'plugins/p/entry.yaml': 'tagline: Legacy presentation\n'
		}),
		resolved.plugins
	);
	assert.equal(strong.kind, 'legacy');

	const catalogOnly = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: "1.0"\n'
		}),
		resolved.plugins
	);
	assert.equal(catalogOnly.kind, 'ambiguous');
});

test('a mapped legacy entry without a catalog is ambiguous', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({ 'plugins/p/entry.yaml': 'tagline: Entry only\n' }),
		resolved.plugins
	);

	assert.equal(layout.kind, 'ambiguous');
	assert.equal(layout.legacy.hasCandidates, true);
	assert.equal(layout.legacy.strong, false);
});

test('malformed legacy catalog and entry candidates remain ambiguous', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const malformedCatalog = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: [unterminated\n',
			'plugins/p/entry.yaml': 'tagline: Valid\n'
		}),
		resolved.plugins
	);
	const malformedEntry = inspectLayout(
		new MemoryFileSource({
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'plugins/p/entry.yaml': 'tagline: [unterminated\n'
		}),
		resolved.plugins
	);

	assert.equal(malformedCatalog.kind, 'ambiguous');
	assert.ok(malformedCatalog.legacy.errors.some((error) => /catalog\.yaml does not validate/i.test(error)));
	assert.equal(malformedEntry.kind, 'ambiguous');
	assert.ok(malformedEntry.legacy.errors.some((error) => /plugins\/p\/entry\.yaml does not validate/i.test(error)));
});

test('root manifest alone is fresh, and dist-only namespace is fresh', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	assert.equal(inspectLayout(new MemoryFileSource({ 'manifest.json': '{}' }), resolved.plugins).kind, 'fresh');
	assert.equal(
		inspectLayout(
			new MemoryFileSource({
				'.cc-marketspec/.gitignore': '/dist/\n',
				'.cc-marketspec/dist/manifest.json': '{}'
			}),
			resolved.plugins
		).kind,
		'fresh'
	);
});

test('an unmapped root legacy entry is ambiguous rather than fresh', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(new MemoryFileSource({ 'entry.yaml': 'tagline: Orphan\n' }), resolved.plugins);

	assert.equal(layout.kind, 'ambiguous');
	assert.equal(layout.legacy.hasCandidates, true);
	assert.ok(layout.legacy.errors.some((error) => /entry\.yaml.*not mapped/i.test(error)));
});

test('an unmapped plugins child legacy entry is ambiguous rather than fresh', () => {
	const resolved = marketplace({ name: 'p', source: './plugins/p' });
	const layout = inspectLayout(
		new MemoryFileSource({ 'plugins/orphan/entry.yaml': 'tagline: Orphan\n' }),
		resolved.plugins
	);

	assert.equal(layout.kind, 'ambiguous');
	assert.equal(layout.legacy.hasCandidates, true);
	assert.ok(layout.legacy.errors.some((error) => /plugins\/orphan\/entry\.yaml.*not mapped/i.test(error)));
});

test('implicit local sources retain their fallback path and warn', () => {
	const result = marketplace({ name: 'implicit' });

	assert.deepEqual(result.errors, []);
	assert.equal(result.plugins[0].dir, 'plugins/implicit');
	assert.equal(result.plugins[0].legacyEntryPath, 'plugins/implicit/entry.yaml');
	assert.deepEqual(result.warnings, [
		'implicit: implicit plugins/implicit source is deprecated; add source: "./plugins/implicit"'
	]);
});

test('rejects invalid plugin ids at resolution and path mapping boundaries', () => {
	const result = marketplace({ name: 'Bad_Name', source: './plugins/bad' });

	assert.deepEqual(result.plugins, []);
	assert.match(result.errors[0], /must be kebab-case/i);
	assert.throws(() => entryPathForPlugin('Bad_Name'), /unsafe plugin id/i);
});

test('recognizes remote objects without inventing a local directory', () => {
	const result = marketplace({ name: 'remote', source: { source: 'github', repo: 'o/r' } });
	assert.deepEqual(result.errors, []);
	assert.equal(result.plugins[0].sourceKind, 'remote');
	assert.equal(result.plugins[0].dir, null);
	assert.equal(result.plugins[0].legacyEntryPath, null);
});
