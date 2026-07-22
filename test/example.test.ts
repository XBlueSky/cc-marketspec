import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generate.ts';
import { NodeFileSource } from '../src/fs-source.ts';

const root = fileURLToPath(new URL('../examples/marketplace', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('the namespaced example reproduces its named fixture', () => {
	const { manifest, errors, warnings, layout } = generateManifest(new NodeFileSource(root));
	assert.equal(layout, 'namespaced');
	assert.deepEqual(errors, []);
	assert.deepEqual(warnings, []);
	const expected = JSON.parse(readFileSync(new URL('./fixtures/example-manifest.json', import.meta.url), 'utf8'));
	assert.deepEqual(manifest, expected);
	assert.equal(existsSync(`${root}/catalog.yaml`), false);
	assert.equal(existsSync(`${root}/manifest.json`), false);
	assert.equal(existsSync(`${root}/plugins/hello-plugin/entry.yaml`), false);
	assert.equal(readFileSync(`${root}/.cc-marketspec/.gitignore`, 'utf8'), '/dist/\n');
});

test('the migrated root catalog schema directive resolves from its namespaced path', () => {
	const catalog = readFileSync(new URL('../.cc-marketspec/catalog.yaml', import.meta.url), 'utf8');
	assert.match(catalog, /^# yaml-language-server: \$schema=\.\.\/schemas\/catalog\.schema\.json$/m);
	assert.equal(existsSync(fileURLToPath(new URL('../schemas/catalog.schema.json', import.meta.url))), true);
});

test('dogfood migrations leave no receipts and ignore only canonical dist output', () => {
	assert.equal(existsSync(`${repoRoot}/.cc-marketspec/.migration-state.json`), false);
	assert.equal(existsSync(`${root}/.cc-marketspec/.migration-state.json`), false);
	assert.equal(readFileSync(`${repoRoot}/.cc-marketspec/.gitignore`, 'utf8'), '/dist/\n');
	assert.equal(readFileSync(`${root}/.cc-marketspec/.gitignore`, 'utf8'), '/dist/\n');
});
