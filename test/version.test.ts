import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CURRENT_FORMAT_VERSION,
	LEGACY_FORMAT_VERSION,
	checkFormatVersion
} from '../src/version.ts';

test('declares legacy 1.0 and current 1.1 independently of package SemVer', () => {
	assert.equal(LEGACY_FORMAT_VERSION, '1.0');
	assert.equal(CURRENT_FORMAT_VERSION, '1.1');
});

test('accepts the version matching its authored layout', () => {
	assert.deepEqual(checkFormatVersion('1.1', 'namespaced'), {
		ok: true,
		version: '1.1'
	});
	const legacy = checkFormatVersion('1.0', 'legacy');
	assert.equal(legacy.ok, true);
	if (legacy.ok) assert.match(legacy.warning ?? '', /deprecated|migrate/i);
});

for (const [value, layout, message] of [
	['1.0', 'namespaced', 'requires schemaVersion 1.1'],
	['1.1', 'legacy', 'requires schemaVersion 1.0'],
	['0.9', 'legacy', 'unsupported format major 0'],
	['1.99', 'namespaced', 'future format minor 99'],
	['2.0', 'namespaced', 'unsupported format major 2'],
	['1.0.0', 'namespaced', 'MAJOR.MINOR']
] as const) {
	test(`rejects ${value} for ${layout}`, () => {
		const result = checkFormatVersion(value, layout);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, new RegExp(message.replace(/[.]/g, '\\.'), 'i'));
	});
}

test('rejects non-string versions', () => {
	const result = checkFormatVersion(1.1, 'namespaced');
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.error, /string.*MAJOR\.MINOR/i);
});
