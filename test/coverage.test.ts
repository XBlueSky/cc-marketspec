import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCoverage } from '../src/coverage.ts';
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
	assert.equal(r.summary.off, 1);
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
