import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSchema, checkCoverage, scaffoldEntry, listAuthoringSections, getAuthoringGuide, callTool, TOOLS, createMcpServer, listResources, readResource } from '../src/mcp.ts';
import { SCHEMAS, VERSION } from '../src/schemas.generated.ts';

test('getSchema returns the entry JSON schema object', () => {
	const s = getSchema('entry') as { $schema?: string; properties?: object };
	assert.ok(s.properties);
});

test('checkCoverage runs the core over pasted file contents', () => {
	const report = checkCoverage({
		pluginId: 'p',
		files: {
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
			'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n'
		}
	});
	assert.ok(report.findings.some((f) => f.ruleId === 'skill.trigger'));
});

test('checkCoverage sets needsMoreWork true when findings remain', () => {
	const r = checkCoverage({
		pluginId: 'sample',
		files: {
			'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({ name: 'sample', version: '1.0.0', author: { name: 'x' } }),
			'plugins/sample/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\nbody'
		}
	}) as { needsMoreWork: boolean; findings: unknown[] };
	// a bare skill with no entry.yaml overlay yields coverage findings
	assert.equal(typeof r.needsMoreWork, 'boolean');
	assert.equal(r.needsMoreWork, r.findings.length > 0);
});

test('scaffoldEntry emits a YAML skeleton mentioning the plugin', () => {
	const yaml = scaffoldEntry({
		pluginId: 'p',
		files: { 'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }) }
	});
	assert.ok(yaml.includes('p'));
});

test('listAuthoringSections returns the catalog with id/title/when, no body', () => {
	const list = listAuthoringSections();
	assert.ok(list.length >= 10, 'has all sections');
	for (const s of list) {
		assert.ok(s.id && s.title && s.when, 'each has id/title/when');
		assert.equal((s as Record<string, unknown>).body, undefined, 'no body in the cheap catalog');
	}
});

test('getAuthoringGuide returns full body for a known section', () => {
	const r = getAuthoringGuide('tips-traps');
	assert.ok(r.body && r.body.length > 0, 'has body');
	assert.match(r.body, /280/);
});

test('getAuthoringGuide on unknown section returns an error listing available ids', () => {
	const r = getAuthoringGuide('nope');
	assert.ok(r.error, 'has error');
	assert.ok(Array.isArray(r.available) && r.available.includes('tips-traps'), 'lists available');
});

test('TOOLS no longer includes explain_field; includes the two authoring tools', () => {
	const names = TOOLS.map((t) => t.name);
	assert.ok(!names.includes('explain_field'), 'explain_field removed');
	assert.ok(names.includes('list_authoring_sections'));
	assert.ok(names.includes('get_authoring_guide'));
});

test('callTool wraps a thrown handler error (malformed namespaced entry) as a structured error', () => {
	const res = callTool('check_coverage', {
		pluginId: 'p',
		files: {
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
			// Invalid YAML — unclosed flow mapping forces yaml.load to throw.
			'.cc-marketspec/entries/plugin-p.yaml': 'tagline: "unterminated\n  skills: [a, b'
		}
	});
	const payload = JSON.parse(res.content[0].text) as { error?: string };
	assert.equal(typeof payload.error, 'string');
	assert.ok((payload.error as string).length > 0);
});


test('createMcpServer builds a server without needing a transport', () => {
	const server = createMcpServer();
	assert.ok(server);
	assert.equal(typeof server.connect, 'function');
});

test('listResources exposes the three schema URIs', () => {
	const uris = listResources().map((r) => r.uri).sort();
	assert.deepEqual(uris, ['cc-marketspec://schema/catalog', 'cc-marketspec://schema/entry', 'cc-marketspec://schema/manifest']);
});

test('readResource returns the entry schema JSON for its URI', () => {
	const r = readResource('cc-marketspec://schema/entry');
	assert.equal(r.mimeType, 'application/json');
	const parsed = JSON.parse(r.text);
	assert.equal(typeof parsed, 'object');
	assert.ok(parsed.properties, 'looks like a JSON schema');
});

test('readResource throws on unknown URI', () => {
	assert.throws(() => readResource('cc-marketspec://schema/nope'));
});

test('inlined SCHEMAS match the committed JSON and getSchema is fs-free', () => {
	for (const name of ['entry', 'catalog', 'manifest'] as const) {
		const onDisk = JSON.parse(readFileSync(fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url)), 'utf8'));
		assert.deepEqual(getSchema(name), onDisk);
		assert.deepEqual(SCHEMAS[name], onDisk);
	}
	assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('checkCoverage reads the canonical namespaced entry path', () => {
	const report = checkCoverage({
		pluginId: 'p',
		files: {
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
			'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: hi\n---\n',
			'.cc-marketspec/entries/plugin-p.yaml': 'skills:\n  - name: greet\n    trigger: when greeting\n'
		}
	});
	assert.equal(report.findings.some((finding) => finding.ruleId === 'skill.trigger'), false);
});

test('scaffoldEntry labels the canonical destination', () => {
	const body = scaffoldEntry({
		pluginId: 'con',
		files: { 'plugins/con/.claude-plugin/plugin.json': JSON.stringify({ name: 'con' }) }
	});
	assert.match(body, /^# \.cc-marketspec\/entries\/plugin-con\.yaml/m);
});

test('MCP preserves exactly five hosted tools and canonical pasted-file guidance', () => {
	assert.equal(TOOLS.length, 5);
	assert.deepEqual(TOOLS.map((tool) => tool.name), [
		'get_schema',
		'list_authoring_sections',
		'get_authoring_guide',
		'check_coverage',
		'scaffold_entry'
	]);
	for (const tool of TOOLS.filter(({ name }) => name === 'check_coverage' || name === 'scaffold_entry')) {
		assert.match(tool.description, /\.cc-marketspec\/entries\/plugin-<id>\.yaml/);
		assert.deepEqual(tool.inputSchema.properties.files, {
			type: 'object',
			additionalProperties: { type: 'string' }
		});
	}
});

test('MCP public tool input schemas remain transport-compatible', () => {
	assert.deepEqual(Object.fromEntries(TOOLS.map(({ name, inputSchema }) => [name, inputSchema])), {
		get_schema: {
			type: 'object',
			properties: { which: { type: 'string', enum: ['entry', 'catalog', 'manifest'] } },
			required: ['which']
		},
		list_authoring_sections: {
			type: 'object',
			properties: {}
		},
		get_authoring_guide: {
			type: 'object',
			properties: { section: { type: 'string' } },
			required: ['section']
		},
		check_coverage: {
			type: 'object',
			properties: { pluginId: { type: 'string' }, files: { type: 'object', additionalProperties: { type: 'string' } } },
			required: ['pluginId', 'files']
		},
		scaffold_entry: {
			type: 'object',
			properties: { pluginId: { type: 'string' }, files: { type: 'object', additionalProperties: { type: 'string' } } },
			required: ['pluginId', 'files']
		}
	});
});
