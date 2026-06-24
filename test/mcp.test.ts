import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, checkCoverage, scaffoldEntry, explainField, callTool } from '../src/mcp.ts';

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

test('explainField resolves the live schema describe() text for skill.trigger', () => {
	const r = explainField('skill.trigger');
	assert.equal(r.path, 'skill.trigger');
	assert.equal(typeof r.description, 'string');
	assert.ok((r.description as string).length > 0);
	// Must be the ACTUAL describe() text on skill.trigger, not a near-miss match.
	assert.equal(r.description, "Human 'when to reach for it'.");
});

test('explainField distinguishes components (regression: prefix was ignored)', () => {
	// Both fields are named differently, but the bug returned the SAME text for
	// any path sharing a leaf name / ignored the component. These must differ.
	const trigger = explainField('skill.trigger').description;
	const cmdDesc = explainField('command.description').description;
	assert.equal(typeof trigger, 'string');
	assert.equal(typeof cmdDesc, 'string');
	assert.notEqual(trigger, cmdDesc);
	// skill.description vs command.description vs agent.summary must each resolve,
	// and skill/command share the field name but carry distinct copy.
	assert.notEqual(explainField('skill.description').description, explainField('command.description').description);
});

test('explainField resolves the synthetic remaps (agent.summary, mcp.env, mcp.provides, plugin.tagline)', () => {
	assert.equal(explainField('agent.summary').description, 'Curated copy; falls back to native.');
	assert.equal(explainField('mcp.env').description, 'Descriptions for env vars; keys must exist in .mcp.json (phantom = error).');
	assert.equal(typeof explainField('mcp.provides').description, 'string');
	assert.ok((explainField('mcp.provides').description as string).length > 0);
	assert.equal(typeof explainField('plugin.tagline').description, 'string');
});

test('explainField returns { description: undefined } for an unknown path, without throwing', () => {
	assert.deepEqual(explainField('skill.nope'), { path: 'skill.nope', description: undefined });
	assert.deepEqual(explainField('bogus.field'), { path: 'bogus.field', description: undefined });
	assert.deepEqual(explainField('garbage'), { path: 'garbage', description: undefined });
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
