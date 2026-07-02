import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSource, normalize } from '../src/fs-source.ts';

const fs = new MemoryFileSource({
	'.claude-plugin/marketplace.json': '{"name":"mk"}',
	'plugins/foo/skills/greet/SKILL.md': '---\nname: greet\n---\n',
	'catalog.yaml': 'schemaVersion: "1.0"\n'
});

test('read returns contents or null', () => {
	assert.equal(fs.read('catalog.yaml'), 'schemaVersion: "1.0"\n');
	assert.equal(fs.read('missing.txt'), null);
});
test('exists covers files and inferred dirs', () => {
	assert.equal(fs.exists('catalog.yaml'), true);
	assert.equal(fs.exists('plugins/foo/skills'), true);
	assert.equal(fs.exists('nope'), false);
});
test('isDir is true only for directories', () => {
	assert.equal(fs.isDir('plugins/foo'), true);
	assert.equal(fs.isDir('catalog.yaml'), false);
});
test('list returns immediate child names', () => {
	assert.deepEqual(fs.list('plugins/foo/skills').sort(), ['greet']);
	assert.equal(fs.list('plugins/foo').includes('skills'), true);
	assert.equal(fs.list('catalog.yaml').length, 0);
});
test('leading ./ and trailing / are normalised', () => {
	assert.equal(fs.read('./catalog.yaml'), 'schemaVersion: "1.0"\n');
	assert.equal(fs.isDir('plugins/foo/'), true);
});
test('root is enumerable via "" and "."', () => {
	const top = fs.list('').sort();
	assert.deepEqual(top, ['.claude-plugin', 'catalog.yaml', 'plugins']);
	assert.deepEqual(fs.list('.').sort(), top);
	assert.equal(fs.isDir('.'), true);
});
test('normalize maps source-field shapes to relative dirs', () => {
	assert.equal(normalize('./'), '');
	assert.equal(normalize('.'), '');
	assert.equal(normalize('./plugins/foo'), 'plugins/foo');
	assert.equal(normalize('plugins/foo/'), 'plugins/foo');
	assert.equal(normalize('packages/bar'), 'packages/bar');
});
