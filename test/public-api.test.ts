import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORING, SCHEMAS, VERSION } from '../src/index.ts';

test('public API exposes the generated authoring catalog, schemas, and version', () => {
	assert.ok(Array.isArray(AUTHORING) && AUTHORING.length >= 10, 'AUTHORING catalog');
	for (const key of ['entry', 'catalog', 'manifest'] as const) {
		assert.ok((SCHEMAS[key] as { properties?: object }).properties, `${key} schema has properties`);
	}
	assert.match(VERSION, /^\d+\.\d+\.\d+/);
});
