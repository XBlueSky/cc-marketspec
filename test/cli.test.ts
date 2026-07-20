// CLI surface tests: flags (--help / --version / --check) and the default
// generate-and-write behaviour. `cli(argv)` returns an exit code instead of
// calling process.exit, so it is callable in-process. Each filesystem case
// runs against a throwaway temp marketplace.
// Run: node --test test/cli.test.ts   (Node >=23 strips TS types)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, lstatSync, rmSync, symlinkSync } from 'node:fs';
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
	assert.match(out, /--output/);
});

test('init writes namespaced authored files but no generated manifest', () => {
	const root = makeMarket(VALID);
	try {
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 0);
		assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore')), true);
		assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), true);
		assert.equal(existsSync(join(root, '.cc-marketspec/entries/plugin-sample.yaml')), true);
		assert.equal(existsSync(join(root, '.cc-marketspec/dist/manifest.json')), false);
		assert.equal(existsSync(join(root, 'catalog.yaml')), false);
		assert.equal(existsSync(join(root, 'plugins/sample/entry.yaml')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('init reports legacy migration guidance and performs no new writes', () => {
	const root = makeMarket({
		...VALID,
		'catalog.yaml': 'schemaVersion: "1.0"\n',
		'plugins/sample/entry.yaml': 'tagline: Legacy value\n'
	});
	try {
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 1);
		assert.match(result.out, /migrate/i);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('init prints remote-source warnings without fabricating entries', () => {
	const root = makeMarket({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'remote', source: { source: 'github', repo: 'o/r' } }]
		})
	});
	try {
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 0);
		assert.match(result.out, /WARN .*remote/i);
		assert.equal(existsSync(join(root, '.cc-marketspec/entries/plugin-remote.yaml')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('init rejects extra roots and options before writing', () => {
	for (const tail of [['second-root'], ['--output', 'out.json'], ['--unknown']]) {
		const root = makeMarket(VALID);
		try {
			const result = capture(['node', 'cli', 'init', root, ...tail]);
			assert.equal(result.code, 1, tail.join(' '));
			assert.equal(existsSync(join(root, '.cc-marketspec')), false, tail.join(' '));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test('init preserves existing namespaced files', () => {
	const root = makeMarket({
		...VALID,
		'.cc-marketspec/.gitignore': '# custom\n',
		'.cc-marketspec/catalog.yaml': 'schemaVersion: "1.1"\nlang: zh-TW\n',
		'.cc-marketspec/entries/plugin-sample.yaml': 'tagline: Custom\n'
	});
	try {
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 0);
		assert.equal(readFileSync(join(root, '.cc-marketspec/.gitignore'), 'utf8'), '# custom\n');
		assert.equal(readFileSync(join(root, '.cc-marketspec/catalog.yaml'), 'utf8'), 'schemaVersion: "1.1"\nlang: zh-TW\n');
		assert.equal(readFileSync(join(root, '.cc-marketspec/entries/plugin-sample.yaml'), 'utf8'), 'tagline: Custom\n');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('init rejects a namespaced symlink that escapes the marketplace root', () => {
	const root = makeMarket(VALID);
	const outside = mkdtempSync(join(tmpdir(), 'ccms-init-outside-'));
	try {
		symlinkSync(outside, join(root, '.cc-marketspec'), 'dir');
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 1);
		assert.equal(existsSync(join(outside, '.gitignore')), false);
		assert.equal(existsSync(join(outside, 'catalog.yaml')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test('init catches a file-level gitignore symlink escape before writing', () => {
	const root = makeMarket(VALID);
	const outside = mkdtempSync(join(tmpdir(), 'ccms-init-ignore-outside-'));
	const outsideFile = join(outside, 'gitignore');
	try {
		writeFileSync(outsideFile, 'outside sentinel\n');
		mkdirSync(join(root, '.cc-marketspec'), { recursive: true });
		symlinkSync(outsideFile, join(root, '.cc-marketspec/.gitignore'), 'file');
		let result: { code: number; out: string } | undefined;
		assert.doesNotThrow(() => {
			result = capture(['node', 'cli', 'init', root]);
		});
		assert.equal(result?.code, 1);
		assert.match(result?.out ?? '', /ERROR .*escape/i);
		assert.equal(readFileSync(outsideFile, 'utf8'), 'outside sentinel\n');
		assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')), false);
		assert.equal(existsSync(join(root, '.cc-marketspec/entries/plugin-sample.yaml')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

for (const collision of ['.cc-marketspec/catalog.yaml', '.cc-marketspec/entries/plugin-sample.yaml']) {
	test(`init preflights the ${collision} directory before every write`, () => {
		const root = makeMarket(VALID);
		try {
			mkdirSync(join(root, collision), { recursive: true });
			const result = capture(['node', 'cli', 'init', root]);
			assert.equal(result.code, 1);
			assert.match(result.out, /ERROR .*directory/i);
			assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore')), false);
			assert.equal(existsSync(join(root, '.cc-marketspec/catalog.yaml')) && !lstatSync(join(root, '.cc-marketspec/catalog.yaml')).isDirectory(), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test('init preflights a dangling catalog symlink before every write', () => {
	const root = makeMarket(VALID);
	const catalogPath = join(root, '.cc-marketspec/catalog.yaml');
	try {
		mkdirSync(dirname(catalogPath), { recursive: true });
		symlinkSync(join(root, 'missing-catalog-target'), catalogPath, 'file');
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 1);
		assert.match(result.out, /ERROR .*symbolic link/i);
		assert.equal(lstatSync(catalogPath).isSymbolicLink(), true);
		assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore')), false);
		assert.equal(existsSync(join(root, '.cc-marketspec/entries/plugin-sample.yaml')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('init reports an escaping local plugin source instead of throwing', () => {
	const root = makeMarket({
		'.claude-plugin/marketplace.json': JSON.stringify({
			name: 'mk',
			plugins: [{ name: 'sample', source: './plugins/sample' }]
		})
	});
	const outside = mkdtempSync(join(tmpdir(), 'ccms-init-plugin-outside-'));
	try {
		mkdirSync(join(root, 'plugins'), { recursive: true });
		symlinkSync(outside, join(root, 'plugins/sample'), process.platform === 'win32' ? 'junction' : 'dir');
		const result = capture(['node', 'cli', 'init', root]);
		assert.equal(result.code, 1);
		assert.match(result.out, /sample.*inspect|escapes marketplace root/i);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test('default fresh mode writes ignored namespaced output', () => {
	const root = makeMarket(VALID);
	try {
		const { code } = capture(['node', 'cli', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, '.cc-marketspec/dist/manifest.json')), true);
		assert.equal(existsSync(join(root, '.cc-marketspec/.gitignore')), true);
		assert.equal(existsSync(join(root, 'manifest.json')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('default legacy mode keeps the root manifest compatibility output', () => {
	const root = makeMarket({
		...VALID,
		'catalog.yaml': 'schemaVersion: "1.0"\n',
		'plugins/sample/entry.yaml': 'tagline: Legacy value\n'
	});
	try {
		const { code } = capture(['node', 'cli', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, 'manifest.json')), true);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--check validates but writes nothing', () => {
	const root = makeMarket(VALID);
	try {
		const { code } = capture(['node', 'cli', '--check', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, 'manifest.json')), false, 'manifest.json must not be written in --check');
		assert.equal(existsSync(join(root, '.cc-marketspec')), false, '.cc-marketspec must not be created in --check');
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
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--output before the root writes a safe custom repo-relative target', () => {
	const root = makeMarket(VALID);
	try {
		const { code } = capture(['node', 'cli', '--output', 'site/public/marketplace.json', root]);
		assert.equal(code, 0);
		assert.equal(existsSync(join(root, 'site/public/marketplace.json')), true);
		assert.equal(existsSync(join(root, 'manifest.json')), false);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--check --output is rejected and writes nothing', () => {
	const root = makeMarket(VALID);
	try {
		const result = capture(['node', 'cli', root, '--check', '--output', 'out.json']);
		assert.equal(result.code, 1);
		assert.match(result.out, /cannot.*--check.*--output|--check.*--output.*cannot/i);
		assert.equal(existsSync(join(root, 'out.json')), false);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--output requires a value and writes nothing', () => {
	const root = makeMarket(VALID);
	try {
		for (const args of [[root, '--output'], [root, '--output', '--check']]) {
			const result = capture(['node', 'cli', ...args]);
			assert.equal(result.code, 1);
			assert.match(result.out, /--output requires a value/i);
		}
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--output may be specified only once', () => {
	const root = makeMarket(VALID);
	try {
		const result = capture(['node', 'cli', root, '--output', 'one.json', '--output', 'two.json']);
		assert.equal(result.code, 1);
		assert.match(result.out, /--output may be specified only once/i);
		assert.equal(existsSync(join(root, 'one.json')), false);
		assert.equal(existsSync(join(root, 'two.json')), false);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const flag of ['--check', '--strict-coverage']) {
	test(`${flag} may be specified only once`, () => {
		const root = makeMarket(VALID);
		try {
			const result = capture(['node', 'cli', root, flag, flag]);
			assert.equal(result.code, 1);
			assert.match(result.out, new RegExp(`${flag} may be specified only once`, 'i'));
			assert.equal(existsSync(join(root, '.cc-marketspec')), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test('more than one positional root is rejected before generation', () => {
	const root = makeMarket(VALID);
	try {
		const result = capture(['node', 'cli', root, 'second-root']);
		assert.equal(result.code, 1);
		assert.match(result.out, /at most one.*root|multiple.*root/i);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('unknown generation options are rejected without writes', () => {
	const root = makeMarket(VALID);
	try {
		const result = capture(['node', 'cli', root, '--outpt', 'out.json']);
		assert.equal(result.code, 1);
		assert.match(result.out, /unknown option --outpt/i);
		assert.equal(existsSync(join(root, '.cc-marketspec')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const output of ['../outside.json', '/tmp/out.json', 'C:/out.json', 'C:out.json', '\\\\server\\out.json']) {
	test(`--output rejects ${output}`, () => {
		const root = makeMarket(VALID);
		try {
			const result = capture(['node', 'cli', root, '--output', output]);
			assert.equal(result.code, 1);
			assert.equal(existsSync(join(root, 'manifest.json')), false);
			assert.equal(existsSync(join(root, '.cc-marketspec')), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test('output-policy warnings are included in the final warning count', () => {
	const root = makeMarket({
		...VALID,
		'plugins/sample/.claude-plugin/plugin.json': JSON.stringify({
			name: 'sample',
			version: '1.0.0',
			description: 'Native summary'
		}),
		'.cc-marketspec/.gitignore': '# user rules\n'
	});
	try {
		const result = capture(['node', 'cli', root]);
		assert.equal(result.code, 0);
		assert.match(result.out, /WARN .*\/dist\//);
		assert.match(result.out, /1 warning\(s\)/);
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
		// Without the flag the same fixture is only a warning → exit 0 …
		assert.equal(capture(['node', 'cli', root, '--check']).code, 0);
		// … and --strict-coverage promotes that warning to an error → exit 1.
		assert.equal(capture(['node', 'cli', root, '--check', '--strict-coverage']).code, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
