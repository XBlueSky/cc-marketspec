import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeInternalPath, resolveWithinRoot } from '../src/path-policy.ts';

test('normalizes only safe POSIX-relative paths', () => {
	assert.equal(normalizeInternalPath('./plugins/a'), 'plugins/a');
	assert.equal(normalizeInternalPath('./', { allowRoot: true }), '');
	for (const path of [
		'../outside',
		'a/../outside',
		'/abs',
		'C:/abs',
		'C:relative',
		'./C:/abs',
		'./C:relative',
		'safe/C:/abs',
		'safe/C:relative',
		'\\\\server\\share',
		'a\\b'
	]) {
		assert.throws(() => normalizeInternalPath(path), /relative|parent|POSIX|drive|UNC/i);
	}
});

test('rejects dot-only root aliases unless root is allowed', () => {
	for (const path of ['././.', '././']) {
		assert.throws(() => normalizeInternalPath(path), /root/i);
		assert.equal(normalizeInternalPath(path, { allowRoot: true }), '');
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
		assert.throws(() => resolveWithinRoot(root, 'escape/missing'), /escapes marketplace root/i);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
