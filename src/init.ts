// Detection-based, non-destructive scaffold. Pure over a FileSource: decides what
// to create vs skip and returns the writes for the CLI to flush to disk.
import { posix } from 'node:path';
import type { FileSource } from './fs-source.ts';
import {
	CATALOG_PATH,
	SPEC_GITIGNORE_PATH,
	entryPathForPlugin,
	inspectLayout,
	resolveMarketplacePlugins
} from './layout.ts';
import { readJSON } from './native.ts';
import { CURRENT_FORMAT_VERSION } from './version.ts';

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

	const resolution = resolveMarketplacePlugins(market.plugins ?? []);
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

	const actions: InitAction[] = [];
	const writes: Record<string, string> = {};
	const warnings = [...resolution.warnings, ...layout.warnings];
	const planWrite = (path: string, content: string) => {
		if (source.exists(path)) {
			actions.push({ path, status: 'skipped', reason: 'already exists' });
		} else {
			writes[path] = content;
			actions.push({ path, status: 'created' });
		}
	};

	planWrite(SPEC_GITIGNORE_PATH, '/dist/\n');
	planWrite(CATALOG_PATH, CATALOG_TEMPLATE);
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
		planWrite(entryPathForPlugin(plugin.id), entryTemplate(plugin.id));
	}

	return {
		actions,
		writes,
		ciSnippet: CI_SNIPPET,
		errors: [],
		warnings: warnings.sort(compare)
	};
}
