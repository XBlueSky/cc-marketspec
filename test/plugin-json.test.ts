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
