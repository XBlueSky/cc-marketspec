import { randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
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

export function defaultOutputPath(layout: LayoutKind): string {
	return layout === 'legacy' ? 'manifest.json' : DIST_MANIFEST_PATH;
}

function writeTextAtomic(root: string, relativePath: string, content: string): void {
	const targetBeforeCreate = resolveWithinRoot(root, relativePath);
	mkdirSync(dirname(targetBeforeCreate), { recursive: true });

	// Re-resolve after mkdir so a symlink introduced at the new parent is rejected.
	const target = resolveWithinRoot(root, relativePath);
	const temporaryRelative = `${relativePath}.tmp-${randomUUID()}`;
	const temporary = resolveWithinRoot(root, temporaryRelative);
	let descriptor: number | undefined;
	try {
		descriptor = openSync(temporary, 'wx', 0o600);
		writeFileSync(descriptor, content, 'utf8');
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		renameSync(temporary, target);
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

export function ensureNamespacedDistIgnore(root: string): string[] {
	const path = resolveWithinRoot(root, SPEC_GITIGNORE_PATH);
	if (!existsSync(path)) {
		writeTextAtomic(root, SPEC_GITIGNORE_PATH, DIST_IGNORE_CONTENT);
		return [];
	}
	const body = readFileSync(path, 'utf8');
	return body.split(/\r?\n/).some((line) => line.trim() === '/dist/')
		? []
		: [`${SPEC_GITIGNORE_PATH}: add /dist/ so generated output stays out of git`];
}

export function writeManifestOutput(root: string, relativePath: string, manifest: unknown): void {
	writeTextAtomic(root, relativePath, JSON.stringify(manifest, null, 2) + '\n');
}
