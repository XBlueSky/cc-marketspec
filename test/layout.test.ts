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

const marketplace = (...plugins: Record<string, unknown>[]) => resolveMarketplacePlugins(plugins);

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

test('recognizes remote objects without inventing a local directory', () => {
	const result = marketplace({ name: 'remote', source: { source: 'github', repo: 'o/r' } });
	assert.deepEqual(result.errors, []);
	assert.equal(result.plugins[0].sourceKind, 'remote');
	assert.equal(result.plugins[0].dir, null);
});
