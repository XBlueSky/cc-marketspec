#!/usr/bin/env node
// cc-marketspec — generate the marketplace manifest for a Claude Code plugin
// marketplace repo. Reads native marketplace/plugin metadata plus optional
// cc-marketspec authoring files, then writes a generated manifest.
//
// Usage: cc-marketspec [root] [--check] [--output <path>] [--help] [--version]

import { writeFileSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest } from './generate.ts';
import { planInit } from './init.ts';
import { NodeFileSource } from './fs-source.ts';
import { startMcpServer } from './mcp.ts';
import { defaultOutputPath, ensureNamespacedDistIgnore, writeManifestOutput } from './output.ts';

const USAGE = `cc-marketspec — generate manifest.json for a Claude Code plugin marketplace.

Usage:
  cc-marketspec [root] [options]
  cc-marketspec init [root]
  cc-marketspec mcp

Arguments:
  root              Marketplace repo root (defaults to the current directory).

Commands:
  init [root]       Scaffold a new marketplace repo (creates catalog.yaml, plugin dirs, etc.).
  mcp               Start a stdio MCP server exposing schema/coverage/scaffold tools.

Options:
  --check           Validate only; report errors/warnings but do not write output.
  --output <path>   Write to a repository-relative path. Fresh/namespaced default:
                    .cc-marketspec/dist/manifest.json; legacy default: manifest.json.
  --strict-coverage Promote all coverage warnings to errors for this run (stricter release gate).
  -h, --help        Show this help and exit.
  -v, --version     Print the version and exit.`;

function optionValue(args: string[], name: string): { value?: string; error?: string } {
	const index = args.indexOf(name);
	if (index === -1) return {};
	const value = args[index + 1];
	if (!value || value.startsWith('-')) return { error: `${name} requires a value` };
	if (args.indexOf(name, index + 1) !== -1) return { error: `${name} may be specified only once` };
	return { value };
}

function positionalRoot(args: string[], optionsWithValues: Set<string>): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (optionsWithValues.has(arg)) {
			index += 1;
			continue;
		}
		if (!arg.startsWith('-')) return arg;
	}
	return undefined;
}

function validateOptions(
	args: string[],
	flags: Set<string>,
	optionsWithValues: Set<string>
): string | undefined {
	const seenFlags = new Set<string>();
	let positionalRoots = 0;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (optionsWithValues.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith('-')) {
			if (!flags.has(arg)) return `unknown option ${arg}`;
			if (seenFlags.has(arg)) return `${arg} may be specified only once`;
			seenFlags.add(arg);
			continue;
		}
		positionalRoots += 1;
		if (positionalRoots > 1) return 'at most one marketplace root may be specified';
	}
	return undefined;
}

function pluginCount(manifest: unknown): number {
	if (manifest === null || typeof manifest !== 'object') return 0;
	const plugins = (manifest as { plugins?: unknown }).plugins;
	return Array.isArray(plugins) ? plugins.length : 0;
}

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
	if (args[0] === 'init') {
		const root = resolve(args.find((a, i) => i > 0 && !a.startsWith('-')) ?? process.cwd());
		const { actions, writes, ciSnippet } = planInit(new NodeFileSource(root));
		for (const [rel, content] of Object.entries(writes)) {
			const abs = join(root, rel);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, content);
		}
		for (const a of actions) console.log(`${a.status === 'created' ? 'CREATE' : 'SKIP  '} ${a.path}${a.reason ? ` (${a.reason})` : ''}`);
		console.log('\n' + ciSnippet);
		return 0;
	}
	if (args[0] === 'mcp') {
		void startMcpServer();
		return 0; // server keeps the process alive on stdio
	}

	const flags = new Set(['--check', '--strict-coverage']);
	const optionsWithValues = new Set(['--output']);
	const optionsError = validateOptions(args, flags, optionsWithValues);
	if (optionsError) {
		console.error('ERROR ' + optionsError);
		return 1;
	}
	const outputOption = optionValue(args, '--output');
	if (outputOption.error) {
		console.error('ERROR ' + outputOption.error);
		return 1;
	}
	const check = args.includes('--check');
	if (check && outputOption.value) {
		console.error('ERROR --check and --output cannot be combined');
		return 1;
	}
	const strict = args.includes('--strict-coverage');
	const root = resolve(positionalRoot(args, optionsWithValues) ?? process.cwd());
	const result = generateManifest(root, { strictCoverage: strict });

	for (const warning of result.warnings) console.warn('WARN ' + warning);
	if (result.errors.length > 0) {
		for (const error of result.errors) console.error('ERROR ' + error);
		console.error(`\n${result.errors.length} error(s) — manifest NOT written.`);
		return 1;
	}

	const count = pluginCount(result.manifest);
	if (check) {
		console.log(`cc-marketspec: OK — ${count} plugins, ${result.warnings.length} warning(s). (--check: nothing written)`);
		return 0;
	}

	const output = outputOption.value ?? defaultOutputPath(result.layout);
	try {
		let outputWarningCount = 0;
		if (!outputOption.value && result.layout !== 'legacy') {
			const outputWarnings = ensureNamespacedDistIgnore(root);
			outputWarningCount = outputWarnings.length;
			for (const warning of outputWarnings) console.warn('WARN ' + warning);
		}
		writeManifestOutput(root, output, result.manifest);
		const warningCount = result.warnings.length + outputWarningCount;
		console.log(`cc-marketspec: wrote ${output} — ${count} plugins, ${warningCount} warning(s).`);
		return 0;
	} catch (error) {
		console.error('ERROR ' + (error instanceof Error ? error.message : String(error)));
		return 1;
	}
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
