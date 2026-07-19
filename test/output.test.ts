import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
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
	assert.equal(defaultOutputPath('ambiguous'), '.cc-marketspec/dist/manifest.json');
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

test('preserves an existing ignore file that already ignores dist', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		mkdirSync(join(root, '.cc-marketspec'), { recursive: true });
		const body = '# user rules\n/dist/\n';
		writeFileSync(join(root, '.cc-marketspec/.gitignore'), body);
		assert.deepEqual(ensureNamespacedDistIgnore(root), []);
		assert.equal(readFileSync(join(root, '.cc-marketspec/.gitignore'), 'utf8'), body);
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

test('cleans up the atomic temporary file when replacement fails', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		mkdirSync(join(root, 'blocked.json'));
		assert.throws(() => writeManifestOutput(root, 'blocked.json', { b: 2 }));
		assert.deepEqual(readdirSync(root).filter((name) => name.startsWith('blocked.json.tmp-')), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
