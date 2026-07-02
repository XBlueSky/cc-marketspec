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

test('agent.summary message says "description:", not "summary:" (the real entry.yaml key)', () => {
	const f = facts({ agents: [{ name: 'rev' }] }); // no summary
	const r = analyzeCoverage(f, null, {}, 'myplugin');
	const finding = r.findings.find((x) => x.ruleId === 'agent.summary');
	assert.ok(finding, 'agent.summary finding exists');
	assert.match(finding.message, /add "description:" under the agents entry/, 'message says description');
	assert.doesNotMatch(finding.message, /add "summary:"/, 'message must not say summary');
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

test('message for an array component carries the entry.yaml path and how-to-fix', () => {
	const f = facts({ skills: [{ name: 'greet', autoload: false }] });
	const r = analyzeCoverage(f, null, {}, 'myplugin');
	const m = r.findings[0].message;
	assert.match(m, /plugins\/myplugin\/entry\.yaml/, 'has the file path');
	assert.match(m, /skill\.trigger/, 'has the rule id');
	assert.match(m, /add "trigger:" under the skills entry/, 'has actionable how-to with plural key');
});

test('message for a top-level plugin field says "at the top level", not "under the plugins entry"', () => {
	// plugin.tagline fires when neither native description fallback nor entry tagline exists.
	const f = facts({ plugin: { name: 'p' } });  // no description → tagline rule has nothing to fall back to
	const r = analyzeCoverage(f, null, {}, 'myplugin');
	const tagline = r.findings.find((x) => x.ruleId === 'plugin.tagline');
	assert.ok(tagline, 'plugin.tagline finding exists');
	assert.match(tagline.message, /add "tagline:" at the top level/, 'top-level wording');
	assert.doesNotMatch(tagline.message, /under the plugins entry/, 'must not pluralize plugin');
});

test('finding message uses the provided entryPath (root-level plugin)', () => {
	const f = { plugin: {}, skills: [{ name: 'using-cortex', autoload: false }], commands: [], agents: [], mcp: [], hooks: [] };
	const r = analyzeCoverage(f, null, {}, 'cortex', 'entry.yaml');
	const finding = r.findings.find((x) => x.ruleId === 'skill.trigger');
	assert.ok(finding, 'a skill.trigger finding exists');
	assert.match(finding.message, /^entry\.yaml:/, 'message names the real root entry.yaml path');
	assert.doesNotMatch(finding.message, /plugins\/cortex/, 'must not point at a non-existent plugins/cortex path');
});

test('finding message falls back to plugins/<id>/entry.yaml when no entryPath given', () => {
	const f = { plugin: {}, skills: [{ name: 's', autoload: false }], commands: [], agents: [], mcp: [], hooks: [] };
	const r = analyzeCoverage(f, null, {}, 'myplugin');
	const finding = r.findings.find((x) => x.ruleId === 'skill.trigger');
	assert.ok(finding);
	assert.match(finding.message, /^plugins\/myplugin\/entry\.yaml:/, 'unchanged fallback for 4-arg callers');
});
