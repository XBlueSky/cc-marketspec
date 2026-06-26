// test/init.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInit } from '../src/init.ts';
import { MemoryFileSource } from '../src/fs-source.ts';

test('creates catalog.yaml when absent', () => {
	const s = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'p', plugins: [] })
	});
	const { writes, actions } = planInit(s);
	assert.ok('catalog.yaml' in writes);
	assert.ok(actions.some((a) => a.path === 'catalog.yaml' && a.status === 'created'));
});

test('skips catalog.yaml when present (non-destructive)', () => {
	const s = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'p', plugins: [] }),
		'catalog.yaml': 'schemaVersion: "1.0"\n'
	});
	const { writes, actions } = planInit(s);
	assert.ok(!('catalog.yaml' in writes));
	assert.ok(actions.some((a) => a.path === 'catalog.yaml' && a.status === 'skipped'));
});

test('scaffolds entry.yaml only for plugins lacking one', () => {
	const s = new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'p', plugins: [{ name: 'a', source: './plugins/a' }, { name: 'b', source: './plugins/b' }] }),
		'plugins/a/.claude-plugin/plugin.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
		'plugins/b/.claude-plugin/plugin.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
		'plugins/b/entry.yaml': 'tagline: existing\n'
	});
	const { writes } = planInit(s);
	assert.ok('plugins/a/entry.yaml' in writes);
	assert.ok(!('plugins/b/entry.yaml' in writes));
});

test('always returns a CI snippet mentioning --check', () => {
	const s = new MemoryFileSource({ '.claude-plugin/marketplace.json': JSON.stringify({ name: 'p', plugins: [] }) });
	assert.ok(planInit(s).ciSnippet.includes('--check'));
});

test('entry.yaml stub scaffolds the main fields as commented TODOs with a guide pointer', () => {
	const { writes } = planInit(new MemoryFileSource({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [{ name: 'p', source: './plugins/p' }] }),
		'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0', author: { name: 'x' } })
	}));
	const stub = writes['plugins/p/entry.yaml'];
	assert.ok(stub, 'stub written');
	for (const f of ['tagline', 'intro', 'group', 'tips', 'traps']) assert.match(stub, new RegExp(`# ${f}:`));
	assert.match(stub, /list_authoring_sections|entry-authoring/);
});
