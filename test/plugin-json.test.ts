// PluginJson schema: shape-only validation of the plugin.json fields the
// generator reads. Every field optional (absence never fails); present fields
// must have the right type; unknown keys pass through.
// Run: node --test test/plugin-json.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginJson } from '../src/plugin-json.ts';

test('empty object is valid (absence never fails)', () => {
	assert.equal(PluginJson.safeParse({}).success, true);
});

test('author as object is valid', () => {
	assert.equal(PluginJson.safeParse({ author: { name: 'X', url: 'https://x' } }).success, true);
});

test('author as string passes the schema (string|object union)', () => {
	// The schema accepts string per npm convention; the generator adds a
	// stricter check on top (Task 2). Here we only assert the schema shape.
	assert.equal(PluginJson.safeParse({ author: 'X' }).success, true);
});

test('keywords as string (not array) fails', () => {
	const r = PluginJson.safeParse({ keywords: 'a' });
	assert.equal(r.success, false);
});

test('version as number (not string) fails', () => {
	assert.equal(PluginJson.safeParse({ version: 1 }).success, false);
});

test('unknown keys pass through (looseObject)', () => {
	const r = PluginJson.safeParse({ name: 'x', futureField: true });
	assert.equal(r.success, true);
});

// Finding #1 guard: dependencies must be array of strings (aligned with manifest)
test('dependencies as string array is valid', () => {
	assert.equal(PluginJson.safeParse({ dependencies: ['foo', 'bar'] }).success, true);
});

test('dependencies as object map fails (manifest expects array, not record)', () => {
	const r = PluginJson.safeParse({ dependencies: { foo: '^1.0.0' } });
	assert.equal(r.success, false);
});

// Finding #2 guard: union fields produce actionable error messages for non-string non-object
test('author as number fails with actionable union message', () => {
	const r = PluginJson.safeParse({ author: 42 });
	assert.equal(r.success, false);
	const msg = r.error?.issues[0]?.message ?? '';
	assert.ok(msg.includes('must be a string or an object'), `expected union hint in: ${msg}`);
});
