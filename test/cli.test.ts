// CLI surface tests: flags (--help / --version / --check) and the default
// generate-and-write behaviour. `cli(argv)` returns an exit code instead of
// calling process.exit, so it is callable in-process. Each filesystem case
// runs against a throwaway temp marketplace.
// Run: node --test test/cli.test.ts   (Node >=23 strips TS types)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cli } from '../src/cli.ts';

function makeMarket(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'ccms-cli-'));
	for (const [rel, content] of Object.entries(files)) {
		const p = join(root, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
	}
	return root;
}

/** Run cli() with console captured; returns the exit code and combined output. */
function capture(argv: string[]): { code: number; out: string } {
	const lines: string[] = [];
	const orig = { log: console.log, error: console.error, warn: console.warn };
	const sink = (...a: unknown[]) => void lines.push(a.join(' '));
	console.log = sink;
	console.error = sink;
	console.warn = sink;
	try {
		return { code: cli(argv), out: lines.join('\n') };
	} finally {
		Object.assign(console, orig);
	}
}

const VALID = {
	'.claude-plugin/marketplace.json': JSON.stringify({ name: 'mk', plugins: [{ name: 'sample', source: './plugins/sample' }] }),
	'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({ name: 'sample', version: '1.0.0' })
};

test('--version prints a semver and exits 0', () => {
	const { code, out } = capture(['node', 'cli', '--version']);
	assert.equal(code, 0);
	assert.match(out, /\d+\.\d+\.\d+/);
});

test('--help prints usage and exits 0', () => {
	const { code, out } = capture(['node', 'cli', '--help']);
	assert.equal(code, 0);
	assert.match(out, /cc-marketspec/);
	assert.match(out, /--check/);
});

test('default mode writes manifest.json and exits 0', () => {
	const root = makeMarket(VALID);
	try {
		const { code } = capture(['node', 'cli', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, 'manifest.json')), true, 'manifest.json should be written');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--check validates but does NOT write manifest.json', () => {
	const root = makeMarket(VALID);
	try {
		const { code } = capture(['node', 'cli', '--check', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, 'manifest.json')), false, 'manifest.json must not be written in --check');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('errors exit 1 and write nothing', () => {
	const root = makeMarket({ 'README.md': 'not a marketplace' });
	try {
		const { code } = capture(['node', 'cli', root]);
		assert.equal(code, 1);
		assert.equal(existsSync(join(root, 'manifest.json')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--strict-coverage turns a missing trigger into exit 1', () => {
	const root = makeMarket({
		'.claude-plugin/marketplace.json': JSON.stringify({ name: 'p', plugins: [{ name: 'p', source: './plugins/p' }] }),
		'plugins/p/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
		'plugins/p/skills/greet/SKILL.md': '---\nname: greet\ndescription: Greets the user.\n---\n\nGreet body.'
	});
	try {
		const { code } = capture(['node', 'cli', root, '--check', '--strict-coverage']);
		assert.equal(code, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
