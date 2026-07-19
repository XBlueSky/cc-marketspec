import { posix } from 'node:path';
import { Catalog } from './catalog.ts';
import { Entry } from './entry.ts';
import type { FileSource } from './fs-source.ts';
import { normalizeInternalPath } from './path-policy.ts';
import { loadYaml } from './native.ts';
import { LEGACY_FORMAT_VERSION } from './version.ts';

export const SPEC_DIR = '.cc-marketspec';
export const CATALOG_PATH = '.cc-marketspec/catalog.yaml';
export const ENTRIES_DIR = '.cc-marketspec/entries';
export const DIST_MANIFEST_PATH = '.cc-marketspec/dist/manifest.json';
export const SPEC_GITIGNORE_PATH = '.cc-marketspec/.gitignore';
export const LEGACY_CATALOG_PATH = 'catalog.yaml';
export const LEGACY_MANIFEST_PATH = 'manifest.json';

export type LayoutKind = 'namespaced' | 'legacy' | 'fresh' | 'ambiguous';

export interface ResolvedPlugin {
	id: string;
	dir: string | null;
	sourceKind: 'local' | 'remote';
	marketEntry: Record<string, unknown>;
	namespacedEntryPath: string;
	legacyEntryPath: string | null;
}

export interface PluginResolution {
	plugins: ResolvedPlugin[];
	errors: string[];
	warnings: string[];
}

export interface LegacyInspection {
	hasCandidates: boolean;
	strong: boolean;
	catalog: unknown;
	catalogRaw: string | null;
	entries: Map<string, { path: string; raw: string }>;
	errors: string[];
}

export interface LayoutInspection {
	kind: LayoutKind;
	catalogPath: string | null;
	errors: string[];
	warnings: string[];
	legacy: LegacyInspection;
}

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function entryPathForPlugin(id: string): string {
	if (!ID.test(id)) throw new Error(`unsafe plugin id "${id}"; expected kebab-case`);
	return posix.join(ENTRIES_DIR, `plugin-${id}.yaml`);
}

export function resolveMarketplacePlugins(raw: unknown): PluginResolution {
	const errors: string[] = [];
	const warnings: string[] = [];
	const plugins: ResolvedPlugin[] = [];
	const ids = new Set<string>();
	const legacyPaths = new Map<string, string>();
	if (!Array.isArray(raw)) return { plugins, errors: ['marketplace.json plugins must be an array'], warnings };

	for (const value of raw) {
		const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
		const id = typeof entry.name === 'string' ? entry.name : '';
		if (!ID.test(id)) {
			errors.push(`marketplace plugin id "${id}" must be kebab-case`);
			continue;
		}
		if (ids.has(id)) errors.push(`duplicate plugin id "${id}"`);
		ids.add(id);

		let dir: string | null;
		let sourceKind: 'local' | 'remote';
		if (entry.source === undefined) {
			dir = posix.join('plugins', id);
			sourceKind = 'local';
			warnings.push(`${id}: implicit plugins/${id} source is deprecated; add source: "./plugins/${id}"`);
		} else if (typeof entry.source === 'string') {
			if (!entry.source.startsWith('./')) {
				errors.push(`${id}: local source must start with ./`);
				continue;
			}
			try {
				dir = normalizeInternalPath(entry.source.slice(2), { allowRoot: true });
			} catch (error) {
				errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			sourceKind = 'local';
		} else if (entry.source && typeof entry.source === 'object') {
			dir = null;
			sourceKind = 'remote';
		} else {
			errors.push(`${id}: source must be a ./ local path or a remote source object`);
			continue;
		}

		const legacyEntryPath = dir === null ? null : posix.join(dir, 'entry.yaml');
		if (legacyEntryPath !== null) {
			const prior = legacyPaths.get(legacyEntryPath);
			if (prior && prior !== id) {
				errors.push(`${prior} and ${id} resolve to the same legacy entry path ${legacyEntryPath}`);
			}
			legacyPaths.set(legacyEntryPath, id);
		}
		plugins.push({
			id,
			dir,
			sourceKind,
			marketEntry: entry,
			namespacedEntryPath: entryPathForPlugin(id),
			legacyEntryPath
		});
	}
	return { plugins, errors: errors.sort(compare), warnings: warnings.sort(compare) };
}

function parseYaml(source: FileSource, path: string): unknown {
	try {
		return loadYaml(source, path);
	} catch {
		return undefined;
	}
}

export function inspectLegacyCandidates(source: FileSource, plugins: ResolvedPlugin[]): LegacyInspection {
	const catalogRaw = source.read(LEGACY_CATALOG_PATH);
	const errors: string[] = [];
	const ids = new Set<string>();
	const legacyPaths = new Map<string, string>();
	const mappedPaths = new Set<string>();
	for (const plugin of plugins) {
		if (ids.has(plugin.id)) errors.push(`duplicate plugin id "${plugin.id}"`);
		ids.add(plugin.id);
		if (plugin.legacyEntryPath === null) continue;
		const prior = legacyPaths.get(plugin.legacyEntryPath);
		if (prior !== undefined) {
			errors.push(`${prior} and ${plugin.id} resolve to the same legacy entry path ${plugin.legacyEntryPath}`);
		}
		legacyPaths.set(plugin.legacyEntryPath, plugin.id);
		mappedPaths.add(plugin.legacyEntryPath);
	}

	const candidateEntries = plugins.filter(
		(plugin) => plugin.legacyEntryPath !== null && source.read(plugin.legacyEntryPath) !== null
	);
	const unmappedPaths = new Set<string>();
	const addUnmappedCandidate = (path: string) => {
		if (!mappedPaths.has(path) && source.read(path) !== null) unmappedPaths.add(path);
	};
	addUnmappedCandidate('entry.yaml');
	if (source.isDir('plugins')) {
		for (const name of source.list('plugins')) {
			addUnmappedCandidate(posix.join('plugins', name, 'entry.yaml'));
		}
	}
	for (const path of unmappedPaths) {
		errors.push(`${path} is not mapped to a marketplace plugin; add a matching source or remove the legacy entry`);
	}
	const hasCandidates = catalogRaw !== null || candidateEntries.length > 0 || unmappedPaths.size > 0;
	const entries = new Map<string, { path: string; raw: string }>();
	const catalog = catalogRaw === null ? null : parseYaml(source, LEGACY_CATALOG_PATH);
	const catalogResult = Catalog.safeParse(catalog);
	if (catalogRaw !== null && !catalogResult.success) {
		errors.push('catalog.yaml does not validate as a cc-marketspec catalog');
	}
	if (catalogResult.success && catalogResult.data.schemaVersion !== LEGACY_FORMAT_VERSION) {
		errors.push(`catalog.yaml schemaVersion must be ${LEGACY_FORMAT_VERSION} for legacy layout`);
	}
	for (const plugin of candidateEntries) {
		const path = plugin.legacyEntryPath as string;
		const raw = source.read(path) as string;
		if (!Entry.safeParse(parseYaml(source, path)).success) {
			errors.push(`${path} does not validate as a cc-marketspec entry`);
		} else {
			entries.set(plugin.id, { path, raw });
		}
	}
	const strong =
		catalogResult.success &&
		catalogResult.data.schemaVersion === LEGACY_FORMAT_VERSION &&
		entries.size > 0 &&
		errors.length === 0;
	return { hasCandidates, strong, catalog, catalogRaw, entries, errors: errors.sort(compare) };
}

export function inspectLayout(source: FileSource, plugins: ResolvedPlugin[]): LayoutInspection {
	const legacy = inspectLegacyCandidates(source, plugins);
	const namespacedEntryNames = source.isDir(ENTRIES_DIR) ? source.list(ENTRIES_DIR) : [];
	const namespacedCandidates =
		source.read(CATALOG_PATH) !== null ||
		namespacedEntryNames.some((name) => source.read(posix.join(ENTRIES_DIR, name)) !== null);
	if (namespacedCandidates) {
		const expected = new Set(plugins.map((plugin) => posix.basename(plugin.namespacedEntryPath)));
		const warnings = namespacedEntryNames.length > 0
			? namespacedEntryNames
					.filter((name) => name.endsWith('.yaml') && !expected.has(name))
					.map((name) => `${posix.join(ENTRIES_DIR, name)}: orphan entry has no marketplace plugin`)
			: [];
		if (legacy.strong) {
			warnings.push('recognized legacy files remain; run cc-marketspec migrate to resume safe cleanup');
		}
		return { kind: 'namespaced', catalogPath: CATALOG_PATH, errors: [], warnings: warnings.sort(compare), legacy };
	}
	if (!legacy.hasCandidates) return { kind: 'fresh', catalogPath: null, errors: [], warnings: [], legacy };
	if (legacy.strong) {
		return {
			kind: 'legacy',
			catalogPath: LEGACY_CATALOG_PATH,
			errors: [],
			warnings: ['legacy layout is deprecated; run cc-marketspec migrate'],
			legacy
		};
	}
	return {
		kind: 'ambiguous',
		catalogPath: null,
		errors: ['generic catalog.yaml/entry.yaml candidates cannot be safely claimed; run cc-marketspec migrate --from legacy'],
		warnings: [],
		legacy
	};
}

export function entryPathForLayout(layout: LayoutKind, plugin: ResolvedPlugin): string | null {
	if (layout === 'namespaced') return plugin.namespacedEntryPath;
	if (layout === 'legacy') return plugin.legacyEntryPath;
	return null;
}
