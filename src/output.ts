import { randomUUID } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { DIST_MANIFEST_PATH, SPEC_GITIGNORE_PATH, type LayoutKind } from './layout.ts';
import { resolveWithinRoot } from './path-policy.ts';

export const DIST_IGNORE_CONTENT = '/dist/\n';

/** @internal Low-level failure-injection seam; not a stable package API. */
export interface OutputWriteOperations {
	randomUUID(): string;
	open(path: string, flags: string, mode: number): number;
	write(descriptor: number, content: string, encoding: BufferEncoding): void;
	fsync(descriptor: number): void;
	close(descriptor: number): void;
	rename(source: string, target: string): void;
	link(source: string, target: string): void;
	unlink(path: string): void;
}

const DEFAULT_OPERATIONS: OutputWriteOperations = {
	randomUUID,
	open: (path, flags, mode) => openSync(path, flags, mode),
	write: (descriptor, content, encoding) => writeFileSync(descriptor, content, encoding),
	fsync: fsyncSync,
	close: closeSync,
	rename: renameSync,
	link: linkSync,
	unlink: unlinkSync
};

function operationsWith(overrides: Partial<OutputWriteOperations>): OutputWriteOperations {
	return { ...DEFAULT_OPERATIONS, ...overrides };
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === 'object' && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function entryExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		throw error;
	}
}

export function defaultOutputPath(layout: LayoutKind): string {
	return layout === 'legacy' ? 'manifest.json' : DIST_MANIFEST_PATH;
}

type PublishMode = 'replace' | 'no-clobber';

/**
 * Security precondition: callers must ensure repository directories are not
 * maliciously or concurrently renamed/replaced during a write. Pure Node has
 * no portable directory-fd/openat API that can bind every lookup and mutation.
 * We therefore revalidate containment immediately before open, publish, and
 * cleanup as best-effort hardening, but those checks are not a hostile-race
 * guarantee. Publication is atomic to readers and the temporary file is
 * fsynced, but the parent directory is not: this is not a power-loss durability
 * guarantee on every filesystem.
 */
function writeTextAtomic(
	root: string,
	relativePath: string,
	content: string,
	mode: PublishMode,
	overrides: Partial<OutputWriteOperations>
): boolean {
	const operations = operationsWith(overrides);
	const targetBeforeCreate = resolveWithinRoot(root, relativePath);
	mkdirSync(dirname(targetBeforeCreate), { recursive: true });

	const target = resolveWithinRoot(root, relativePath);
	const temporaryRelative = `${relativePath}.tmp-${operations.randomUUID()}`;
	const temporary = resolveWithinRoot(root, temporaryRelative);
	let descriptor: number | undefined;
	let ownsTemporary = false;
	let published = false;
	let hasPrimaryError = false;
	let primaryError: unknown;
	let cleanupError: unknown;

	try {
		// Last safe containment check before exclusive creation of the temp file.
		const temporaryAtOpen = resolveWithinRoot(root, temporaryRelative);
		descriptor = operations.open(temporaryAtOpen, 'wx', 0o600);
		ownsTemporary = true;
		operations.write(descriptor, content, 'utf8');
		operations.fsync(descriptor);

		// A failed close must never be retried: close(2) may already have released
		// and reused the descriptor even when it reports an error.
		const descriptorToClose = descriptor;
		descriptor = undefined;
		operations.close(descriptorToClose);

		// Re-resolve both names at the last safe point before link/rename.
		const targetAtPublish = resolveWithinRoot(root, relativePath);
		const temporaryAtPublish = resolveWithinRoot(root, temporaryRelative);
		if (targetAtPublish !== target || temporaryAtPublish !== temporary) {
			throw new Error('output paths changed during write');
		}

		if (mode === 'no-clobber') {
			try {
				operations.link(temporaryAtPublish, targetAtPublish);
				published = true;
			} catch (error) {
				if (errorCode(error) !== 'EEXIST') throw error;
			}
		} else {
			operations.rename(temporaryAtPublish, targetAtPublish);
			ownsTemporary = false;
			published = true;
		}
	} catch (error) {
		hasPrimaryError = true;
		primaryError = error;
	} finally {
		if (descriptor !== undefined) {
			const descriptorToClose = descriptor;
			descriptor = undefined;
			try {
				operations.close(descriptorToClose);
			} catch (error) {
				cleanupError = error;
			}
		}
		if (ownsTemporary) {
			try {
				const temporaryAtCleanup = resolveWithinRoot(root, temporaryRelative);
				operations.unlink(temporaryAtCleanup);
			} catch (error) {
				if (errorCode(error) !== 'ENOENT' && cleanupError === undefined) cleanupError = error;
			}
		}
	}

	if (hasPrimaryError) throw primaryError;
	if (cleanupError !== undefined) throw cleanupError;
	return published;
}

function distIgnoreWarning(): string[] {
	return [`${SPEC_GITIGNORE_PATH}: add /dist/ so generated output stays out of git`];
}

function inspectExistingDistIgnore(root: string): string[] {
	const path = resolveWithinRoot(root, SPEC_GITIGNORE_PATH);
	if (!entryExists(path)) return distIgnoreWarning();
	let body: string;
	try {
		body = readFileSync(path, 'utf8');
	} catch (error) {
		// A dangling symlink is an existing user-owned directory entry. Preserve
		// it and report the policy warning rather than replacing it.
		if (errorCode(error) === 'ENOENT') return distIgnoreWarning();
		throw error;
	}
	return body.split(/\r?\n/).some((line) => line.trim() === '/dist/')
		? []
		: distIgnoreWarning();
}

export function ensureNamespacedDistIgnore(
	root: string,
	/** @internal */
	overrides: Partial<OutputWriteOperations> = {}
): string[] {
	const path = resolveWithinRoot(root, SPEC_GITIGNORE_PATH);
	if (entryExists(path)) return inspectExistingDistIgnore(root);
	const created = writeTextAtomic(root, SPEC_GITIGNORE_PATH, DIST_IGNORE_CONTENT, 'no-clobber', overrides);
	return created ? [] : inspectExistingDistIgnore(root);
}

function serializeManifest(manifest: unknown): string {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(manifest, null, 2);
	} catch {
		throw new TypeError('manifest must be JSON-serializable');
	}
	if (serialized === undefined) throw new TypeError('manifest must be JSON-serializable');
	return serialized + '\n';
}

export function writeManifestOutput(
	root: string,
	relativePath: string,
	manifest: unknown,
	/** @internal */
	overrides: Partial<OutputWriteOperations> = {}
): void {
	writeTextAtomic(root, relativePath, serializeManifest(manifest), 'replace', overrides);
}
