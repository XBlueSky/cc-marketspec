// Public API of cc-marketspec.
// Zod schemas double as runtime validators and (via z.infer) TS types.

export { Entry } from './entry.ts';
export { Catalog } from './catalog.ts';
export { Manifest } from './manifest.ts';
export { generateManifest, type GenerateResult } from './generate.ts';
export { type FileSource, NodeFileSource, MemoryFileSource } from './fs-source.ts';
export { extractNativeFacts, type NativeFacts } from './native.ts';
export { analyzeCoverage, type CoverageReport, type CoverageFinding, type CoverageConfig, type Severity } from './coverage.ts';
export { coverageTargets } from './entry.ts';
export { planInit, type InitAction, type InitPlan } from './init.ts';
export { handleHttpRequest } from './http.ts';
export {
	CURRENT_FORMAT_VERSION,
	LEGACY_FORMAT_VERSION,
	checkFormatVersion,
	checkManifestFormatVersion,
	type AuthoredLayout,
	type VersionCheck
} from './version.ts';
export { normalizeInternalPath, resolveWithinRoot, PathPolicyError } from './path-policy.ts';
export {
	DIST_IGNORE_CONTENT,
	defaultOutputPath,
	ensureNamespacedDistIgnore,
	writeManifestOutput
} from './output.ts';
export { OverlayFileSource } from './fs-source.ts';
export {
	CATALOG_PATH,
	DIST_MANIFEST_PATH,
	ENTRIES_DIR,
	LEGACY_CATALOG_PATH,
	LEGACY_MANIFEST_PATH,
	SPEC_DIR,
	SPEC_GITIGNORE_PATH,
	entryPathForLayout,
	entryPathForPlugin,
	inspectLayout,
	inspectLegacyCandidates,
	resolveMarketplacePlugins,
	type LayoutInspection,
	type LayoutKind,
	type LegacyInspection,
	type PluginResolution,
	type ResolvedPlugin
} from './layout.ts';
export {
	MIGRATION_RECEIPT_PATH,
	NODE_MIGRATION_FILE_OPS,
	applyMigration,
	planMigration,
	type MigrationFileOps,
	type MigrationOptions,
	type MigrationPlan,
	type MigrationResult,
	type PlannedRemoval
} from './migration.ts';
// Generated data needed by the companion MCP package (@xbluesky/cc-marketspec-mcp),
// which consumes the core exclusively through this public index.
export { AUTHORING } from './authoring.generated.ts';
export { SCHEMAS, VERSION } from './schemas.generated.ts';
