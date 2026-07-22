import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInit, type InitPlan } from '../src/index.ts';
import { MemoryFileSource } from '../src/fs-source.ts';
import type { FileSource } from '../src/fs-source.ts';

test('fresh init creates only namespaced authored files at version 1.1', () => {
	const source = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [
				{ name: 'root', source: './' },
				{ name: 'con', source: './plugins/con' }
			]
		}),
		'.claude-plugin/plugin.json': JSON.stringify({ name: 'root', version: '1.0.0' }),
		'plugins/con/.claude-plugin/plugin.json': JSON.stringify({ name: 'con', version: '1.0.0' })
	});
	const plan: InitPlan = planInit(source);
	assert.deepEqual(plan.errors, []);
	assert.equal(plan.writes['.cc-marketspec/.gitignore'], '/dist/\n');
	assert.match(plan.writes['.cc-marketspec/catalog.yaml'], /schemaVersion: "1\.1"/);
	assert.ok(plan.writes['.cc-marketspec/entries/plugin-root.yaml']);
	assert.ok(plan.writes['.cc-marketspec/entries/plugin-con.yaml']);
	assert.equal('catalog.yaml' in plan.writes, false);
	assert.equal('entry.yaml' in plan.writes, false);
	assert.equal('plugins/con/entry.yaml' in plan.writes, false);
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
	] as Record<string, string>[]) {
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

test('plugin resolution errors block every planned write', () => {
	for (const plugins of [
		[{ name: 'Bad Name', source: './plugins/p' }],
		[
			{ name: 'p', source: './plugins/p' },
			{ name: 'p', source: './plugins/other' }
		]
	]) {
		const plan = planInit(new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins })
		}));
		assert.equal(Object.keys(plan.writes).length, 0);
		assert.ok(plan.errors.length > 0);
	}
});

test('missing, null, and object plugin collections are resolution errors', () => {
	for (const plugins of [undefined, null, {}]) {
		const marketplace = plugins === undefined ? { name: 'mk' } : { name: 'mk', plugins };
		const plan = planInit(new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify(marketplace)
		}));

		assert.equal(Object.keys(plan.writes).length, 0);
		assert.deepEqual(plan.errors, ['marketplace.json plugins must be an array']);
	}
});

test('unreadable marketplace metadata produces an error and zero writes', () => {
	for (const files of [
		{},
		{ '.claude-plugin/marketplace.json': '{ malformed' },
		{ '.claude-plugin/marketplace.json': 'null' }
	] as Record<string, string>[]) {
		const plan = planInit(new MemoryFileSource(files));
		assert.equal(Object.keys(plan.writes).length, 0);
		assert.ok(plan.errors.length > 0);
	}
});

test('remote and missing local metadata do not receive fabricated entries', () => {
	const source = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [
				{ name: 'remote', source: { source: 'github', repo: 'o/r' } },
				{ name: 'missing', source: './plugins/missing' }
			]
		})
	});
	const plan = planInit(source);
	assert.equal('.cc-marketspec/entries/plugin-remote.yaml' in plan.writes, false);
	assert.equal('.cc-marketspec/entries/plugin-missing.yaml' in plan.writes, false);
	assert.ok(plan.warnings.some((warning) => /remote.*remote/i.test(warning)));
	assert.ok(plan.warnings.some((warning) => /missing.*plugin\.json/i.test(warning)));
});

test('local plugin metadata inspection errors block all planned writes', () => {
	const backing = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'p', source: './plugins/p' }]
		})
	});
	const source: FileSource = {
		read: (path) => backing.read(path),
		exists: (path) => {
			if (path === 'plugins/p/.claude-plugin/plugin.json') {
				throw new Error('resolved path escapes marketplace root');
			}
			return backing.exists(path);
		},
		isDir: (path) => backing.isDir(path),
		list: (path) => backing.list(path),
		isSymbolicLink: (path) => backing.isSymbolicLink(path)
	};

	const plan = planInit(source);

	assert.equal(Object.keys(plan.writes).length, 0);
	assert.match(plan.errors.join('\n'), /p:.*inspect.*escapes marketplace root/i);
});

test('every planned target and parent inspection error returns a zero-write plan', () => {
	for (const failingPath of [
		'.cc-marketspec',
		'.cc-marketspec/.gitignore',
		'.cc-marketspec/catalog.yaml',
		'.cc-marketspec/entries',
		'.cc-marketspec/entries/plugin-p.yaml'
	]) {
		const backing = new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({
				name: 'mk',
				plugins: [{ name: 'p', source: './plugins/p' }]
			}),
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' })
		});
		const source: FileSource = {
			read: (path) => backing.read(path),
			exists: (path) => {
				if (path === failingPath) throw new Error(`inspection failed for ${failingPath}`);
				return backing.exists(path);
			},
			isDir: (path) => backing.isDir(path),
			list: (path) => backing.list(path),
			isSymbolicLink: (path) => backing.isSymbolicLink(path)
		};
		let plan: ReturnType<typeof planInit> | undefined;

		assert.doesNotThrow(() => {
			plan = planInit(source);
		}, failingPath);
		assert.equal(Object.keys(plan?.writes ?? {}).length, 0, failingPath);
		assert.match(plan?.errors.join('\n') ?? '', /inspection failed/i, failingPath);
	}
});

test('predictable directory and non-regular target collisions block every planned write', () => {
	for (const files of [
		{ '.cc-marketspec': 'not a directory\n' },
		{ '.cc-marketspec/entries': 'not a directory\n' },
		{ '.cc-marketspec/catalog.yaml/marker': 'directory marker\n' },
		{ '.cc-marketspec/entries/plugin-p.yaml/marker': 'directory marker\n' }
	] as Record<string, string>[]) {
		const plan = planInit(new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({
				name: 'mk',
				plugins: [{ name: 'p', source: './plugins/p' }]
			}),
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
			...files
		}));

		assert.equal(Object.keys(plan.writes).length, 0);
		assert.ok(plan.errors.some((error) => /directory|non-regular/i.test(error)));
	}
});

test('an exact non-regular target blocks every planned write', () => {
	const backing = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] })
	});
	const nonRegularCatalog: FileSource = {
		read: (path) => path === '.cc-marketspec/catalog.yaml' ? null : backing.read(path),
		exists: (path) => path === '.cc-marketspec/catalog.yaml' || backing.exists(path),
		isDir: (path) => backing.isDir(path),
		list: (path) => backing.list(path),
		isSymbolicLink: (path) => backing.isSymbolicLink(path)
	};
	const plan = planInit(nonRegularCatalog);
	assert.equal(Object.keys(plan.writes).length, 0);
	assert.match(plan.errors.join('\n'), /catalog.*non-regular/i);
});

test('existing namespaced catalog must parse and validate before scaffolding', () => {
	for (const catalog of ['schemaVersion: [', 'schemaVersion: "1.1"\nunknown: true\n']) {
		const plan = planInit(new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
			'.cc-marketspec/catalog.yaml': catalog
		}));

		assert.equal(Object.keys(plan.writes).length, 0);
		assert.match(plan.errors.join('\n'), /catalog.*(?:parse|validate)/i);
	}
});

test('existing namespaced catalog must use current schemaVersion 1.1', () => {
	for (const version of ['1.0', '1.2']) {
		const plan = planInit(new MemoryFileSource({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] }),
			'.cc-marketspec/catalog.yaml': `schemaVersion: "${version}"\n`
		}));

		assert.equal(Object.keys(plan.writes).length, 0);
		assert.match(plan.errors.join('\n'), /schemaVersion|format minor/i);
	}
});

test('entry stubs describe the namespaced authoring fields and guide', () => {
	const plan = planInit(new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'p', source: './plugins/p' }]
		}),
		'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' })
	}));
	const stub = plan.writes['.cc-marketspec/entries/plugin-p.yaml'];
	assert.ok(stub);
	for (const field of ['tagline', 'intro', 'group', 'tips', 'traps']) {
		assert.match(stub, new RegExp(`# ${field}:`));
	}
	assert.match(stub, /\.cc-marketspec\/catalog\.yaml/);
	assert.match(stub, /entry-authoring/);
});

test('always returns a CI snippet with read-only and namespaced output guidance', () => {
	const plan = planInit(new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [] })
	}));
	assert.match(plan.ciSnippet, /--check/);
	assert.match(plan.ciSnippet, /\.cc-marketspec\/dist\/manifest\.json/);
});
