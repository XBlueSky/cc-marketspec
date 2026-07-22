#!/usr/bin/env node
// cc-marketspec — generate the marketplace manifest for a Claude Code plugin
// marketplace repo. Reads native marketplace/plugin metadata plus optional
// cc-marketspec authoring files, then writes a generated manifest.
//
// Usage: cc-marketspec [root] [--check] [--output <path>] [--help] [--version]

import { writeFileSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest } from './generate.ts';
import { planInit } from './init.ts';
import { NodeFileSource } from './fs-source.ts';
import { applyMigration, planMigration } from './migration.ts';
import { startMcpServer } from './mcp.ts';
import { defaultOutputPath, ensureNamespacedDistIgnore, writeManifestOutput } from './output.ts';
import { resolveWithinRoot } from './path-policy.ts';

const USAGE = `cc-marketspec — generate a presentation manifest for a Claude Code plugin marketplace.

Usage:
  cc-marketspec [root] [options]
  cc-marketspec init [root]
  cc-marketspec migrate [root] [--dry-run] [--from legacy]
  cc-marketspec mcp

Arguments:
  root              Marketplace repo root (defaults to the current directory).

Commands:
  init [root]       Scaffold namespaced authoring data under .cc-marketspec/.
  migrate [root]    Move validated legacy authoring data into .cc-marketspec/.
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
		const initArgs = args.slice(1);
		const initOptionsError = validateOptions(initArgs, new Set(), new Set());
		if (initOptionsError) {
			console.error('ERROR ' + initOptionsError);
			return 1;
		}
		const root = resolve(positionalRoot(initArgs, new Set()) ?? process.cwd());
		const plan = planInit(new NodeFileSource(root));
		for (const warning of plan.warnings) console.warn('WARN ' + warning);
		if (plan.errors.length > 0) {
			for (const error of plan.errors) console.error('ERROR ' + error);
			return 1;
		}
		try {
			for (const [relativePath, content] of Object.entries(plan.writes)) {
				const plannedPath = resolveWithinRoot(root, relativePath);
				mkdirSync(dirname(plannedPath), { recursive: true });
				const absolutePath = resolveWithinRoot(root, relativePath);
				writeFileSync(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
			}
		} catch (error) {
			console.error('ERROR ' + (error instanceof Error ? error.message : String(error)));
			return 1;
		}
		for (const action of plan.actions) {
			console.log(`${action.status === 'created' ? 'CREATE' : 'SKIP  '} ${action.path}${action.reason ? ` (${action.reason})` : ''}`);
		}
		console.log('\n' + plan.ciSnippet);
		return 0;
	}
	if (args[0] === 'mcp') {
		void startMcpServer();
		return 0; // server keeps the process alive on stdio
	}
	if (args[0] === 'migrate') {
		const migrateArgs = args.slice(1);
		const optionError = validateOptions(
			migrateArgs,
			new Set(['--dry-run']),
			new Set(['--from'])
		);
		if (optionError) {
			console.error('ERROR ' + optionError);
			return 1;
		}
		const from = optionValue(migrateArgs, '--from');
		if (from.error || (from.value !== undefined && from.value !== 'legacy')) {
			console.error('ERROR --from accepts only "legacy"');
			return 1;
		}
		const root = resolve(
			positionalRoot(migrateArgs, new Set(['--from'])) ?? process.cwd()
		);
		const plan = planMigration(new NodeFileSource(root), {
			from: from.value === 'legacy' ? 'legacy' : undefined
		});
		for (const warning of plan.warnings) console.warn('WARN ' + warning);
		if (plan.errors.length > 0) {
			for (const error of plan.errors) console.error('ERROR ' + error);
			return 1;
		}
		if (plan.kind === 'noop') {
			console.log('cc-marketspec: migration not needed');
			return 0;
		}
		if (migrateArgs.includes('--dry-run')) {
			for (const path of Object.keys(plan.writes).sort()) console.log('WRITE ' + path);
			for (const item of plan.removals) console.log('REMOVE ' + item.path);
			console.log('cc-marketspec: dry-run complete; nothing written');
			return 0;
		}
		const result = applyMigration(root, plan);
		if (result.errors.length > 0) {
			for (const error of result.errors) console.error('ERROR ' + error);
			return 1;
		}
		console.log(
			'cc-marketspec: '
			+ (plan.kind === 'cleanup' ? 'cleanup resumed' : 'migration complete')
		);
		return 0;
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
