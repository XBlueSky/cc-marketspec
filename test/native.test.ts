import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSource } from '../src/fs-source.ts';
import { extractNativeFacts, firstSentence } from '../src/native.ts';

test('firstSentence trims at the first sentence boundary', () => {
	assert.equal(firstSentence('Does the thing. And more.'), 'Does the thing.');
	assert.equal(firstSentence('No punctuation here'), 'No punctuation here');
});

test('extractNativeFacts pulls plugin + derived components from native files', () => {
	const source = new MemoryFileSource({
		'plugins/p/.claude-plugin/plugin.json': '{"name":"p","version":"1.0.0","description":"A plugin."}',
		'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: Greets you. Use to say hi.\nuser-invocable: false\n---\n# Greet\n',
		'plugins/p/skills/greet/references/a.md': 'x',
		'plugins/p/.mcp.json': '{"mcpServers":{"srv":{"command":"x","env":{"TOK":"${TOK}"}}}}',
		'plugins/p/hooks/hooks.json': '{"hooks":{"SessionStart":[{"matcher":"startup"}]}}'
	});
	const facts = extractNativeFacts(source, 'plugins/p');
	assert.equal(facts.plugin.version, '1.0.0');
	assert.equal(facts.skills[0].name, 'greet');
	assert.equal(facts.skills[0].description, 'Greets you. Use to say hi.');
	assert.equal(facts.skills[0].autoload, true);
	assert.equal(facts.skills[0].resources?.references, 1);
	assert.equal(facts.mcp[0].name, 'srv');
	assert.deepEqual(facts.mcp[0].envKeys, ['TOK']);
	assert.equal(facts.hooks[0].event, 'SessionStart');
	assert.equal(facts.hooks[0].matcher, 'startup');
});

test('extractNativeFacts sorts every discovered component and environment key', () => {
	const source = new MemoryFileSource({
		'plugins/p/.claude-plugin/plugin.json': '{"name":"p"}',
		'plugins/p/skills/zeta/SKILL.md': '---\nname: zeta\n---\n',
		'plugins/p/skills/alpha/SKILL.md': '---\nname: alpha\n---\n',
		'plugins/p/commands/zeta.md': '---\nname: zeta\n---\n',
		'plugins/p/commands/alpha.md': '---\nname: alpha\n---\n',
		'plugins/p/agents/zeta.md': '---\nname: zeta\n---\n',
		'plugins/p/agents/alpha.md': '---\nname: alpha\n---\n',
		'plugins/p/.mcp.json': '{"mcpServers":{"zeta":{"command":"z","env":{"Z":"${Z}","A":"${A}"}},"alpha":{"url":"https://example.com"}}}',
		'plugins/p/hooks/hooks.json': '{"hooks":{"Stop":[{}, {"matcher":"zeta"}],"SessionStart":[{"matcher":"alpha"}]}}'
	});
	const facts = extractNativeFacts(source, 'plugins/p');
	assert.deepEqual(facts.skills.map(({ name }) => name), ['alpha', 'zeta']);
	assert.deepEqual(facts.commands.map(({ name }) => name), ['alpha', 'zeta']);
	assert.deepEqual(facts.agents.map(({ name }) => name), ['alpha', 'zeta']);
	assert.deepEqual(facts.mcp.map(({ name }) => name), ['alpha', 'zeta']);
	assert.deepEqual(facts.mcp[1].envKeys, ['A', 'Z']);
	assert.deepEqual(
		facts.hooks.map(({ event, matcher }) => [event, matcher]),
		[['SessionStart', 'alpha'], ['Stop', undefined], ['Stop', 'zeta']]
	);
});
