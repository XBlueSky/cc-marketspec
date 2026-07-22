import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CURRENT_FORMAT_VERSION,
	LEGACY_FORMAT_VERSION,
	checkFormatVersion,
	checkManifestFormatVersion
} from '../src/version.ts';
import { checkManifestFormatVersion as publicCheckManifestFormatVersion } from '../src/index.ts';

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

test('manifest compatibility accepts supported legacy and current versions', () => {
	const legacy = checkManifestFormatVersion('1.0');
	assert.equal(legacy.ok, true);
	if (legacy.ok) assert.match(legacy.warning ?? '', /deprecated/i);
	assert.deepEqual(checkManifestFormatVersion('1.1'), { ok: true, version: '1.1' });
});

for (const [label, value, message] of [
	['future minor 1.99', '1.99', /future format minor 99/i],
	['unsupported major 2.0', '2.0', /unsupported format major 2/i],
	['bad syntax', 'bad', /MAJOR\.MINOR/i],
	['non-string number', 1.1, /string.*MAJOR\.MINOR/i]
] as const) {
	test(`manifest compatibility rejects ${label}`, () => {
		const result = checkManifestFormatVersion(value);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, message);
	});
}

test('public barrel exports the manifest compatibility checker', () => {
	assert.equal(publicCheckManifestFormatVersion, checkManifestFormatVersion);
});
