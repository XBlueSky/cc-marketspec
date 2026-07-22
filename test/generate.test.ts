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
const catalog = (body = '') => `schemaVersion: "1.1"\n${body}`;
const entryPath = (id: string) => `.cc-marketspec/entries/plugin-${id}.yaml`;

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
	'.cc-marketspec/catalog.yaml': catalog(),
	'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
	'plugins/sample/hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup' }] } })
};

test('entry hook why attaches to the matching native hook (no error)', () => {
	const { manifest, errors } = run({
		...withHook,
		[entryPath('sample')]: 'hooks:\n  - event: SessionStart\n    matcher: startup\n    why: sets context\n'
	});
	assert.deepEqual(errors, []);
	const hooks = (manifest as { plugins: { hooks?: { event: string; why?: string }[] }[] }).plugins[0].hooks;
	assert.equal(hooks?.[0].why, 'sets context');
});

test('entry hook for a non-existent native event/matcher is a referential error', () => {
	const { errors } = run({
		...withHook,
		[entryPath('sample')]: 'hooks:\n  - event: Stop\n    why: ghost\n'
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
		'.cc-marketspec/catalog.yaml': catalog('coverage:\n  skill.trigger: error\n'),
		'plugins/p/.claude-plugin/plugin.json': plugin({ name: 'p', version: '1.0.0' }),
		'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n'
	});
	assert.ok(errors.some((e) => e.includes('skill.trigger')));
});

for (const [label, groups] of [
	['omitted', ''],
	['empty', 'groups: []\n']
] as const) {
	test(`entry group is rejected when catalog groups is ${label}`, () => {
		const { errors } = run({
			'.claude-plugin/marketplace.json': market({ name: 'p', source: './plugins/p' }),
			'.cc-marketspec/catalog.yaml': catalog(groups),
			'.cc-marketspec/entries/plugin-p.yaml': 'group: build\n',
			'plugins/p/.claude-plugin/plugin.json': plugin({ name: 'p', version: '1.0.0' })
		});
		assert.ok(
			errors.some((error) => /plugin-p\.yaml: group "build" not declared.*catalog\.yaml.*groups\[\]/i.test(error)),
			`expected missing group declaration error, got: ${errors.join(' | ')}`
		);
	});
}

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

// ---- arbitrary plugin source (root-level & non-plugins/ layouts) -----------

test('resolves a root-level plugin (source: "./") and derives its components', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'cortex', source: './' }),
		'.claude-plugin/plugin.json': plugin({ name: 'cortex', version: '1.0.0' }),
		'skills/using-cortex/SKILL.md': '---\nname: using-cortex\ndescription: use it\n---\nbody',
		'commands/distill.md': '---\nname: distill\ndescription: Distill notes.\n---\nbody',
		'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup' }] } })
	});
	assert.deepEqual(errors, []);
	const plugins = (manifest as { plugins: { id: string; skills: unknown[]; commands: unknown[]; hooks: unknown[] }[] }).plugins;
	assert.equal(plugins.length, 1);
	assert.equal(plugins[0].id, 'cortex');
	assert.equal(plugins[0].skills.length, 1);
	assert.equal(plugins[0].commands.length, 1);
	assert.equal(plugins[0].hooks.length, 1);
});

test('resolves a plugin at an arbitrary non-plugins/ path', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'bar', source: './packages/bar' }),
		'packages/bar/.claude-plugin/plugin.json': plugin({ name: 'bar', version: '2.0.0' })
	});
	assert.deepEqual(errors, []);
	const plugins = (manifest as { plugins: { id: string; version: string }[] }).plugins;
	assert.equal(plugins.length, 1);
	assert.equal(plugins[0].id, 'bar');
	assert.equal(plugins[0].version, '2.0.0');
});

test('an entry with no source falls back to plugins/<name> (back-compat)', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'legacy' }),
		'plugins/legacy/.claude-plugin/plugin.json': plugin({ name: 'legacy', version: '1.0.0' })
	});
	assert.deepEqual(errors, []);
	assert.equal((manifest as { plugins: { id: string }[] }).plugins[0].id, 'legacy');
});

test('plugin.json name mismatching the marketplace entry name is an error', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'cortex', source: './' }),
		'.claude-plugin/plugin.json': plugin({ name: 'not-cortex', version: '1.0.0' })
	});
	assert.equal(errors.some((e) => /name/.test(e) && /cortex/.test(e)), true, `expected a name-mismatch error, got: ${JSON.stringify(errors)}`);
});

test('a nameless+sourceless entry yields an error, not an uncaught throw', () => {
	let result: { errors: string[]; manifest: unknown } | undefined;
	assert.doesNotThrow(() => {
		result = run({
			'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [{}] })
		});
	}, 'generateManifest must not throw on a {} entry');
	assert.ok(result!.errors.some((e) => /missing "name"/.test(e)), `expected a missing-name error, got: ${JSON.stringify(result!.errors)}`);
});

test('an entry with source but no name is reported, not silently dropped', () => {
	const { errors } = run({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [{ source: './plugins/foo' }] }),
		'plugins/foo/.claude-plugin/plugin.json': plugin({ name: 'foo', version: '1.0.0' })
	});
	assert.ok(errors.some((e) => /missing "name"/.test(e) && /plugins\/foo/.test(e)), `expected a missing-name error naming the source, got: ${JSON.stringify(errors)}`);
});

// ---- layout, version, and deterministic output ------------------------------

test('native-only generation uses current 1.1 without authoring files', () => {
	const { manifest, errors, layout } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' })
	});
	assert.deepEqual(errors, []);
	assert.equal(layout, 'fresh');
	assert.equal((manifest as { schemaVersion: string }).schemaVersion, '1.1');
});

test('namespaced layout ignores unrelated generic root files', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		'.cc-marketspec/catalog.yaml': catalog('lang: en\n'),
		[entryPath('sample')]: 'tagline: Namespaced value\n',
		'catalog.yaml': 'not: ours\n',
		'plugins/sample/entry.yaml': 'not: ours\n',
		'manifest.json': '{"ownedBy":"another-tool"}'
	});
	assert.deepEqual(errors, []);
	assert.equal((manifest as { plugins: { tagline?: string }[] }).plugins[0].tagline, 'Namespaced value');
});

test('strong legacy 1.0 remains readable with a migration warning', () => {
	const { manifest, errors, warnings, layout } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		'catalog.yaml': 'schemaVersion: "1.0"\n',
		'plugins/sample/entry.yaml': 'tagline: Legacy value\n'
	});
	assert.deepEqual(errors, []);
	assert.equal(layout, 'legacy');
	assert.equal((manifest as { schemaVersion: string }).schemaVersion, '1.0');
	assert.ok(warnings.some((warning) => /migrate/i.test(warning)));
});

test('catalog-only legacy input is ambiguous and not silently read', () => {
	const { errors, layout } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		'catalog.yaml': 'schemaVersion: "1.0"\n'
	});
	assert.equal(layout, 'ambiguous');
	assert.ok(errors.some((error) => /--from legacy/i.test(error)));
});

test('rejects syntactically valid but unsupported format versions', () => {
	for (const version of ['1.0', '1.99', '2.0']) {
		const { errors } = run({
			'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
			'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
			'.cc-marketspec/catalog.yaml': `schemaVersion: "${version}"\n`
		});
		assert.ok(errors.some((error) => error.includes(version)), `missing error for ${version}`);
	}
});

test('reports remote plugin discovery instead of silently dropping it', () => {
	const { errors, manifest } = run({
		'.claude-plugin/marketplace.json': market({
			name: 'remote',
			source: { source: 'github', repo: 'owner/repo' }
		})
	});
	assert.ok(errors.some((error) => /remote.*cannot inspect|cannot inspect.*remote/i.test(error)));
	assert.deepEqual((manifest as { plugins: unknown[] }).plugins, []);
});

test('diagnostics and discovered component arrays are deterministic', () => {
	const files = {
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		'plugins/sample/skills/zeta/SKILL.md': '---\nname: zeta\ndescription: z\n---\n',
		'plugins/sample/skills/alpha/SKILL.md': '---\nname: alpha\ndescription: a\n---\n'
	};
	const reversed = Object.fromEntries(Object.entries(files).reverse());
	const left = run(files);
	const right = run(reversed);
	assert.equal(JSON.stringify(left.manifest), JSON.stringify(right.manifest));
	assert.deepEqual(left.errors, right.errors);
	assert.deepEqual(left.warnings, right.warnings);
	assert.deepEqual(
		(left.manifest as { plugins: { skills: { name: string }[] }[] }).plugins[0].skills.map((skill) => skill.name),
		['alpha', 'zeta']
	);
});

test('malformed catalog YAML is a canonical error and keeps native plugins', () => {
	let result: ReturnType<typeof run> | undefined;
	assert.doesNotThrow(() => {
		result = run({
			'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
			'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
			'.cc-marketspec/catalog.yaml': 'schemaVersion: [unterminated\n',
			[entryPath('sample')]: 'tagline: Must not apply\n'
		});
	});
	assert.equal(result!.layout, 'namespaced');
	assert.ok(result!.errors.some((error) => /^\.cc-marketspec\/catalog\.yaml:.*parse/i.test(error)), result!.errors.join(' | '));
	const generated = result!.manifest as { schemaVersion: string; plugins: { id: string; tagline?: string }[] };
	assert.equal(generated.schemaVersion, '1.1');
	assert.deepEqual(generated.plugins.map(({ id }) => id), ['sample']);
	assert.equal(generated.plugins[0].tagline, undefined);
});

test('malformed entry YAML skips only the overlay and keeps the native plugin', () => {
	let result: ReturnType<typeof run> | undefined;
	assert.doesNotThrow(() => {
		result = run({
			'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
			'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
			'.cc-marketspec/catalog.yaml': catalog(),
			[entryPath('sample')]: 'tagline: [unterminated\n'
		});
	});
	assert.ok(result!.errors.some((error) => /^\.cc-marketspec\/entries\/plugin-sample\.yaml:.*parse/i.test(error)), result!.errors.join(' | '));
	const plugins = (result!.manifest as { plugins: { id: string; tagline?: string }[] }).plugins;
	assert.deepEqual(plugins.map(({ id }) => id), ['sample']);
	assert.equal(plugins[0].tagline, undefined);
});

test('an entry without its required catalog is not applied to the native manifest', () => {
	const { manifest, errors, layout } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		[entryPath('sample')]: 'tagline: Must not apply\n'
	});
	assert.equal(layout, 'namespaced');
	assert.ok(errors.some((error) => /^\.cc-marketspec\/catalog\.yaml:.*required/i.test(error)), errors.join(' | '));
	const generated = manifest as { schemaVersion: string; plugins: { id: string; tagline?: string }[] };
	assert.equal(generated.schemaVersion, '1.1');
	assert.deepEqual(generated.plugins.map(({ id }) => id), ['sample']);
	assert.equal(generated.plugins[0].tagline, undefined);
});

test('an entry under a future catalog is not relabeled or applied as current data', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market({ name: 'sample', source: './plugins/sample' }),
		'plugins/sample/.claude-plugin/plugin.json': plugin({ name: 'sample', version: '1.0.0' }),
		'.cc-marketspec/catalog.yaml': 'schemaVersion: "2.0"\n',
		[entryPath('sample')]: 'tagline: Future value\n'
	});
	assert.ok(errors.some((error) => /schemaVersion 2\.0/i.test(error)), errors.join(' | '));
	const generated = manifest as { schemaVersion: string; plugins: { id: string; tagline?: string }[] };
	assert.equal(generated.schemaVersion, '1.1');
	assert.deepEqual(generated.plugins.map(({ id }) => id), ['sample']);
	assert.equal(generated.plugins[0].tagline, undefined);
});

test('non-object marketplace JSON values are explicit malformed-content errors', () => {
	for (const value of [null, false, 0, '', []]) {
		let result: ReturnType<typeof run> | undefined;
		assert.doesNotThrow(() => {
			result = run({ '.claude-plugin/marketplace.json': JSON.stringify(value) });
		}, `must not throw for ${JSON.stringify(value)}`);
		assert.equal(result!.layout, 'fresh');
		assert.deepEqual(result!.manifest, {});
		assert.ok(
			result!.errors.some((error) => /^\.claude-plugin\/marketplace\.json:.*object/i.test(error)),
			`missing malformed-content error for ${JSON.stringify(value)}: ${result!.errors.join(' | ')}`
		);
	}
});

test('preserves authored marketplace, group, and entry intent-array order', () => {
	const { manifest, errors } = run({
		'.claude-plugin/marketplace.json': market(
			{ name: 'zeta', source: './plugins/zeta' },
			{ name: 'alpha', source: './plugins/alpha' }
		),
		'plugins/zeta/.claude-plugin/plugin.json': plugin({ name: 'zeta', version: '1.0.0' }),
		'plugins/alpha/.claude-plugin/plugin.json': plugin({ name: 'alpha', version: '1.0.0' }),
		'.cc-marketspec/catalog.yaml': catalog(
			'groups:\n  - id: second\n    label: Second\n  - id: first\n    label: First\n'
		),
		[entryPath('zeta')]: 'tips:\n  - Second intent\n  - First intent\n'
	});
	assert.deepEqual(errors, []);
	const generated = manifest as {
		groups: { id: string }[];
		plugins: { id: string; tips?: { text: string }[] }[];
	};
	assert.deepEqual(generated.plugins.map(({ id }) => id), ['zeta', 'alpha']);
	assert.deepEqual(generated.groups.map(({ id }) => id), ['second', 'first']);
	assert.deepEqual(generated.plugins[0].tips?.map(({ text }) => text), ['Second intent', 'First intent']);
});

test('sorts and deduplicates repeated diagnostics while reporting missing local data', () => {
	const { errors, warnings } = run({
		'.claude-plugin/marketplace.json': market(
			{ name: 'zeta' },
			{ name: 'alpha' },
			{ name: 'alpha' }
		)
	});
	assert.deepEqual(errors, [
		'alpha: local source is missing .claude-plugin/plugin.json at plugins/alpha',
		'duplicate plugin id "alpha"',
		'zeta: local source is missing .claude-plugin/plugin.json at plugins/zeta'
	]);
	assert.deepEqual(warnings, [
		'alpha: implicit plugins/alpha source is deprecated; add source: "./plugins/alpha"',
		'zeta: implicit plugins/zeta source is deprecated; add source: "./plugins/zeta"'
	]);
	assert.equal(new Set(errors).size, errors.length);
	assert.equal(new Set(warnings).size, warnings.length);
});
