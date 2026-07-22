import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSource, NodeFileSource } from '../src/fs-source.ts';
import {
	MIGRATION_RECEIPT_PATH,
	planMigration,
	type MigrationPlan
} from '../src/migration.ts';

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

function cutover(plan: MigrationPlan, extra: Record<string, string> = {}): MemoryFileSource {
	const original = legacy();
	return new MemoryFileSource({
		'.claude-plugin/marketplace.json': original.read('.claude-plugin/marketplace.json') as string,
		'plugins/sample/.claude-plugin/plugin.json': original.read(
			'plugins/sample/.claude-plugin/plugin.json'
		) as string,
		'catalog.yaml': original.read('catalog.yaml') as string,
		'plugins/sample/entry.yaml': original.read('plugins/sample/entry.yaml') as string,
		...plan.writes,
		...extra
	});
}

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

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
	assert.ok(plan.writes[MIGRATION_RECEIPT_PATH]);
	assert.equal(source.read('catalog.yaml'), beforeCatalog);
	assert.equal(source.read('.cc-marketspec/catalog.yaml'), null);
});

test('catalog rewrite preserves comments, quoting, key order, and entry bytes', () => {
	const source = legacy();
	const entry = source.read('plugins/sample/entry.yaml');
	const plan = planMigration(source);
	const catalog = plan.writes['.cc-marketspec/catalog.yaml'];
	assert.match(catalog, /^# catalog comment/m);
	assert.match(catalog, /schemaVersion: "1\.1" # keep quote/);
	assert.ok(catalog.indexOf('schemaVersion') < catalog.indexOf('lang:'));
	assert.ok(catalog.indexOf('lang:') < catalog.indexOf('groups:'));
	assert.match(plan.writes['.cc-marketspec/entries/plugin-sample.yaml'], /^# entry comment/m);
	assert.equal(plan.writes['.cc-marketspec/entries/plugin-sample.yaml'], entry);
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
	const malformed = planMigration(
		new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
			'catalog.yaml': 'schemaVersion: "1.0"\nunknown: value\n'
		}),
		{ from: 'legacy' }
	);
	assert.ok(malformed.errors.some((error) => /catalog/i.test(error)));
	assert.deepEqual(malformed.writes, {});

	const collision = planMigration(
		new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
			'catalog.yaml': 'schemaVersion: "1.0"\n',
			'.cc-marketspec/unrelated': 'occupied'
		}),
		{ from: 'legacy' }
	);
	assert.ok(collision.errors.some((error) => /target|\.cc-marketspec/i.test(error)));
	assert.deepEqual(collision.writes, {});
});

test('a dangling .cc-marketspec symlink occupies the migration namespace', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ccms-migration-collision-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, '.claude-plugin'), { recursive: true });
	mkdirSync(join(root, 'plugins', 'sample', '.claude-plugin'), { recursive: true });
	writeFileSync(
		join(root, '.claude-plugin', 'marketplace.json'),
		JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'sample', source: './plugins/sample' }]
		})
	);
	writeFileSync(
		join(root, 'plugins', 'sample', '.claude-plugin', 'plugin.json'),
		JSON.stringify({ name: 'sample', version: '1.0.0' })
	);
	writeFileSync(join(root, 'catalog.yaml'), 'schemaVersion: "1.0"\n');
	writeFileSync(join(root, 'plugins', 'sample', 'entry.yaml'), 'tagline: Legacy\n');
	const missingTarget = join(root, 'missing-target');
	symlinkSync(
		missingTarget,
		join(root, '.cc-marketspec'),
		process.platform === 'win32' ? 'junction' : 'dir'
	);
	const source = new NodeFileSource(root);
	assert.equal(source.exists('.cc-marketspec'), false);
	assert.equal(source.isSymbolicLink('.cc-marketspec'), true);

	const plan = planMigration(source);
	assert.equal(plan.kind, 'noop');
	assert.ok(plan.errors.some((error) => /target already exists|occupied/i.test(error)));
	assert.deepEqual(plan.writes, {});
});

test('removes root manifest only when bytes match legacy generation', () => {
	const basePlan = planMigration(legacy());
	const migrated = JSON.parse(
		basePlan.writes['.cc-marketspec/dist/manifest.json']
	) as Record<string, unknown>;
	const legacyManifest = JSON.stringify({ ...migrated, schemaVersion: '1.0' }, null, 2) + '\n';
	const matching = planMigration(legacy({ 'manifest.json': legacyManifest }));
	assert.ok(matching.removals.some((removal) => removal.path === 'manifest.json'));

	const unrelated = planMigration(legacy({ 'manifest.json': '{"owner":"another-tool"}\n' }));
	assert.equal(unrelated.removals.some((removal) => removal.path === 'manifest.json'), false);
	assert.ok(unrelated.warnings.some((warning) => /manifest\.json.*left untouched/i.test(warning)));
});

test('receipt records deterministic target and source digests without self-reference', () => {
	const plan = planMigration(legacy());
	const receipt = JSON.parse(plan.writes[MIGRATION_RECEIPT_PATH]) as {
		targetDigests: Record<string, string>;
		removals: { path: string; digest: string }[];
	};
	assert.equal(receipt.targetDigests[MIGRATION_RECEIPT_PATH], undefined);
	for (const [path, body] of Object.entries(plan.writes)) {
		if (path !== MIGRATION_RECEIPT_PATH) assert.equal(receipt.targetDigests[path], sha256(body));
	}
	for (const item of receipt.removals) {
		assert.equal(item.digest, sha256(legacy().read(item.path) as string));
	}
	assert.deepEqual(
		Object.keys(receipt.targetDigests),
		Object.keys(receipt.targetDigests).slice().sort()
	);
	assert.deepEqual(
		receipt.removals.map((item) => item.path),
		receipt.removals.map((item) => item.path).slice().sort()
	);
});

test('planning is deterministic across source insertion order', () => {
	const entries = {
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [
				{ name: 'zeta', source: './plugins/zeta' },
				{ name: 'alpha', source: './plugins/alpha' }
			]
		}),
		'catalog.yaml': 'schemaVersion: "1.0"\n',
		'plugins/zeta/entry.yaml': 'tagline: Zeta\n',
		'plugins/alpha/entry.yaml': 'tagline: Alpha\n',
		'plugins/zeta/.claude-plugin/plugin.json': '{"name":"zeta","version":"1.0.0"}',
		'plugins/alpha/.claude-plugin/plugin.json': '{"name":"alpha","version":"1.0.0"}'
	};
	const reverse = Object.fromEntries(Object.entries(entries).reverse());
	assert.deepEqual(
		planMigration(new MemoryFileSource(entries)),
		planMigration(new MemoryFileSource(reverse))
	);
});

test('plans cleanup-only from a valid receipt and never infers cleanup without one', () => {
	const first = planMigration(legacy());
	const files = cutover(first);
	const cleanup = planMigration(files);
	assert.equal(cleanup.kind, 'cleanup');
	assert.deepEqual(cleanup.writes, {});
	assert.ok(cleanup.removals.some((removal) => removal.path === 'catalog.yaml'));

	const changed = planMigration(
		cutover(first, { 'plugins/sample/entry.yaml': 'tagline: changed after cutover\n' })
	);
	assert.ok(changed.errors.some((error) => /digest|changed/i.test(error)));
	assert.deepEqual(changed.removals, []);

	const nativeChanged = planMigration(
		cutover(first, {
			'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({
				name: 'sample',
				version: '2.0.0'
			})
		})
	);
	assert.ok(nativeChanged.errors.some((error) => /generated bytes changed after cutover/i.test(error)));

	const noReceipt: Record<string, string> = {};
	for (const path of [
		'.claude-plugin/marketplace.json',
		'plugins/sample/.claude-plugin/plugin.json',
		'catalog.yaml',
		'plugins/sample/entry.yaml',
		'.cc-marketspec/.gitignore',
		'.cc-marketspec/catalog.yaml',
		'.cc-marketspec/entries/plugin-sample.yaml',
		'.cc-marketspec/dist/manifest.json'
	]) {
		noReceipt[path] = files.read(path) as string;
	}
	const unrelated = planMigration(new MemoryFileSource(noReceipt));
	assert.equal(unrelated.kind, 'noop');
	assert.equal(unrelated.removals.length, 0);
	assert.ok(unrelated.warnings.some((warning) => /without a migration receipt.*left untouched/i.test(warning)));

	const invalidCurrent = planMigration(
		new MemoryFileSource({
			...noReceipt,
			'.cc-marketspec/catalog.yaml': 'schemaVersion: "9.9"\n'
		})
	);
	assert.ok(invalidCurrent.errors.some((error) => /catalog|schemaVersion/i.test(error)));
});

test('cleanup accepts already-removed sources but still validates target equivalence', () => {
	const first = planMigration(legacy());
	const files = cutover(first);
	const retained: Record<string, string> = {};
	for (const path of [
		'.claude-plugin/marketplace.json',
		'plugins/sample/.claude-plugin/plugin.json',
		'.cc-marketspec/.gitignore',
		'.cc-marketspec/catalog.yaml',
		'.cc-marketspec/entries/plugin-sample.yaml',
		'.cc-marketspec/dist/manifest.json',
		MIGRATION_RECEIPT_PATH
	]) {
		retained[path] = files.read(path) as string;
	}
	const cleanup = planMigration(new MemoryFileSource(retained));
	assert.equal(cleanup.kind, 'cleanup');
	assert.deepEqual(cleanup.errors, []);
});

test('rejects malformed receipts and never follows receipt traversal paths', () => {
	const base = {
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
		'.cc-marketspec/.gitignore': '/dist/\n',
		'.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
		'.cc-marketspec/dist/manifest.json': JSON.stringify(
			{ schemaVersion: '1.1', marketplace: { name: 'mk' }, plugins: [] },
			null,
			2
		) + '\n'
	};
	const requiredTargets = {
		'.cc-marketspec/.gitignore': '0'.repeat(64),
		'.cc-marketspec/catalog.yaml': '0'.repeat(64),
		'.cc-marketspec/dist/manifest.json': '0'.repeat(64)
	};
	const malformed: unknown[] = [
		null,
		[],
		{ receiptVersion: 2, sourceVersion: '1.0', targetVersion: '1.1', targetDigests: requiredTargets, removals: [] },
		{ receiptVersion: 1, sourceVersion: '1.0', targetVersion: '1.1', targetDigests: {}, removals: [] },
		{
			receiptVersion: 1,
			sourceVersion: '1.0',
			targetVersion: '1.1',
			targetDigests: requiredTargets,
			removals: [{ path: '../outside', digest: '0'.repeat(64) }]
		},
		{
			receiptVersion: 1,
			sourceVersion: '1.0',
			targetVersion: '1.1',
			targetDigests: requiredTargets,
			removals: [{ path: '.cc-marketspec/catalog.yaml', digest: '0'.repeat(64) }]
		},
		{
			receiptVersion: 1,
			sourceVersion: '1.0',
			targetVersion: '1.1',
			targetDigests: { ...requiredTargets, [MIGRATION_RECEIPT_PATH]: '0'.repeat(64) },
			removals: []
		},
		{
			receiptVersion: 1,
			sourceVersion: '1.0',
			targetVersion: '1.1',
			targetDigests: requiredTargets,
			removals: [
				{ path: 'catalog.yaml', digest: '0'.repeat(64) },
				{ path: 'catalog.yaml', digest: '0'.repeat(64) }
			]
		}
	];
	for (const receipt of malformed) {
		const plan = planMigration(
			new MemoryFileSource({
				...base,
				[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt)
			})
		);
		assert.equal(plan.kind, 'noop');
		assert.ok(plan.errors.some((error) => /malformed migration receipt/i.test(error)));
		assert.deepEqual(plan.removals, []);
	}
	const invalidJson = planMigration(
		new MemoryFileSource({ ...base, [MIGRATION_RECEIPT_PATH]: '{' })
	);
	assert.ok(invalidJson.errors.some((error) => /malformed migration receipt/i.test(error)));
});

test('rejects a forged receipt that claims an unrelated root-contained file', () => {
	const source = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
		'.cc-marketspec/.gitignore': '/dist/\n',
		'.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\n',
		'.cc-marketspec/dist/manifest.json': '{}\n',
		[MIGRATION_RECEIPT_PATH]: JSON.stringify({
			receiptVersion: 1,
			sourceVersion: '1.0',
			targetVersion: '1.1',
			targetDigests: {
				'.cc-marketspec/.gitignore': sha256('/dist/\n'),
				'.cc-marketspec/catalog.yaml': sha256('schemaVersion: "1.1"\n'),
				'.cc-marketspec/dist/manifest.json': sha256('{}\n')
			},
			removals: [
				{ path: 'catalog.yaml', digest: '0'.repeat(64) },
				{ path: 'README.md', digest: sha256('do not delete\n') }
			]
		}),
		'README.md': 'do not delete\n'
	});
	const plan = planMigration(source);
	assert.equal(plan.kind, 'noop');
	assert.ok(plan.errors.some((error) => /unauthorized cleanup path.*README\.md/i.test(error)));
	assert.deepEqual(plan.removals, []);
});

test('re-authorizes receipt entry removals against the current marketplace mapping', () => {
	const first = planMigration(legacy());
	const source = cutover(first, {
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'sample', source: './plugins/renamed' }]
		}),
		'plugins/renamed/.claude-plugin/plugin.json': JSON.stringify({
			name: 'sample',
			version: '1.0.0'
		})
	});
	const plan = planMigration(source);
	assert.equal(plan.kind, 'noop');
	assert.ok(
		plan.errors.some((error) => /unauthorized cleanup path.*plugins\/sample\/entry\.yaml/i.test(error))
	);
	assert.deepEqual(plan.removals, []);
});

test('cleanup rejects changed target bytes and changed generated bytes', () => {
	const first = planMigration(legacy());
	const targetChanged = planMigration(
		cutover(first, {
			'.cc-marketspec/entries/plugin-sample.yaml': 'tagline: replaced\n'
		})
	);
	assert.ok(targetChanged.errors.some((error) => /target digest does not match/i.test(error)));
	assert.deepEqual(targetChanged.removals, []);

	const manifestChanged = planMigration(
		cutover(first, {
			'.cc-marketspec/dist/manifest.json': '{}\n'
		})
	);
	assert.ok(
		manifestChanged.errors.some(
			(error) => /target digest does not match|generated bytes changed after cutover/i.test(error)
		)
	);
	assert.deepEqual(manifestChanged.removals, []);
});

test('cleanup re-authorizes the migration-owned gitignore bytes', () => {
	const first = planMigration(legacy());
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		targetDigests: Record<string, string>;
	};
	const forgedIgnore = '# user policy\n';
	receipt.targetDigests['.cc-marketspec/.gitignore'] = sha256(forgedIgnore);
	const plan = planMigration(
		cutover(first, {
			'.cc-marketspec/.gitignore': forgedIgnore,
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);
	assert.equal(plan.kind, 'noop');
	assert.ok(plan.errors.some((error) => /gitignore.*\/dist\/|gitignore.*migration/i.test(error)));
	assert.deepEqual(plan.removals, []);
});

test('forged removal digest cannot claim a different valid legacy catalog', () => {
	const first = planMigration(legacy());
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		removals: { path: string; digest: string }[];
	};
	const changedCatalog = 'schemaVersion: "1.0"\nlang: zh-TW\n';
	receipt.removals.find((item) => item.path === 'catalog.yaml')!.digest = sha256(changedCatalog);
	const plan = planMigration(
		cutover(first, {
			'catalog.yaml': changedCatalog,
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);

	assert.equal(plan.kind, 'noop');
	assert.ok(plan.errors.some((error) => /catalog\.yaml.*canonical|catalog\.yaml.*target/i.test(error)));
	assert.deepEqual(plan.removals, []);
});

test('forged removal digest cannot claim a different valid mapped legacy entry', () => {
	const first = planMigration(legacy());
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		removals: { path: string; digest: string }[];
	};
	const changedEntry = 'tagline: Different but valid\n';
	receipt.removals.find((item) => item.path === 'plugins/sample/entry.yaml')!.digest =
		sha256(changedEntry);
	const plan = planMigration(
		cutover(first, {
			'plugins/sample/entry.yaml': changedEntry,
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);

	assert.equal(plan.kind, 'noop');
	assert.ok(
		plan.errors.some(
			(error) => /plugins\/sample\/entry\.yaml.*canonical|plugins\/sample\/entry\.yaml.*target/i.test(error)
		)
	);
	assert.deepEqual(plan.removals, []);
});

test('remaining mapped legacy entry cannot be omitted from a forged receipt and target tree', () => {
	const sourceBeforeCutover = legacy({ 'plugins/sample/entry.yaml': '{}\n' });
	const first = planMigration(sourceBeforeCutover);
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		targetDigests: Record<string, string>;
		removals: { path: string; digest: string }[];
	};
	delete receipt.targetDigests['.cc-marketspec/entries/plugin-sample.yaml'];
	receipt.removals = receipt.removals.filter(
		(item) => item.path !== 'plugins/sample/entry.yaml'
	);
	const plan = planMigration(
		new MemoryFileSource({
			'.claude-plugin/marketplace.json': sourceBeforeCutover.read(
				'.claude-plugin/marketplace.json'
			) as string,
			'plugins/sample/.claude-plugin/plugin.json': sourceBeforeCutover.read(
				'plugins/sample/.claude-plugin/plugin.json'
			) as string,
			'catalog.yaml': sourceBeforeCutover.read('catalog.yaml') as string,
			'plugins/sample/entry.yaml': '{}\n',
			'.cc-marketspec/.gitignore': first.writes['.cc-marketspec/.gitignore'],
			'.cc-marketspec/catalog.yaml': first.writes['.cc-marketspec/catalog.yaml'],
			'.cc-marketspec/dist/manifest.json': first.writes['.cc-marketspec/dist/manifest.json'],
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);

	assert.equal(plan.kind, 'noop');
	assert.ok(
		plan.errors.some(
			(error) => /plugins\/sample\/entry\.yaml.*receipt|plugin-sample\.yaml.*target/i.test(error)
		)
	);
	assert.deepEqual(plan.removals, []);
});

test('receipt cannot omit a current namespaced entry and all of its legacy provenance', () => {
	const first = planMigration(legacy());
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		targetDigests: Record<string, string>;
		removals: { path: string; digest: string }[];
	};
	delete receipt.targetDigests['.cc-marketspec/entries/plugin-sample.yaml'];
	receipt.removals = receipt.removals.filter(
		(item) => item.path !== 'plugins/sample/entry.yaml'
	);
	const plan = planMigration(
		cutover(first, {
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);
	assert.equal(plan.kind, 'noop');
	assert.ok(
		plan.errors.some(
			(error) => /plugin-sample\.yaml.*target digest|plugin-sample\.yaml.*provenance/i.test(error)
		)
	);
	assert.deepEqual(plan.removals, []);
});

test('cleanup revalidates remaining legacy catalog and entry schemas', () => {
	const first = planMigration(legacy());
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		removals: { path: string; digest: string }[];
	};
	const malformedCatalog = 'schemaVersion: "1.0"\nunknown: value\n';
	receipt.removals.find((item) => item.path === 'catalog.yaml')!.digest = sha256(malformedCatalog);
	let plan = planMigration(
		cutover(first, {
			'catalog.yaml': malformedCatalog,
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
		})
	);
	assert.ok(plan.errors.some((error) => /remaining source is not a legacy.*catalog/i.test(error)));

	const malformedEntry = 'unknown: value\n';
	const receipt2 = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		removals: { path: string; digest: string }[];
	};
	receipt2.removals.find((item) => item.path.endsWith('/entry.yaml'))!.digest = sha256(malformedEntry);
	plan = planMigration(
		cutover(first, {
			'plugins/sample/entry.yaml': malformedEntry,
			[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt2, null, 2) + '\n'
		})
	);
	assert.ok(plan.errors.some((error) => /remaining source is not a cc-marketspec entry/i.test(error)));
});

test('cleanup only authorizes a root manifest that still equals derived legacy output', () => {
	const base = planMigration(legacy());
	const migrated = JSON.parse(base.writes['.cc-marketspec/dist/manifest.json']) as Record<string, unknown>;
	const legacyManifest = JSON.stringify({ ...migrated, schemaVersion: '1.0' }, null, 2) + '\n';
	const first = planMigration(legacy({ 'manifest.json': legacyManifest }));
	assert.ok(first.removals.some((item) => item.path === 'manifest.json'));
	const receipt = JSON.parse(first.writes[MIGRATION_RECEIPT_PATH]) as {
		removals: { path: string; digest: string }[];
	};
	const changed = '{"owner":"another-tool"}\n';
	receipt.removals.find((item) => item.path === 'manifest.json')!.digest = sha256(changed);
	const source = cutover(first, {
		'manifest.json': changed,
		[MIGRATION_RECEIPT_PATH]: JSON.stringify(receipt, null, 2) + '\n'
	});
	const plan = planMigration(source);
	assert.ok(plan.errors.some((error) => /no longer matches derived legacy output/i.test(error)));
	assert.deepEqual(plan.removals, []);
});

test('remote sources fail staged validation explicitly and produce no operations', () => {
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

test('invalid and duplicate marketplace mappings produce no operations', () => {
	for (const plugins of [
		[
			{ name: 'same', source: './plugins/a' },
			{ name: 'same', source: './plugins/b' }
		],
		[
			{ name: 'a', source: './plugins/shared' },
			{ name: 'b', source: './plugins/shared' }
		],
		[{ name: 'Bad_Name', source: './plugins/a' }],
		[{ name: 'escape', source: './../outside' }]
	]) {
		const plan = planMigration(
			new MemoryFileSource({
				'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins }),
				'catalog.yaml': 'schemaVersion: "1.0"\n'
			}),
			{ from: 'legacy' }
		);
		assert.notDeepEqual(plan.errors, []);
		assert.deepEqual(plan.writes, {});
		assert.deepEqual(plan.removals, []);
	}
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

test('valid current namespaced input is a no-op and unrelated generic files are preserved', () => {
	const first = planMigration(legacy());
	const files = cutover(first);
	const namespacedOnly: Record<string, string> = {};
	for (const path of [
		'.claude-plugin/marketplace.json',
		'plugins/sample/.claude-plugin/plugin.json',
		'.cc-marketspec/.gitignore',
		'.cc-marketspec/catalog.yaml',
		'.cc-marketspec/entries/plugin-sample.yaml',
		'.cc-marketspec/dist/manifest.json'
	]) {
		namespacedOnly[path] = files.read(path) as string;
	}
	namespacedOnly['catalog.yaml'] = 'owned-by: another-tool\n';
	namespacedOnly['plugins/sample/entry.yaml'] = 'owned-by: another-tool\n';
	const plan = planMigration(new MemoryFileSource(namespacedOnly));
	assert.equal(plan.kind, 'noop');
	assert.deepEqual(plan.writes, {});
	assert.deepEqual(plan.removals, []);
});

test('fresh input remains a no-op even with an unrelated root manifest', () => {
	const plan = planMigration(
		new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
			'manifest.json': '{"owner":"another-tool"}\n'
		}),
		{ from: 'legacy' }
	);
	assert.equal(plan.kind, 'noop');
	assert.equal(plan.sourceVersion, null);
	assert.deepEqual(plan.writes, {});
	assert.deepEqual(plan.removals, []);
});
