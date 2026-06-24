import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCoverage } from '../src/coverage.ts';
import { coverageTargets } from '../src/entry.ts';
import type { NativeFacts } from '../src/native.ts';

const facts = (over: Partial<NativeFacts> = {}): NativeFacts => ({
	plugin: { name: 'p', description: 'native desc' },
	skills: [], commands: [], agents: [], mcp: [], hooks: [],
	...over
});

test('skill.trigger: warns by default when skill has no entry trigger', () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const r = analyzeCoverage(f, null, {}, 'p');
	assert.equal(r.findings.length, 1);
	assert.equal(r.findings[0].ruleId, 'skill.trigger');
	assert.equal(r.findings[0].severity, 'warn');
	assert.equal(r.findings[0].component, 'greet');
	assert.equal(r.summary.warn, 1);
});

test('skill.trigger: no finding when entry supplies trigger', () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const entry = { skills: [{ name: 'greet', trigger: 'when greeting' }] } as never;
	const r = analyzeCoverage(f, entry, {}, 'p');
	assert.equal(r.findings.length, 0);
});

test('config can disable a rule (off ⇒ no finding, counted in summary.off)', () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const r = analyzeCoverage(f, null, { 'skill.trigger': 'off' }, 'p');
	assert.equal(r.findings.length, 0);
	// skill.trigger is counted as off; other off-default rules (e.g. skill.examples,
	// plugin.group) may also be counted — assert at least 1 rule disabled.
	assert.ok(r.summary.off >= 1);
});

test('config can promote a rule to error', () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const r = analyzeCoverage(f, null, { 'skill.trigger': 'error' }, 'p');
	assert.equal(r.findings[0].severity, 'error');
	assert.equal(r.summary.error, 1);
});

test("'*' default applies to unlisted rules", () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const r = analyzeCoverage(f, null, { '*': 'off' }, 'p');
	assert.equal(r.findings.length, 0);
});

test('coverageTargets reflects marked entry fields incl. defaults', () => {
	const targets = coverageTargets();
	const byId = new Map(targets.map((t) => [`${t.component}.${t.field}`, t.defaultSeverity]));
	assert.equal(byId.get('skill.trigger'), 'warn');
	assert.equal(byId.get('skill.examples'), 'off');
	assert.equal(byId.get('mcp.env'), 'warn');
	assert.equal(byId.get('plugin.tagline'), 'warn');
	assert.equal(byId.get('plugin.group'), 'off');
});

test('agent.summary warns when neither native summary nor entry description present', () => {
	const f = facts({ agents: [{ name: 'rev' }] }); // no summary
	const r = analyzeCoverage(f, null, {}, 'p');
	assert.ok(r.findings.some((x) => x.ruleId === 'agent.summary' && x.component === 'rev'));
});

test('mcp.env warns when an env key has no authored description', () => {
	const f = facts({ mcp: [{ name: 'srv', type: 'stdio', envKeys: ['API_KEY'] }] });
	const r = analyzeCoverage(f, null, {}, 'p');
	assert.ok(r.findings.some((x) => x.ruleId === 'mcp.env' && x.component === 'srv'));
});

test('plugin.tagline warns when no tagline and native description empty', () => {
	const f = facts({ plugin: { name: 'p' } }); // no description
	const r = analyzeCoverage(f, null, {}, 'p');
	assert.ok(r.findings.some((x) => x.ruleId === 'plugin.tagline'));
});
