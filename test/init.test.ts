import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInit } from '../src/init.ts';
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
	const plan = planInit(source);
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
