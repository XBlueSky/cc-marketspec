// parseAuthoring splits src/authoring.md into sections by the
// "<!-- section: <id> | when: ... -->" marker. Each section carries id, title,
// when (one-line use-case for the MCP list tool), and body markdown.
// Run: node --test test/authoring.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAuthoring } from '../src/authoring.ts';

const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'authoring.md'), 'utf8');
const sections = parseAuthoring(md);

const EXPECTED_IDS = ['overview', 'tagline-intro', 'tips-traps', 'group-ccVersion', 'skills', 'commands', 'agents', 'mcp', 'hooks', 'configuration'];

test('parseAuthoring returns all expected sections in order', () => {
	assert.deepEqual(sections.map((s) => s.id), EXPECTED_IDS);
});

test('every section has non-empty title, when, body', () => {
	for (const s of sections) {
		assert.ok(s.title.length > 0, `${s.id} title`);
		assert.ok(s.when.length > 0, `${s.id} when`);
		assert.ok(s.body.trim().length > 0, `${s.id} body`);
	}
});

test('tips-traps section teaches the 280 limit and object form', () => {
	const tt = sections.find((s) => s.id === 'tips-traps');
	assert.ok(tt, 'tips-traps exists');
	assert.match(tt.body, /280/);
	assert.match(tt.body, /text.*href.*label|href/s);
});

test('parseAuthoring is pure (no marker leakage into body)', () => {
	for (const s of sections) assert.ok(!s.body.includes('<!-- section:'), `${s.id} body has no marker`);
});
