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
