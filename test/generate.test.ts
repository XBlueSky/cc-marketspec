// Generator (generateManifest) behaviour tests. Each test builds an in-memory
// MemoryFileSource, runs the generator, and asserts on the joined + derived
// manifest. Covers derivation and the referential-integrity checks that live
// in generator code (not in the declarative schema).
// Run: node --test test/generate.test.ts   (Node >=23 strips TS types)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateManifest } from '../src/generate.ts';
import { MemoryFileSource } from '../src/fs-source.ts';

const market = (...plugins: Record<string, unknown>[]) => JSON.stringify({ name: 'mk', plugins });
const plugin = (o: Record<string, unknown>) => JSON.stringify(o);

function run(files: Record<string, string>) {
	return generateManifest(new MemoryFileSource(files));
}

// ---- native category derivation ---------------------------------------------

test('derives plugin.category from marketplace.json entry category', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample', category: 'development' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' })
	});
	assert.deepEqual(errors, []);
	assert.equal((manifest as { plugins: { category?: string }[] }).plugins[0].category, 'development');
});

test('omits category when marketplace entry has none', () => {
	const { manifest } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' })
	});
	assert.equal('category' in (manifest as { plugins: object[] }).plugins[0], false);
});

// ---- hook referential integrity ---------------------------------------------

const withHook = {
	'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
	'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
	'plugins/sample/hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup' }] } })
};

test('entry hook why attaches to the matching native hook (no error)', () => {
	const { manifest, errors } = run({
		...withHook,
		'plugins/sample/entry.yaml': 'hooks:\n  - event: SessionStart\n    matcher: startup\n    why: sets context\n'
	});
	assert.deepEqual(errors, []);
	const hooks = (manifest as { plugins: { hooks?: { event: string; why?: string }[] }[] }).plugins[0].hooks;
	assert.equal(hooks?.[0].why, 'sets context');
});

test('entry hook for a non-existent native event/matcher is a referential error', () => {
	const { errors } = run({
		...withHook,
		'plugins/sample/entry.yaml': 'hooks:\n  - event: Stop\n    why: ghost\n'
	});
	assert.equal(errors.some((e) => /hook/i.test(e) && /Stop/.test(e)), true, `expected a phantom-hook error, got: ${JSON.stringify(errors)}`);
});

// ---- robustness: malformed input is a clean error, never a thrown crash ------

test('missing marketplace.json yields an error instead of throwing', () => {
	let result: { errors: string[] } | undefined;
	assert.doesNotThrow(() => {
		result = run({ 'README.md': 'not a marketplace' });
	}, 'should not throw when marketplace.json is absent');
	assert.ok(
		result!.errors.some((e) => /marketplace\.json/i.test(e)),
		`expected a marketplace.json error, got: ${JSON.stringify(result?.errors)}`
	);
});

test('malformed marketplace.json yields an error instead of throwing', () => {
	let result: { errors: string[] } | undefined;
	assert.doesNotThrow(() => {
		result = run({ '.claude-plugin/marketplace.json': '{ this is not json' });
	}, 'should not throw on invalid JSON');
	assert.ok(result!.errors.length > 0, 'expected at least one error');
});

test('a malformed plugin.json is reported per-plugin, not a crash', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': '{ broken'
	});
	assert.ok(errors.some((e) => /sample/.test(e)), `expected a per-plugin error, got: ${JSON.stringify(errors)}`);
});

// ---- coverage integration ----------------------------------------------------

test('coverage: warns on a skill with no trigger', () => {
	const { warnings } = run({
		'.claude-plugin/marketplace.json': market({ name: 'p', source: './plugins/p' }),
		'plugins/p/.claude-plugin/plugin.json': plugin({ name: 'p', version: '1.0.0' }),
		'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n'
	});
	assert.ok(warnings.some((w) => w.includes('skill.trigger')));
});

test('coverage: catalog can promote skill.trigger to a build error', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'p', source: './plugins/p' }),
		'catalog.yaml': 'schemaVersion: "1.0"\ncoverage:\n  skill.trigger: error\n',
		'plugins/p/.claude-plugin/plugin.json': plugin({ name: 'p', version: '1.0.0' }),
		'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n'
	});
	assert.ok(errors.some((e) => e.includes('skill.trigger')));
});

// ---- plugin.json shape validation -------------------------------------------

test('author as a string is an error (Claude Code rejects string authors)', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0', author: 'XBlueSky' })
	});
	assert.ok(errors.some((e) => e.includes('author must be an object')), `expected author error, got: ${errors.join(' | ')}`);
});

test('author as an object is accepted', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0', author: { name: 'XBlueSky', url: 'https://github.com/XBlueSky' } })
	});
	assert.equal(errors.filter((e) => e.includes('plugin.json')).length, 0, errors.join(' | '));
});

test('keywords as a string (wrong shape) is an error', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0', keywords: 'oops' })
	});
	assert.ok(errors.some((e) => e.includes('sample/plugin.json:')), `expected shape error, got: ${errors.join(' | ')}`);
});

test('missing optional fields do NOT produce shape errors (only shape, not presence)', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample' })  // no version/author/keywords
	});
	assert.equal(errors.filter((e) => e.includes('plugin.json:')).length, 0, errors.join(' | '));
});
