import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSchema, checkCoverage, scaffoldEntry, listAuthoringSections, getAuthoringGuide, callTool, TOOLS, createMcpServer } from '../src/mcp.ts';
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

test('callTool wraps a thrown handler error (malformed entry.yaml) as a structured error', () => {
	const res = callTool('check_coverage', {
		pluginId: 'p',
		files: {
			'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
			// Invalid YAML — unclosed flow mapping forces yaml.load to throw.
			'plugins/p/entry.yaml': 'tagline: "unterminated\n  skills: [a, b'
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

test('inlined SCHEMAS match the committed JSON and getSchema is fs-free', () => {
	for (const name of ['entry', 'catalog', 'manifest'] as const) {
		const onDisk = JSON.parse(readFileSync(fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url)), 'utf8'));
		assert.deepEqual(getSchema(name), onDisk);
		assert.deepEqual(SCHEMAS[name], onDisk);
	}
	assert.match(VERSION, /^\d+\.\d+\.\d+/);
});
