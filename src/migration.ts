import { createHash } from 'node:crypto';
import { isScalar, parseDocument } from 'yaml';
import { Catalog } from './catalog.ts';
import { Entry } from './entry.ts';
import { OverlayFileSource, type FileSource } from './fs-source.ts';
import { generateManifest } from './generate.ts';
import {
	CATALOG_PATH,
	DIST_MANIFEST_PATH,
	LEGACY_CATALOG_PATH,
	LEGACY_MANIFEST_PATH,
	SPEC_DIR,
	SPEC_GITIGNORE_PATH,
	inspectLayout,
	inspectLegacyCandidates,
	resolveMarketplacePlugins,
	type LegacyInspection,
	type ResolvedPlugin
} from './layout.ts';
import { loadYaml, readJSON } from './native.ts';
import { DIST_IGNORE_CONTENT } from './output.ts';
import { normalizeInternalPath } from './path-policy.ts';
import { CURRENT_FORMAT_VERSION, LEGACY_FORMAT_VERSION } from './version.ts';

export interface PlannedRemoval {
	path: string;
	digest: string;
}

export interface MigrationOptions {
	from?: 'legacy';
}

export interface MigrationPlan {
	kind: 'migrate' | 'cleanup' | 'noop';
	sourceVersion: '1.0' | '1.1' | null;
	targetVersion: '1.1';
	writes: Record<string, string>;
	removals: PlannedRemoval[];
	warnings: string[];
	errors: string[];
}

interface MigrationReceipt {
	receiptVersion: 1;
	sourceVersion: '1.0';
	targetVersion: '1.1';
	targetDigests: Record<string, string>;
	removals: PlannedRemoval[];
}

interface BuiltTarget {
	writes: Record<string, string>;
	removals: PlannedRemoval[];
	warnings: string[];
	errors: string[];
}

export const MIGRATION_RECEIPT_PATH = '.cc-marketspec/.migration-state.json';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const removal = (path: string, body: string): PlannedRemoval => ({ path, digest: digest(body) });
const uniqueSorted = (values: string[]) => [...new Set(values)].sort(compare);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) => {
	const expected = new Set(keys);
	return Object.keys(value).length === expected.size
		&& Object.keys(value).every((key) => expected.has(key));
};

function noop(
	sourceVersion: MigrationPlan['sourceVersion'],
	warnings: string[],
	errors: string[]
): MigrationPlan {
	return {
		kind: 'noop',
		sourceVersion,
		targetVersion: CURRENT_FORMAT_VERSION,
		writes: {},
		removals: [],
		warnings: uniqueSorted(warnings),
		errors: uniqueSorted(errors)
	};
}

function rewriteCatalogVersion(raw: string): { content?: string; error?: string } {
	try {
		const document = parseDocument(raw, { keepSourceTokens: true });
		if (document.errors.length > 0) {
			return {
				error: `catalog.yaml: ${document.errors.map((error) => error.message).join('; ')}`
			};
		}
		const versionNode = document.get('schemaVersion', true);
		if (!isScalar(versionNode) || typeof versionNode.value !== 'string') {
			return { error: 'catalog.yaml: schemaVersion must be a scalar string' };
		}
		versionNode.value = CURRENT_FORMAT_VERSION;
		return { content: document.toString({ lineWidth: 0 }) };
	} catch (error) {
		return {
			error: `catalog.yaml: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

function readMarketplace(source: FileSource): {
	plugins: ResolvedPlugin[];
	errors: string[];
	warnings: string[];
} {
	try {
		const marketplace: unknown = readJSON(source, '.claude-plugin/marketplace.json');
		if (!isRecord(marketplace)) {
			return {
				plugins: [],
				errors: ['.claude-plugin/marketplace.json: expected a JSON object'],
				warnings: []
			};
		}
		return resolveMarketplacePlugins(marketplace.plugins);
	} catch (error) {
		return {
			plugins: [],
			errors: [
				`cannot read .claude-plugin/marketplace.json: ${
					error instanceof Error ? error.message : String(error)
				}`
			],
			warnings: []
		};
	}
}

function buildTarget(
	source: FileSource,
	plugins: ResolvedPlugin[],
	legacy: LegacyInspection
): BuiltTarget {
	const errors = [...legacy.errors];
	const warnings: string[] = [];
	const catalogRaw = legacy.catalogRaw;
	const parsedCatalog = Catalog.safeParse(legacy.catalog);
	if (
		!parsedCatalog.success
		|| parsedCatalog.data.schemaVersion !== LEGACY_FORMAT_VERSION
		|| catalogRaw === null
	) {
		errors.push('catalog.yaml must be a valid schemaVersion 1.0 catalog before migration');
	}
	const rewritten = catalogRaw === null ? {} : rewriteCatalogVersion(catalogRaw);
	if (rewritten.error) errors.push(rewritten.error);
	if (errors.length > 0 || rewritten.content === undefined || catalogRaw === null) {
		return {
			writes: {},
			removals: [],
			warnings: uniqueSorted(warnings),
			errors: uniqueSorted(errors)
		};
	}

	const writes: Record<string, string> = {
		[SPEC_GITIGNORE_PATH]: '/dist/\n',
		[CATALOG_PATH]: rewritten.content
	};
	for (const plugin of plugins.slice().sort((left, right) => compare(left.id, right.id))) {
		const found = legacy.entries.get(plugin.id);
		if (found) writes[plugin.namespacedEntryPath] = found.raw;
	}

	const virtual = new OverlayFileSource(source, writes);
	const generated = generateManifest(virtual);
	errors.push(...generated.errors);
	warnings.push(
		...generated.warnings.filter((warning) => !/legacy files remain/i.test(warning))
	);
	if (errors.length === 0) {
		writes[DIST_MANIFEST_PATH] = JSON.stringify(generated.manifest, null, 2) + '\n';
	}

	const removals: PlannedRemoval[] = [removal(LEGACY_CATALOG_PATH, catalogRaw)];
	for (const { path, raw } of legacy.entries.values()) removals.push(removal(path, raw));
	const rootManifest = source.read(LEGACY_MANIFEST_PATH);
	if (rootManifest !== null && writes[DIST_MANIFEST_PATH]) {
		const current = JSON.parse(writes[DIST_MANIFEST_PATH]) as Record<string, unknown>;
		const expectedLegacy =
			JSON.stringify({ ...current, schemaVersion: LEGACY_FORMAT_VERSION }, null, 2) + '\n';
		if (rootManifest === expectedLegacy) {
			removals.push(removal(LEGACY_MANIFEST_PATH, rootManifest));
		} else {
			warnings.push(
				'manifest.json is not byte-identical to cc-marketspec legacy output; left untouched'
			);
		}
	}

	if (errors.length > 0) {
		return {
			writes: {},
			removals: [],
			warnings: uniqueSorted(warnings),
			errors: uniqueSorted(errors)
		};
	}

	const sortedRemovals = removals.sort((left, right) => compare(left.path, right.path));
	const receipt: MigrationReceipt = {
		receiptVersion: 1,
		sourceVersion: LEGACY_FORMAT_VERSION,
		targetVersion: CURRENT_FORMAT_VERSION,
		targetDigests: Object.fromEntries(
			Object.entries(writes)
				.sort(([left], [right]) => compare(left, right))
				.map(([path, content]) => [path, digest(content)])
		),
		removals: sortedRemovals
	};
	writes[MIGRATION_RECEIPT_PATH] = JSON.stringify(receipt, null, 2) + '\n';
	return {
		writes,
		removals: sortedRemovals,
		warnings: uniqueSorted(warnings),
		errors: []
	};
}

function initialPlan(
	source: FileSource,
	plugins: ResolvedPlugin[],
	legacy: LegacyInspection,
	marketplaceWarnings: string[]
): MigrationPlan {
	if (source.exists(SPEC_DIR) || source.isSymbolicLink?.(SPEC_DIR)) {
		return noop(LEGACY_FORMAT_VERSION, marketplaceWarnings, [
			`${SPEC_DIR}: migration target already exists`
		]);
	}
	const built = buildTarget(source, plugins, legacy);
	if (built.errors.length > 0) {
		return noop(LEGACY_FORMAT_VERSION, [...marketplaceWarnings, ...built.warnings], built.errors);
	}
	return {
		kind: 'migrate',
		sourceVersion: LEGACY_FORMAT_VERSION,
		targetVersion: CURRENT_FORMAT_VERSION,
		writes: built.writes,
		removals: built.removals,
		warnings: uniqueSorted([...marketplaceWarnings, ...built.warnings]),
		errors: []
	};
}

function parseReceipt(raw: string): { receipt?: MigrationReceipt; error?: string } {
	try {
		const value: unknown = JSON.parse(raw);
		const isDigest = (candidate: unknown): candidate is string =>
			typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate);
		const safePath = (path: string, insideSpec: boolean): boolean => {
			try {
				const normalized = normalizeInternalPath(path);
				return normalized === path
					&& (insideSpec
						? path.startsWith(SPEC_DIR + '/')
						: !path.startsWith(SPEC_DIR + '/'));
			} catch {
				return false;
			}
		};
		if (
			!isRecord(value)
			|| !hasOnlyKeys(value, [
				'receiptVersion',
				'sourceVersion',
				'targetVersion',
				'targetDigests',
				'removals'
			])
			|| value.receiptVersion !== 1
			|| value.sourceVersion !== LEGACY_FORMAT_VERSION
			|| value.targetVersion !== CURRENT_FORMAT_VERSION
		) {
			return { error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt` };
		}
		const targetDigests = value.targetDigests;
		const receiptRemovals = value.removals;
		if (!isRecord(targetDigests) || !Array.isArray(receiptRemovals)) {
			return { error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt` };
		}
		const validTargets =
			Object.entries(targetDigests).every(
				([path, hash]) =>
					safePath(path, true)
					&& path !== MIGRATION_RECEIPT_PATH
					&& isDigest(hash)
			)
			&& [SPEC_GITIGNORE_PATH, CATALOG_PATH, DIST_MANIFEST_PATH].every((path) =>
				isDigest(targetDigests[path])
			);
		const validRemovals = receiptRemovals.every(
			(item) =>
				isRecord(item)
				&& hasOnlyKeys(item, ['path', 'digest'])
				&& typeof item.path === 'string'
				&& safePath(item.path, false)
				&& isDigest(item.digest)
		);
		const removalPaths = receiptRemovals
			.filter(isRecord)
			.map((item) => item.path)
			.filter((path): path is string => typeof path === 'string');
		if (
			!validTargets
			|| !validRemovals
			|| new Set(removalPaths).size !== removalPaths.length
		) {
			return { error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt` };
		}
		return { receipt: value as unknown as MigrationReceipt };
	} catch (error) {
		return {
			error: `${MIGRATION_RECEIPT_PATH}: malformed migration receipt: ${
				error instanceof Error ? error.message : String(error)
			}`
		};
	}
}

function isRemainingLegacyCatalog(source: FileSource, path: string): boolean {
	try {
		const parsed = Catalog.safeParse(loadYaml(source, path));
		return parsed.success && parsed.data.schemaVersion === LEGACY_FORMAT_VERSION;
	} catch {
		return false;
	}
}

function isRemainingEntry(source: FileSource, path: string): boolean {
	try {
		return Entry.safeParse(loadYaml(source, path)).success;
	} catch {
		return false;
	}
}

function cleanupPlan(
	source: FileSource,
	rawReceipt: string,
	plugins: ResolvedPlugin[],
	marketplaceWarnings: string[]
): MigrationPlan {
	const parsed = parseReceipt(rawReceipt);
	const errors: string[] = parsed.error ? [parsed.error] : [];
	const receipt = parsed.receipt;
	if (receipt) {
		const pluginByLegacyPath = new Map(
			plugins.flatMap((plugin) =>
				plugin.legacyEntryPath === null
					? []
					: [[plugin.legacyEntryPath, plugin] as const]
			)
		);
		const allowedRemovals = new Set([
			LEGACY_CATALOG_PATH,
			LEGACY_MANIFEST_PATH,
			...pluginByLegacyPath.keys()
		]);
		const allowedTargets = new Set([
			SPEC_GITIGNORE_PATH,
			CATALOG_PATH,
			DIST_MANIFEST_PATH,
			...plugins.map((plugin) => plugin.namespacedEntryPath)
		]);
		const removalPaths = new Set(receipt.removals.map((item) => item.path));
		if (!removalPaths.has(LEGACY_CATALOG_PATH)) {
			errors.push(`${MIGRATION_RECEIPT_PATH}: receipt lacks legacy catalog provenance`);
		}
		if (source.read(SPEC_GITIGNORE_PATH) !== DIST_IGNORE_CONTENT) {
			errors.push(
				`${SPEC_GITIGNORE_PATH}: migration-owned content must remain exactly /dist/`
			);
		}
		const legacyCatalog = source.read(LEGACY_CATALOG_PATH);
		if (legacyCatalog !== null) {
			const rewritten = rewriteCatalogVersion(legacyCatalog);
			if (
				rewritten.content === undefined
				|| rewritten.content !== source.read(CATALOG_PATH)
			) {
				errors.push(
					`${LEGACY_CATALOG_PATH}: remaining source does not byte-match canonical ${CATALOG_PATH} after version rewrite`
				);
			}
		}
		for (const plugin of plugins) {
			const targetBody = source.read(plugin.namespacedEntryPath);
			const legacyBody = plugin.legacyEntryPath === null
				? null
				: source.read(plugin.legacyEntryPath);
			if (
				(targetBody !== null || legacyBody !== null)
				&& !(plugin.namespacedEntryPath in receipt.targetDigests)
			) {
				errors.push(
					`${plugin.namespacedEntryPath}: target digest missing from migration receipt`
				);
			}
			if (
				(targetBody !== null || legacyBody !== null)
				&& (
					plugin.legacyEntryPath === null
					|| !removalPaths.has(plugin.legacyEntryPath)
				)
			) {
				errors.push(
					`${plugin.namespacedEntryPath}: legacy removal provenance missing from migration receipt`
				);
			}
			if (legacyBody !== null) {
				if (targetBody === null) {
					errors.push(
						`${plugin.namespacedEntryPath}: canonical target missing for remaining ${plugin.legacyEntryPath}`
					);
				} else if (legacyBody !== targetBody) {
					errors.push(
						`${plugin.legacyEntryPath}: remaining source does not byte-match canonical ${plugin.namespacedEntryPath}`
					);
				}
				if (!isRemainingEntry(source, plugin.legacyEntryPath as string)) {
					errors.push(
						`${plugin.legacyEntryPath}: remaining source is not a cc-marketspec entry`
					);
				}
			}
		}
		for (const planned of receipt.removals) {
			if (!allowedRemovals.has(planned.path)) {
				errors.push(
					`${MIGRATION_RECEIPT_PATH}: unauthorized cleanup path ${planned.path}`
				);
				continue;
			}
			const plugin = pluginByLegacyPath.get(planned.path);
			if (plugin && !(plugin.namespacedEntryPath in receipt.targetDigests)) {
				errors.push(
					`${MIGRATION_RECEIPT_PATH}: target digest missing for migrated entry ${plugin.namespacedEntryPath}`
				);
			}
		}
		for (const path of Object.keys(receipt.targetDigests)) {
			if (!allowedTargets.has(path)) {
				errors.push(`${MIGRATION_RECEIPT_PATH}: unauthorized target path ${path}`);
				continue;
			}
			if (
				path !== SPEC_GITIGNORE_PATH
				&& path !== CATALOG_PATH
				&& path !== DIST_MANIFEST_PATH
			) {
				const plugin = plugins.find((candidate) => candidate.namespacedEntryPath === path);
				if (
					!plugin
					|| plugin.legacyEntryPath === null
					|| !removalPaths.has(plugin.legacyEntryPath)
				) {
					errors.push(
						`${MIGRATION_RECEIPT_PATH}: target entry lacks legacy provenance ${path}`
					);
				}
			}
		}
		for (const [path, expected] of Object.entries(receipt.targetDigests)) {
			const body = source.read(path);
			if (body === null || digest(body) !== expected) {
				errors.push(`${path}: target digest does not match migration receipt`);
			}
		}
		for (const planned of receipt.removals) {
			const body = source.read(planned.path);
			if (body !== null && digest(body) !== planned.digest) {
				errors.push(`${planned.path}: source changed after cutover; left untouched`);
				continue;
			}
			if (
				body !== null
				&& planned.path === LEGACY_CATALOG_PATH
				&& !isRemainingLegacyCatalog(source, planned.path)
			) {
				errors.push(
					`${planned.path}: remaining source is not a legacy cc-marketspec catalog`
				);
			}
			if (
				body !== null
				&& pluginByLegacyPath.has(planned.path)
				&& !isRemainingEntry(source, planned.path)
			) {
				errors.push(`${planned.path}: remaining source is not a cc-marketspec entry`);
			}
			if (body !== null && planned.path === LEGACY_MANIFEST_PATH) {
				const current = source.read(DIST_MANIFEST_PATH);
				try {
					const namespaced = JSON.parse(current ?? '') as Record<string, unknown>;
					const expectedLegacy =
						JSON.stringify(
							{ ...namespaced, schemaVersion: LEGACY_FORMAT_VERSION },
							null,
							2
						) + '\n';
					if (body !== expectedLegacy) {
						errors.push(
							`${planned.path}: no longer matches derived legacy output; left untouched`
						);
					}
				} catch {
					errors.push(
						`${planned.path}: cannot prove legacy manifest ownership; left untouched`
					);
				}
			}
		}
	}

	const validation = generateManifest(source);
	errors.push(...validation.errors);
	if (validation.errors.length === 0) {
		const onDiskManifest = source.read(DIST_MANIFEST_PATH);
		const regeneratedManifest = JSON.stringify(validation.manifest, null, 2) + '\n';
		if (onDiskManifest !== regeneratedManifest) {
			errors.push(
				`${DIST_MANIFEST_PATH}: generated bytes changed after cutover; cleanup is unsafe`
			);
		}
	}
	if (errors.length > 0 || !receipt) {
		return noop(CURRENT_FORMAT_VERSION, marketplaceWarnings, errors);
	}
	return {
		kind: 'cleanup',
		sourceVersion: CURRENT_FORMAT_VERSION,
		targetVersion: CURRENT_FORMAT_VERSION,
		writes: {},
		removals: receipt.removals,
		warnings: uniqueSorted([
			...marketplaceWarnings,
			'resuming cleanup from migration receipt'
		]),
		errors: []
	};
}

function planMigrationUnchecked(source: FileSource, options: MigrationOptions): MigrationPlan {
	if (options.from !== undefined && options.from !== 'legacy') {
		return noop(null, [], ['migration --from must be "legacy"']);
	}
	const marketplace = readMarketplace(source);
	if (marketplace.errors.length > 0) {
		return noop(null, marketplace.warnings, marketplace.errors);
	}
	const layout = inspectLayout(source, marketplace.plugins);
	if (layout.kind === 'namespaced') {
		const rawReceipt = source.read(MIGRATION_RECEIPT_PATH);
		if (rawReceipt !== null) {
			return cleanupPlan(source, rawReceipt, marketplace.plugins, marketplace.warnings);
		}
		const validation = generateManifest(source);
		return noop(
			CURRENT_FORMAT_VERSION,
			[
				...marketplace.warnings,
				...validation.warnings,
				...(layout.legacy.hasCandidates
					? ['generic legacy-named files exist without a migration receipt; left untouched']
					: [])
			],
			validation.errors
		);
	}
	if (layout.kind === 'fresh') {
		return noop(null, [
			...marketplace.warnings,
			'no legacy cc-marketspec authoring files found'
		], []);
	}
	if (layout.kind === 'ambiguous' && options.from !== 'legacy') {
		return noop(null, marketplace.warnings, [
			'ambiguous generic files require cc-marketspec migrate --from legacy'
		]);
	}
	const legacy = inspectLegacyCandidates(source, marketplace.plugins);
	return initialPlan(source, marketplace.plugins, legacy, marketplace.warnings);
}

export function planMigration(
	source: FileSource,
	options: MigrationOptions = {}
): MigrationPlan {
	try {
		return planMigrationUnchecked(source, options);
	} catch (error) {
		return noop(null, [], [error instanceof Error ? error.message : String(error)]);
	}
}
