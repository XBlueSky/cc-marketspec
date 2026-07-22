import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { isScalar, parseDocument } from 'yaml';
import { Catalog } from './catalog.ts';
import { Entry } from './entry.ts';
import { NodeFileSource, OverlayFileSource, type FileSource } from './fs-source.ts';
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
import { normalizeInternalPath, resolveWithinRoot } from './path-policy.ts';
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

export interface MigrationFileOps {
	exists(path: string): boolean;
	isSymbolicLink(path: string): boolean;
	mkdir(path: string): void;
	mkdtemp(prefix: string): string;
	read(path: string): string;
	writeExclusive(path: string, content: string): void;
	rename(from: string, to: string): void;
	unlink(path: string): void;
	removeTree(path: string): void;
	list(path: string): string[];
}

export interface MigrationResult {
	changed: boolean;
	errors: string[];
	warnings: string[];
}

export const NODE_MIGRATION_FILE_OPS: MigrationFileOps = {
	exists: existsSync,
	isSymbolicLink: (path) => {
		try {
			return lstatSync(path).isSymbolicLink();
		} catch {
			return false;
		}
	},
	mkdir: (path) => mkdirSync(path, { recursive: true }),
	mkdtemp: mkdtempSync,
	read: (path) => readFileSync(path, 'utf8'),
	writeExclusive: (path, content) =>
		writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' }),
	rename: renameSync,
	unlink: unlinkSync,
	removeTree: (path) => rmSync(path, { recursive: true, force: true }),
	list: (path) => readdirSync(path).sort(compare)
};

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

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sameRemovals(left: PlannedRemoval[], right: PlannedRemoval[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateMigratePlan(root: string, plan: MigrationPlan): string[] {
	const canonical = planMigration(new NodeFileSource(root), { from: 'legacy' });
	if (
		canonical.kind !== 'migrate'
		|| canonical.errors.length > 0
		|| canonical.sourceVersion !== LEGACY_FORMAT_VERSION
		|| canonical.targetVersion !== CURRENT_FORMAT_VERSION
	) {
		return uniqueSorted([
			...(canonical.errors.some((error) => /migration target already exists/i.test(error))
				? [SPEC_DIR + ': target appeared after planning; refusing overwrite']
				: ['migration plan failed authoritative canonical planning from the current on-disk legacy sources']),
			...canonical.errors
		]);
	}
	const canonicalWritePaths = Object.keys(canonical.writes).sort(compare);
	const actualWritePaths = Object.keys(plan.writes).sort(compare);
	const canonicalErrors: string[] = [];
	if (JSON.stringify(actualWritePaths) !== JSON.stringify(canonicalWritePaths)) {
		canonicalErrors.push(
			'migration plan writes do not exactly match the authoritative canonical migration plan'
		);
	}
	for (const path of canonicalWritePaths) {
		if (plan.writes[path] !== canonical.writes[path]) {
			canonicalErrors.push(
				path + ': migration plan bytes do not match the authoritative canonical migration plan'
			);
		}
	}
	if (!sameRemovals(plan.removals, canonical.removals)) {
		canonicalErrors.push(
			'migration plan removals do not exactly match the authoritative canonical migration plan'
		);
	}
	if (canonicalErrors.length > 0) return uniqueSorted(canonicalErrors);

	const errors: string[] = [];
	const receiptRaw = plan.writes[MIGRATION_RECEIPT_PATH];
	if (receiptRaw === undefined) {
		return [MIGRATION_RECEIPT_PATH + ': migrate plan lacks its required receipt'];
	}
	const parsed = parseReceipt(receiptRaw);
	if (parsed.error || !parsed.receipt) return [parsed.error ?? 'malformed migration receipt'];
	const receipt = parsed.receipt;
	const expectedWrites = [...Object.keys(receipt.targetDigests), MIGRATION_RECEIPT_PATH]
		.sort(compare);
	const actualWrites = Object.keys(plan.writes).sort(compare);
	if (JSON.stringify(actualWrites) !== JSON.stringify(expectedWrites)) {
		errors.push('migration plan writes do not exactly match receipt targets');
	}
	for (const [path, expected] of Object.entries(receipt.targetDigests)) {
		const body = plan.writes[path];
		if (body === undefined || digest(body) !== expected) {
			errors.push(path + ': migration plan bytes do not match receipt digest');
		}
	}
	if (!sameRemovals(plan.removals, receipt.removals)) {
		errors.push('migration plan removals do not exactly match its receipt');
	}
	if (
		plan.sourceVersion !== LEGACY_FORMAT_VERSION
		|| plan.targetVersion !== CURRENT_FORMAT_VERSION
	) {
		errors.push('migration plan versions do not describe the supported 1.0 to 1.1 transition');
	}
	if (errors.length > 0) return uniqueSorted(errors);

	const proof = planMigration(
		new OverlayFileSource(new NodeFileSource(root), plan.writes)
	);
	if (
		proof.kind !== 'cleanup'
		|| proof.errors.length > 0
		|| !sameRemovals(proof.removals, plan.removals)
	) {
		return uniqueSorted([
			'migration plan failed authoritative ownership revalidation',
			...proof.errors
		]);
	}
	return [];
}

function validateCleanupPlan(root: string, plan: MigrationPlan): string[] {
	const proof = planMigration(new NodeFileSource(root));
	if (
		proof.kind !== 'cleanup'
		|| proof.errors.length > 0
		|| !sameRemovals(proof.removals, plan.removals)
	) {
		return uniqueSorted([
			'cleanup plan failed authoritative ownership revalidation',
			...proof.errors
		]);
	}
	if (Object.keys(plan.writes).length > 0) {
		return ['cleanup plan must not contain writes'];
	}
	return [];
}

function targetOccupied(path: string, fileOps: MigrationFileOps): boolean {
	return fileOps.exists(path) || fileOps.isSymbolicLink(path);
}

function assertStagedTree(
	staging: string,
	writes: Record<string, string>,
	fileOps: MigrationFileOps
): void {
	const expectedChildren = new Map<string, Set<string>>();
	expectedChildren.set('', new Set());
	for (const targetPath of Object.keys(writes)) {
		const relativePath = targetPath.slice((SPEC_DIR + '/').length);
		const parts = relativePath.split('/');
		for (let index = 0; index < parts.length; index += 1) {
			const parent = parts.slice(0, index).join('/');
			const children = expectedChildren.get(parent) ?? new Set<string>();
			children.add(parts[index]);
			expectedChildren.set(parent, children);
			if (index < parts.length - 1 && !expectedChildren.has(parts.slice(0, index + 1).join('/'))) {
				expectedChildren.set(parts.slice(0, index + 1).join('/'), new Set());
			}
		}
	}
	for (const [directory, children] of expectedChildren) {
		const absolute = resolveWithinRoot(staging, directory, { allowRoot: true });
		const actual = fileOps.list(absolute);
		const expected = [...children].sort(compare);
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(
				'staged tree differs from migration plan at '
				+ (directory || SPEC_DIR)
			);
		}
	}
	for (const [targetPath, expected] of Object.entries(writes)) {
		const relativePath = targetPath.slice((SPEC_DIR + '/').length);
		const absolute = resolveWithinRoot(staging, relativePath);
		if (fileOps.read(absolute) !== expected) {
			throw new Error(targetPath + ': staged bytes differ from the migration plan');
		}
	}
}

function applyRemovals(
	root: string,
	removals: PlannedRemoval[],
	fileOps: MigrationFileOps
): { changed: number; errors: string[] } {
	const errors: string[] = [];
	let changed = 0;
	for (const planned of removals) {
		try {
			const absolute = resolveWithinRoot(root, planned.path);
			if (fileOps.isSymbolicLink(absolute)) {
				errors.push(planned.path + ': changed since planning; left untouched');
				continue;
			}
			if (!fileOps.exists(absolute)) continue;
			if (digest(fileOps.read(absolute)) !== planned.digest) {
				errors.push(planned.path + ': changed since planning; left untouched');
				continue;
			}
			fileOps.unlink(absolute);
			changed += 1;
		} catch (error) {
			errors.push(planned.path + ': cleanup failed: ' + describe(error));
		}
	}
	return { changed, errors: uniqueSorted(errors) };
}

function finishCleanup(
	root: string,
	removals: PlannedRemoval[],
	fileOps: MigrationFileOps
): { changed: number; errors: string[] } {
	const result = applyRemovals(root, removals, fileOps);
	if (result.errors.length > 0) return result;
	try {
		const receipt = resolveWithinRoot(root, MIGRATION_RECEIPT_PATH);
		if (fileOps.isSymbolicLink(receipt)) {
			result.errors.push(MIGRATION_RECEIPT_PATH + ': cleanup failed: symbolic link is unsafe');
		} else if (fileOps.exists(receipt)) {
			fileOps.unlink(receipt);
			result.changed += 1;
		}
	} catch (error) {
		result.errors.push(MIGRATION_RECEIPT_PATH + ': cleanup failed: ' + describe(error));
	}
	return result;
}

function applyMigrationUnchecked(
	root: string,
	plan: MigrationPlan,
	fileOps: MigrationFileOps
): MigrationResult {
	if (plan.errors.length > 0) {
		return { changed: false, errors: plan.errors, warnings: plan.warnings };
	}
	if (plan.kind === 'noop') {
		return { changed: false, errors: [], warnings: plan.warnings };
	}
	if (plan.kind === 'cleanup') {
		const authorityErrors = validateCleanupPlan(root, plan);
		if (authorityErrors.length > 0) {
			return { changed: false, errors: authorityErrors, warnings: plan.warnings };
		}
		const cleanup = finishCleanup(root, plan.removals, fileOps);
		return {
			changed: cleanup.changed > 0,
			errors: cleanup.errors,
			warnings: plan.warnings
		};
	}

	const authorityErrors = validateMigratePlan(root, plan);
	if (authorityErrors.length > 0) {
		return { changed: false, errors: authorityErrors, warnings: plan.warnings };
	}
	const target = resolveWithinRoot(root, SPEC_DIR);
	if (targetOccupied(target, fileOps)) {
		return {
			changed: false,
			errors: [SPEC_DIR + ': target appeared after planning; refusing overwrite'],
			warnings: plan.warnings
		};
	}

	const rootDirectory = dirname(resolveWithinRoot(root, '.cc-marketspec-migrate-anchor'));
	const stagingPrefixName = '.cc-marketspec-migrate-';
	let ownedStaging: string | undefined;
	let cutOver = false;
	try {
		const returnedStaging = resolve(
			fileOps.mkdtemp(resolve(rootDirectory, stagingPrefixName))
		);
		if (
			dirname(returnedStaging) !== rootDirectory
			|| !basename(returnedStaging).startsWith(stagingPrefixName)
		) {
			throw new Error('filesystem returned an unsafe migration staging directory');
		}
		const checkedStaging = resolveWithinRoot(root, basename(returnedStaging));
		if (checkedStaging !== returnedStaging || fileOps.isSymbolicLink(checkedStaging)) {
			throw new Error('filesystem returned an unsafe migration staging directory');
		}
		ownedStaging = checkedStaging;

		for (const [targetPath, content] of Object.entries(plan.writes).sort(
			([left], [right]) => compare(left, right)
		)) {
			const normalized = normalizeInternalPath(targetPath);
			if (normalized !== targetPath || !targetPath.startsWith(SPEC_DIR + '/')) {
				throw new Error('unexpected migration target ' + targetPath);
			}
			const stagedRelative = targetPath.slice((SPEC_DIR + '/').length);
			const stagedAbsolute = resolveWithinRoot(ownedStaging, stagedRelative);
			fileOps.mkdir(dirname(stagedAbsolute));
			fileOps.writeExclusive(stagedAbsolute, content);
		}

		assertStagedTree(ownedStaging, plan.writes, fileOps);
		const stagedWrites: Record<string, string> = {};
		for (const targetPath of Object.keys(plan.writes).sort(compare)) {
			const stagedRelative = targetPath.slice((SPEC_DIR + '/').length);
			stagedWrites[targetPath] = fileOps.read(
				resolveWithinRoot(ownedStaging, stagedRelative)
			);
		}
		const validation = generateManifest(
			new OverlayFileSource(new NodeFileSource(root), stagedWrites)
		);
		if (validation.errors.length > 0) {
			throw new Error('staged validation failed: ' + validation.errors.join('; '));
		}
		const validatedManifest = JSON.stringify(validation.manifest, null, 2) + '\n';
		if (validatedManifest !== stagedWrites[DIST_MANIFEST_PATH]) {
			throw new Error('staged validation manifest bytes differ from the migration plan');
		}

		if (targetOccupied(target, fileOps)) {
			throw new Error(SPEC_DIR + ': target appeared after staging; refusing overwrite');
		}
		resolveWithinRoot(root, SPEC_DIR);
		fileOps.rename(ownedStaging, target);
		cutOver = true;
		ownedStaging = undefined;
		if (!fileOps.exists(target) || fileOps.isSymbolicLink(target)) {
			throw new Error(SPEC_DIR + ': cutover did not publish a safe complete target');
		}
		const published = planMigration(new NodeFileSource(root));
		if (
			published.kind !== 'cleanup'
			|| published.errors.length > 0
			|| !sameRemovals(published.removals, plan.removals)
		) {
			throw new Error([
				'published target failed authoritative cleanup revalidation',
				...published.errors
			].join(': '));
		}
	} catch (error) {
		const errors = ['migration cutover failed: ' + describe(error)];
		if (!cutOver && ownedStaging !== undefined) {
			try {
				fileOps.removeTree(ownedStaging);
			} catch (cleanupError) {
				errors.push('staging cleanup failed: ' + describe(cleanupError));
			}
		}
		return { changed: cutOver, errors, warnings: plan.warnings };
	}

	const cleanup = finishCleanup(root, plan.removals, fileOps);
	return { changed: true, errors: cleanup.errors, warnings: plan.warnings };
}

export function applyMigration(
	root: string,
	plan: MigrationPlan,
	fileOps: MigrationFileOps = NODE_MIGRATION_FILE_OPS
): MigrationResult {
	try {
		return applyMigrationUnchecked(root, plan, fileOps);
	} catch (error) {
		return {
			changed: false,
			errors: ['migration apply failed: ' + describe(error)],
			warnings: plan.warnings
		};
	}
}
