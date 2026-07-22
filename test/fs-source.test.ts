import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryFileSource, NodeFileSource, OverlayFileSource, normalize } from '../src/fs-source.ts';

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

test('node source treats a nonexistent root as empty but still validates paths', () => {
	const parent = mkdtempSync(join(tmpdir(), 'ccms-missing-root-'));
	const source = new NodeFileSource(join(parent, 'missing'));
	try {
		assert.equal(source.read('catalog.yaml'), null);
		assert.equal(source.exists('catalog.yaml'), false);
		assert.equal(source.isDir('plugins'), false);
		assert.deepEqual(source.list(''), []);
		assert.throws(() => source.read('../outside'), /parent/i);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test('overlay prefers overrides and returns a deterministic union listing', () => {
	const base = new MemoryFileSource({ 'dir/base': 'base', 'dir/shared': 'base shared' });
	const source = new OverlayFileSource(base, { 'dir/overlay': 'overlay', 'dir/shared': 'overlay shared' });
	assert.equal(source.read('dir/shared'), 'overlay shared');
	assert.equal(source.read('dir/base'), 'base');
	assert.deepEqual(source.list('dir'), ['base', 'overlay', 'shared']);
});

test('overlay files and directories shadow exact base collisions coherently', () => {
	const fileOverDir = new OverlayFileSource(new MemoryFileSource({ 'node/base-child': 'base' }), {
		node: 'overlay file'
	});
	assert.equal(fileOverDir.read('node'), 'overlay file');
	assert.equal(fileOverDir.isDir('node'), false);
	assert.deepEqual(fileOverDir.list('node'), []);

	const dirOverFile = new OverlayFileSource(new MemoryFileSource({ node: 'base file' }), {
		'node/overlay-child': 'overlay'
	});
	assert.equal(dirOverFile.read('node'), null);
	assert.equal(dirOverFile.isDir('node'), true);
	assert.deepEqual(dirOverFile.list('node'), ['overlay-child']);
});

test('overlay symlink introspection honors exact virtual shadowing', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-overlay-link-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'target'));
	symlinkSync(join(root, 'target'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
	const base = new NodeFileSource(root);

	assert.equal(base.isSymbolicLink?.('link'), true);
	assert.equal(new OverlayFileSource(base, { link: 'virtual file' }).isSymbolicLink?.('link'), false);
	assert.equal(new OverlayFileSource(base, { 'link/child': 'virtual child' }).isSymbolicLink?.('link'), false);
	assert.equal(new OverlayFileSource(base, { other: 'virtual' }).isSymbolicLink?.('link'), true);
});
