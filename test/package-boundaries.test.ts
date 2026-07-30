// Guards the split: the core package must stay installable without the MCP
// SDK's HTTP/OAuth dependency stack (that lives in packages/mcp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('core runtime dependencies stay MCP-SDK-free', () => {
	const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { dependencies: Record<string, string> };
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['js-yaml', 'yaml', 'zod']);
});

test('no core source file imports the MCP SDK', () => {
	const srcDir = fileURLToPath(new URL('../src', import.meta.url));
	for (const file of readdirSync(srcDir)) {
		if (!file.endsWith('.ts')) continue;
		const content = readFileSync(`${srcDir}/${file}`, 'utf8');
		assert.ok(!content.includes('@modelcontextprotocol/sdk'), `src/${file} must not import the SDK`);
	}
});
