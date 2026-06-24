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
