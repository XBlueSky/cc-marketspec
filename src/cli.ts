#!/usr/bin/env node
// cc-marketspec — generate the marketplace manifest for a Claude Code plugin
// marketplace repo. Reads <root>/.claude-plugin/marketplace.json, <root>/plugins/*,
// <root>/catalog.yaml and per-plugin entry.yaml; writes <root>/manifest.json.
//
// Usage: cc-marketspec [root] [--check] [--help] [--version]   (root defaults to cwd)

import { writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest } from './generate.ts';

const USAGE = `cc-marketspec — generate manifest.json for a Claude Code plugin marketplace.

Usage:
  cc-marketspec [root] [options]

Arguments:
  root              Marketplace repo root (defaults to the current directory).

Options:
  --check           Validate only; report errors/warnings but do not write manifest.json.
  -h, --help        Show this help and exit.
  -v, --version     Print the version and exit.`;

function version(): string {
	try {
		const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
		return pkg.version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Run the CLI. Returns a process exit code (0 ok, 1 errors) instead of exiting. */
export function cli(argv: string[]): number {
	const args = argv.slice(2);
	if (args.includes('-h') || args.includes('--help')) {
		console.log(USAGE);
		return 0;
	}
	if (args.includes('-v') || args.includes('--version')) {
		console.log(version());
		return 0;
	}
	const check = args.includes('--check');
	const root = resolve(args.find((a) => !a.startsWith('-')) ?? process.cwd());

	const { manifest, errors, warnings } = generateManifest(root);

	for (const w of warnings) console.warn('WARN ' + w);
	if (errors.length) {
		for (const e of errors) console.error('ERROR ' + e);
		console.error(`\n${errors.length} error(s) — manifest NOT written.`);
		return 1;
	}

	const count = (manifest as { plugins?: unknown[] }).plugins?.length ?? 0;
	if (check) {
		console.log(`cc-marketspec: OK — ${count} plugins, ${warnings.length} warning(s). (--check: nothing written)`);
		return 0;
	}

	const outPath = join(root, 'manifest.json');
	writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
	console.log(`cc-marketspec: wrote ${outPath} — ${count} plugins, ${warnings.length} warning(s).`);
	return 0;
}

// Run only when invoked as the bin entry, not when imported by tests.
// realpathSync resolves the npm bin symlink so the guard still matches once installed.
function invokedDirectly(): boolean {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}
if (invokedDirectly()) process.exit(cli(process.argv));
