// Detection-based, non-destructive scaffold. Pure over a FileSource: decides what
// to create vs skip and returns the writes for the CLI to flush to disk.
import { posix } from 'node:path';
import { Catalog } from './catalog.ts';
import type { FileSource } from './fs-source.ts';
import {
	CATALOG_PATH,
	SPEC_GITIGNORE_PATH,
	entryPathForPlugin,
	inspectLayout,
	resolveMarketplacePlugins
} from './layout.ts';
import { loadYaml, readJSON } from './native.ts';
import { checkFormatVersion, CURRENT_FORMAT_VERSION } from './version.ts';

export interface InitAction {
	path: string;
	status: 'created' | 'skipped';
	reason?: string;
}

export interface InitPlan {
	actions: InitAction[];
	writes: Record<string, string>;
	ciSnippet: string;
	errors: string[];
	warnings: string[];
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';

interface PlannedFile {
	path: string;
	content: string;
}

type PlannedTargetState = 'absent' | 'file';

const CATALOG_TEMPLATE = `# Marketplace-level presentation data owned by cc-marketspec.
# Native metadata (name/owner) remains in .claude-plugin/marketplace.json.
schemaVersion: "${CURRENT_FORMAT_VERSION}"
lang: en
groups:
  - id: examples
    label: Examples
    note: Illustrative plugins
# Optional coverage severity overrides use <component>.<field> or "*".
# coverage:
#   skill.trigger: warn
`;

const CI_SNIPPET = `# Read-only pull-request gate:
#   npx @xbluesky/cc-marketspec --check
# Generate during the site/deploy build; default output:
#   .cc-marketspec/dist/manifest.json
`;

function entryTemplate(pluginId: string): string {
	return `# Marketplace presentation overlay for ${pluginId}. Every field is optional.
# yaml-language-server: $schema=node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json
# Groups are declared in .cc-marketspec/catalog.yaml.
# Field guide: marketplace-flow/references/entry-authoring.md or the hosted MCP.
#
# tagline: add a concise card summary when it improves the native description
# intro: add a short marketplace-facing lede
# group: add an id declared in .cc-marketspec/catalog.yaml
# tips:
#   - add a concrete power move
# traps:
#   - add a concrete pitfall and remedy
`;
}

function failedPlan(errors: string[], warnings: string[] = []): InitPlan {
	return {
		actions: [],
		writes: {},
		ciSnippet: CI_SNIPPET,
		errors: errors.sort(compare),
		warnings: warnings.sort(compare)
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parentPaths(path: string): string[] {
	const parents: string[] = [];
	for (let parent = posix.dirname(path); parent !== '.' && parent !== ''; parent = posix.dirname(parent)) {
		parents.push(parent);
	}
	return parents;
}

function preflightPlannedFiles(
	source: FileSource,
	plannedFiles: PlannedFile[]
): { states: Map<string, PlannedTargetState>; errors: string[] } {
	const states = new Map<string, PlannedTargetState>();
	const errors: string[] = [];
	const parents = [...new Set(plannedFiles.flatMap((file) => parentPaths(file.path)))].sort(compare);

	for (const parent of parents) {
		try {
			if (source.isSymbolicLink?.(parent)) {
				errors.push(`${parent}: parent component is a symbolic link`);
				continue;
			}
			if (source.exists(parent) && !source.isDir(parent)) {
				errors.push(`${parent}: parent component is not a directory`);
			}
		} catch (error) {
			errors.push(`${parent}: inspection failed: ${errorMessage(error)}`);
		}
	}

	for (const file of plannedFiles.slice().sort((left, right) => compare(left.path, right.path))) {
		try {
			if (source.isSymbolicLink?.(file.path)) {
				errors.push(`${file.path}: planned file target is a symbolic link`);
				continue;
			}
			if (!source.exists(file.path)) {
				states.set(file.path, 'absent');
				continue;
			}
			if (source.isDir(file.path)) {
				errors.push(`${file.path}: planned file target is a directory`);
				continue;
			}
			if (source.read(file.path) === null) {
				errors.push(`${file.path}: planned file target is non-regular`);
				continue;
			}
			states.set(file.path, 'file');
		} catch (error) {
			errors.push(`${file.path}: inspection failed: ${errorMessage(error)}`);
		}
	}

	return { states, errors: errors.sort(compare) };
}

function validateNamespacedCatalog(source: FileSource): string | null {
	let catalog: unknown;
	try {
		catalog = loadYaml(source, CATALOG_PATH);
	} catch {
		return `${CATALOG_PATH} could not be parsed as YAML`;
	}
	const parsed = Catalog.safeParse(catalog);
	if (!parsed.success) return `${CATALOG_PATH} does not validate as a cc-marketspec catalog`;
	const version = checkFormatVersion(parsed.data.schemaVersion, 'namespaced');
	return version.ok ? null : `${CATALOG_PATH}: ${version.error}`;
}

export function planInit(source: FileSource): InitPlan {
	let market: Record<string, unknown>;
	try {
		const raw = readJSON(source, MARKETPLACE_PATH) as unknown;
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
			return failedPlan([`${MARKETPLACE_PATH} must contain a JSON object`]);
		}
		market = raw as Record<string, unknown>;
	} catch (error) {
		return failedPlan([
			`${MARKETPLACE_PATH}: ${error instanceof Error ? error.message : String(error)}`
		]);
	}

	const resolution = resolveMarketplacePlugins(market.plugins);
	let layout;
	try {
		layout = inspectLayout(source, resolution.plugins);
	} catch (error) {
		return failedPlan(
			[
				...resolution.errors,
				`layout inspection failed: ${error instanceof Error ? error.message : String(error)}`
			],
			resolution.warnings
		);
	}
	if (resolution.errors.length > 0 || layout.kind === 'legacy' || layout.kind === 'ambiguous') {
		const layoutErrors = layout.kind === 'legacy' ? layout.warnings : layout.errors;
		const layoutWarnings = layout.kind === 'legacy' ? [] : layout.warnings;
		return failedPlan(
			[...resolution.errors, ...layoutErrors],
			[...resolution.warnings, ...layoutWarnings]
		);
	}

	const warnings = [...resolution.warnings, ...layout.warnings];
	const plannedFiles: PlannedFile[] = [
		{ path: SPEC_GITIGNORE_PATH, content: '/dist/\n' },
		{ path: CATALOG_PATH, content: CATALOG_TEMPLATE }
	];
	for (const plugin of resolution.plugins) {
		if (plugin.sourceKind === 'remote' || plugin.dir === null) {
			warnings.push(`${plugin.id}: remote source cannot be scaffolded without local native files`);
			continue;
		}
		let hasPluginMetadata: boolean;
		try {
			hasPluginMetadata = source.exists(posix.join(plugin.dir, '.claude-plugin', 'plugin.json'));
		} catch (error) {
			return failedPlan(
				[`${plugin.id}: local plugin files could not be inspected: ${error instanceof Error ? error.message : String(error)}`],
				warnings
			);
		}
		if (!hasPluginMetadata) {
			warnings.push(`${plugin.id}: local plugin.json is missing; entry was not scaffolded`);
			continue;
		}
		plannedFiles.push({
			path: entryPathForPlugin(plugin.id),
			content: entryTemplate(plugin.id)
		});
	}

	const preflight = preflightPlannedFiles(source, plannedFiles);
	if (preflight.errors.length > 0) return failedPlan(preflight.errors, warnings);
	if (layout.kind === 'namespaced' && preflight.states.get(CATALOG_PATH) === 'file') {
		const catalogError = validateNamespacedCatalog(source);
		if (catalogError !== null) return failedPlan([catalogError], warnings);
	}

	const actions: InitAction[] = [];
	const writes: Record<string, string> = {};
	for (const file of plannedFiles) {
		if (preflight.states.get(file.path) === 'file') {
			actions.push({ path: file.path, status: 'skipped', reason: 'already exists' });
		} else {
			writes[file.path] = file.content;
			actions.push({ path: file.path, status: 'created' });
		}
	}

	return {
		actions,
		writes,
		ciSnippet: CI_SNIPPET,
		errors: [],
		warnings: warnings.sort(compare)
	};
}
