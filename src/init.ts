// Detection-based, non-destructive scaffold. Pure over a FileSource: decides what
// to create vs skip and returns the writes for the CLI to flush to disk.
import { join, basename } from 'node:path';
import type { FileSource } from './fs-source.ts';
import { readJSON } from './native.ts';

export interface InitAction { path: string; status: 'created' | 'skipped'; reason?: string }

const CATALOG_TEMPLATE = `# Marketplace-level presentation data. Native metadata (name/owner) lives in
# .claude-plugin/marketplace.json and is NOT restated here.
schemaVersion: "1.0"
lang: en
groups:
  - id: examples
    label: Examples
    note: Illustrative plugins
# Optional: tune the coverage gate. Keys are <component>.<field> or "*".
# coverage:
#   skill.trigger: warn
`;

const CI_SNIPPET = `# Add to your CI (any platform). Gate presentation/native consistency on PRs:
#   npx @xbluesky/cc-marketspec --check
# On merge, regenerate the manifest:
#   npx @xbluesky/cc-marketspec
`;

function entryTemplate(pluginId: string): string {
	return `# Presentation overlay for ${pluginId}. Every field is optional — native data
# already yields a valid manifest; this only enriches it.
# yaml-language-server: $schema=node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json
# tagline: TODO one-line summary
# intro: TODO full lede
`;
}

export function planInit(source: FileSource): {
	actions: InitAction[];
	writes: Record<string, string>;
	ciSnippet: string;
} {
	const actions: InitAction[] = [];
	const writes: Record<string, string> = {};

	if (source.exists('catalog.yaml')) {
		actions.push({ path: 'catalog.yaml', status: 'skipped', reason: 'already exists' });
	} else {
		writes['catalog.yaml'] = CATALOG_TEMPLATE;
		actions.push({ path: 'catalog.yaml', status: 'created' });
	}

	let market: { plugins?: { name?: string; source?: string }[] } = {};
	try {
		market = readJSON(source, join('.claude-plugin', 'marketplace.json'));
	} catch {
		// no marketplace.json — nothing to scaffold per-plugin; catalog + CI snippet still useful
	}
	for (const e of market.plugins ?? []) {
		const id = e.source ? basename(e.source) : (e.name ?? '');
		if (!id) continue;
		const p = join('plugins', id, 'entry.yaml');
		if (source.exists(p)) {
			actions.push({ path: p, status: 'skipped', reason: 'already exists' });
		} else if (source.exists(join('plugins', id, '.claude-plugin', 'plugin.json'))) {
			writes[p] = entryTemplate(id);
			actions.push({ path: p, status: 'created' });
		}
	}
	return { actions, writes, ciSnippet: CI_SNIPPET };
}
