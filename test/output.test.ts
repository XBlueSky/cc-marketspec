import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
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
	type OutputWriteOperations,
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

test('preserves a dangling ignore symlink and warns instead of replacing it', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		mkdirSync(join(root, '.cc-marketspec'), { recursive: true });
		const ignore = join(root, '.cc-marketspec/.gitignore');
		symlinkSync('missing-ignore-target', ignore, 'file');
		const warnings = ensureNamespacedDistIgnore(root);
		assert.equal(lstatSync(ignore).isSymbolicLink(), true);
		assert.equal(readlinkSync(ignore), 'missing-ignore-target');
		assert.ok(warnings.some((warning) => warning.includes('/dist/')));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('an EEXIST race cannot clobber a newly-created ignore file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		const racedBody = '# concurrently created\n';
		const operations: Partial<OutputWriteOperations> = {
			randomUUID: () => 'ignore-race',
			link: (temporary, target) => {
				writeFileSync(target, racedBody);
				linkSync(temporary, target);
			}
		};
		const warnings = ensureNamespacedDistIgnore(root, operations);
		assert.equal(readFileSync(join(root, '.cc-marketspec/.gitignore'), 'utf8'), racedBody);
		assert.ok(warnings.some((warning) => warning.includes('/dist/')));
		assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore.tmp-ignore-race')), false);
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

test('an exclusive-open collision never deletes a pre-existing temporary file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		const temporary = join(root, 'out.json.tmp-collision');
		writeFileSync(temporary, 'owned by another writer\n');
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, { randomUUID: () => 'collision' }),
			/EEXIST|exist/i
		);
		assert.equal(readFileSync(temporary, 'utf8'), 'owned by another writer\n');
		assert.equal(existsSync(join(root, 'out.json')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a write failure closes the descriptor and removes the owned temporary file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const primary = new Error('injected write failure');
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'write-failure',
				write: () => { throw primary; }
			}),
			(error) => error === primary
		);
		assert.equal(existsSync(join(root, 'out.json')), false);
		assert.equal(existsSync(join(root, 'out.json.tmp-write-failure')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('an fsync failure closes the descriptor and removes the owned temporary file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const primary = new Error('injected fsync failure');
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'fsync-failure',
				fsync: () => { throw primary; }
			}),
			(error) => error === primary
		);
		assert.equal(existsSync(join(root, 'out.json')), false);
		assert.equal(existsSync(join(root, 'out.json.tmp-fsync-failure')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a close failure is not retried and still removes the owned temporary file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const primary = new Error('injected close failure');
	let closeCalls = 0;
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'close-failure',
				close: (descriptor) => {
					closeCalls += 1;
					closeSync(descriptor);
					throw primary;
				}
			}),
			(error) => error === primary
		);
		assert.equal(closeCalls, 1);
		assert.equal(existsSync(join(root, 'out.json')), false);
		assert.equal(existsSync(join(root, 'out.json.tmp-close-failure')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a rename failure removes the owned temporary file', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const primary = new Error('injected rename failure');
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'rename-failure',
				rename: () => { throw primary; }
			}),
			(error) => error === primary
		);
		assert.equal(existsSync(join(root, 'out.json')), false);
		assert.equal(existsSync(join(root, 'out.json.tmp-rename-failure')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('cleanup failures do not replace the primary write failure', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const primary = new Error('primary write failure');
	let closeCalls = 0;
	let unlinkCalls = 0;
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'cleanup-failure',
				write: () => { throw primary; },
				close: (descriptor) => {
					closeCalls += 1;
					closeSync(descriptor);
					throw new Error('secondary close failure');
				},
				unlink: () => {
					unlinkCalls += 1;
					throw new Error('secondary unlink failure');
				}
			}),
			(error) => error === primary
		);
		assert.equal(closeCalls, 1);
		assert.equal(unlinkCalls, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('revalidates the target immediately before rename', () => {
	const parent = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	const root = join(parent, 'root');
	const outside = join(parent, 'outside.json');
	mkdirSync(root);
	writeFileSync(outside, 'outside stays unchanged\n');
	try {
		assert.throws(
			() => writeManifestOutput(root, 'out.json', {}, {
				randomUUID: () => 'revalidate',
				fsync: (descriptor) => {
					fsyncSync(descriptor);
					symlinkSync(outside, join(root, 'out.json'), 'file');
				}
			}),
			/escapes marketplace root/i
		);
		assert.equal(readFileSync(outside, 'utf8'), 'outside stays unchanged\n');
		assert.equal(lstatSync(join(root, 'out.json')).isSymbolicLink(), true);
		assert.equal(existsSync(join(root, 'out.json.tmp-revalidate')), false);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test('rejects a non-serializable top-level manifest before creating output directories', () => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-output-'));
	try {
		assert.throws(
			() => writeManifestOutput(root, 'nested/out.json', undefined),
			/serializable/i
		);
		assert.equal(existsSync(join(root, 'nested')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
