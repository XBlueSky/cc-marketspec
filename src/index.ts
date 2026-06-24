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
export { planInit, type InitAction } from './init.ts';
export { handleHttpRequest } from './http.ts';
