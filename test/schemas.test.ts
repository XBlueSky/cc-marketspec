// Shape-coverage + constraint regression tests for the marketplace presentation
// schemas. Exercises every in-scope branch (positive) and the key guards
// (negative), so the contract is proven shape-complete before extraction.
// Run: node --test test/schemas.test.ts   (Node >=23 strips TS types)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Entry } from '../src/entry.ts';
import { Catalog } from '../src/catalog.ts';
import { Manifest } from '../src/manifest.ts';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown, msg: string) =>
	assert.equal(schema.safeParse(v).success, true, msg);
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown, msg: string) =>
	assert.equal(schema.safeParse(v).success, false, msg);

// ---- catalog ----------------------------------------------------------------

test('catalog schema validates MAJOR.MINOR shape while runtime owns compatibility', () => {
	ok(Catalog, { schemaVersion: '1.1' }, 'current syntax');
	ok(Catalog, { schemaVersion: '99.99' }, 'shape only; version.ts rejects unsupported compatibility');
	bad(Catalog, { schemaVersion: '1.1.0' }, 'format versions are not SemVer');
});
test('catalog and manifest describe format compatibility independently of package SemVer', () => {
	const description = 'MAJOR.MINOR format compatibility version. This is not package SemVer; runtime compatibility is enforced by version.ts.';
	assert.equal(Catalog.shape.schemaVersion.description, description);
	assert.equal(Manifest.shape.schemaVersion.description, description);
});
test('catalog: full with groups', () =>
	ok(
		Catalog,
		{ schemaVersion: '1.1', lang: 'zh-TW', groups: [{ id: 'build', label: 'Build', note: '…' }] },
		'full'
	));
test('catalog: group id pattern', () => bad(Catalog, { schemaVersion: '1.1', groups: [{ id: 'Bad ID', label: 'x' }] }, 'bad id'));

test('catalog: valid coverage block parses', () => {
	const r = Catalog.safeParse({ schemaVersion: '1.1', coverage: { 'skill.trigger': 'error', '*': 'off' } });
	assert.equal(r.success, true);
});

test('catalog: unknown coverage rule path rejected', () => {
	const r = Catalog.safeParse({ schemaVersion: '1.1', coverage: { 'skill.bogus': 'warn' } });
	assert.equal(r.success, false);
});

test('catalog: bad severity rejected', () => {
	const r = Catalog.safeParse({ schemaVersion: '1.1', coverage: { 'skill.trigger': 'loud' } });
	assert.equal(r.success, false);
});

// ---- entry: maximal (exercise EVERY in-scope branch) ------------------------

const maximalEntry = {
	group: 'debug',
	tagline: 'one-liner',
	intro: 'a full lede',
	ccVersion: '2.1.143',
	skills: [
		{ name: 'a-skill', description: 'd', trigger: 'when', examples: ['say this', 'or this'], href: 'https://x', label: 'more' }
	],
	commands: [{ name: 'a-cmd', description: 'd', examples: ['/a-cmd x'] }],
	agents: [{ name: 'an-agent', returns: 'r', not: 'n', description: 'd', examples: ['dispatch it'] }],
	mcp: [
		{
			name: 'a-server',
			install: true,
			auth: 'token',
			repo: 'https://x',
			env: [{ key: 'A_TOKEN', value: 'the token', secret: true }],
			setup: [{ text: 'step', cmd: 'do x', href: 'https://x', label: 'guide' }],
			description: 'role',
			provides: ['tool_one', 'tool_two'],
			config: [{ key: 'k', value: 'v' }]
		}
	],
	hooks: [{ event: 'SessionStart', matcher: 'startup', why: 'sets context' }],
	configuration: [
		{ key: 'enabled', type: 'boolean', default: true, description: 'on/off', required: false },
		{ key: 'level', type: 'string', default: 'standard', description: 'mode' },
		{ key: 'retries', type: 'number', description: 'count' },
		{ key: 'globs', type: 'array', description: 'paths' }
	],
	tips: ['a string tip', { text: 'a linked tip', href: 'https://x', label: 'docs' }],
	traps: ['a gotcha']
};

test('entry: maximal exercises every branch', () => ok(Entry, maximalEntry, 'maximal'));
test('entry: empty is valid (all optional)', () => ok(Entry, {}, 'empty'));
test('entry group description names the canonical catalog path', () => {
	assert.equal(
		Entry.shape.group.unwrap().description,
		'id of a .cc-marketspec/catalog.yaml group (authored). Native classification is surfaced separately as the manifest category.'
	);
});
// v1 is strict on both layers (no extension hatch yet); x-* is a future MINOR.
test('entry: unknown x- key rejected in v1 (strict)', () => bad(Entry, { 'x-team': 'platform' }, 'no x- in v1'));

// ---- entry: negatives (guards) ----------------------------------------------

test('entry: tagline > 120 rejected', () => bad(Entry, { tagline: 'x'.repeat(121) }, 'tagline cap'));
test('entry: skill without name rejected', () => bad(Entry, { skills: [{ description: 'no name' }] }, 'skill join key'));
test('entry: unknown top-level prop rejected', () => bad(Entry, { bogus: 1 }, 'additionalProperties'));
test('entry: bad mcp auth enum rejected', () => bad(Entry, { mcp: [{ name: 'm', auth: 'basic' }] }, 'auth enum'));
test('entry: bad configuration type enum rejected', () => bad(Entry, { configuration: [{ key: 'k', type: 'date', description: 'd' }] }, 'config type'));
test('entry: bad hook event enum rejected', () => bad(Entry, { hooks: [{ event: 'OnBoot' }] }, 'hook event'));
test('entry: >5 examples rejected', () => bad(Entry, { skills: [{ name: 'a', examples: ['1', '2', '3', '4', '5', '6'] }] }, 'examples cap'));
test('entry: bad ccVersion rejected', () => bad(Entry, { ccVersion: '2.1' }, 'ccVersion semver'));
test('entry: env key pattern enforced', () => bad(Entry, { mcp: [{ name: 'm', env: [{ key: '1bad', value: 'v' }] }] }, 'env key'));

// ---- manifest (consumer API) ------------------------------------------------

test('manifest current fixture carries format 1.1', () =>
	ok(Manifest, { schemaVersion: '1.1', marketplace: { name: 'mk' }, plugins: [] }, 'current manifest'));
test('manifest: plugin carries derived native category', () =>
	ok(
		Manifest,
		{ schemaVersion: '1.1', marketplace: { name: 'mk' }, plugins: [{ id: 'p', name: 'p', version: '1.0.0', category: 'development' }] },
		'native category'
	));
test('manifest: skill requires derived autoload', () =>
	bad(
		Manifest,
		{ schemaVersion: '1.1', marketplace: { name: 'mk' }, plugins: [{ id: 'p', name: 'p', version: '1.0.0', skills: [{ name: 's' }] }] },
		'autoload required'
	));
test('manifest: full plugin shape', () =>
	ok(
		Manifest,
		{
			schemaVersion: '1.1',
			marketplace: { name: 'mk', owner: { name: 'o' } },
			groups: [{ id: 'debug', label: 'Debug' }],
			plugins: [
				{
					id: 'p',
					name: 'p',
					version: '1.0.0',
					group: 'debug',
					skills: [{ name: 's', autoload: false, resources: { references: 2 } }],
					commands: [{ name: 'c', arguments: [{ name: 'x', required: true }] }],
					agents: [{ name: 'a', tools: ['Read'] }],
					mcp: [{ name: 'm', type: 'stdio' }],
					hooks: [{ event: 'SessionStart' }],
					tips: [{ text: 't' }]
				}
			]
		},
		'full manifest'
	));
