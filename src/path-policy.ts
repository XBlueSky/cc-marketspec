import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path';

export class PathPolicyError extends Error {}

export function normalizeInternalPath(raw: string, options: { allowRoot?: boolean } = {}): string {
	if (typeof raw !== 'string') throw new PathPolicyError('path must be a string');
	if (raw.includes('\\')) throw new PathPolicyError('internal paths must use POSIX separators');
	if (isAbsolute(raw) || win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith('//')) {
		throw new PathPolicyError('path must be repository-relative; absolute, drive, and UNC paths are forbidden');
	}
	const stripped = raw.replace(/^\.\//, '').replace(/\/+$/, '');
	const parts = stripped === '' || stripped === '.' ? [] : stripped.split('/');
	if (parts.some((part) => part === '..')) throw new PathPolicyError('parent path segments are forbidden');
	if (parts.some((part) => part === '')) throw new PathPolicyError('empty path segments are forbidden');
	if (parts.length === 0 && !options.allowRoot) throw new PathPolicyError('path must not name the repository root');
	return parts.filter((part) => part !== '.').join('/');
}

function assertContained(root: string, candidate: string): void {
	const rel = relative(root, candidate);
	if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
		throw new PathPolicyError('resolved path escapes marketplace root');
	}
}

export function resolveWithinRoot(
	root: string,
	relativePath: string,
	options: { allowRoot?: boolean } = {}
): string {
	const canonical = normalizeInternalPath(relativePath, options);
	const rootReal = realpathSync(resolve(root));
	const target = resolve(rootReal, ...canonical.split('/').filter(Boolean));
	assertContained(rootReal, target);

	let probe = existsSync(target) ? target : dirname(target);
	while (!existsSync(probe)) probe = dirname(probe);
	const probeReal = realpathSync(probe);
	assertContained(rootReal, probeReal);
	if (existsSync(target)) assertContained(rootReal, realpathSync(target));
	return target;
}
