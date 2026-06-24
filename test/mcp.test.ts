import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, checkCoverage, scaffoldEntry } from '../src/mcp.ts';

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
