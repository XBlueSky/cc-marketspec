// A minimal filesystem abstraction so the generator runs against either the real
// OS filesystem (CLI / local) or an in-memory file map (Cloudflare Worker, tests).
// All paths are RELATIVE to the source's root.

import { readFileSync, existsSync, lstatSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeInternalPath, resolveWithinRoot } from './path-policy.ts';

export interface FileSource {
	read(path: string): string | null; // file contents, or null if absent / not a file
	exists(path: string): boolean; // a file or directory exists at path
	isDir(path: string): boolean; // path exists and is a directory
	list(path: string): string[]; // child entry names if path is a dir, else []
	isSymbolicLink?(path: string): boolean; // optional source capability; missing paths are false
}

export function normalize(p: string): string {
	return normalizeInternalPath(p, { allowRoot: true });
}

function parentOf(p: string): string {
	const i = p.lastIndexOf('/');
	return i === -1 ? '' : p.slice(0, i);
}

export class NodeFileSource implements FileSource {
	private readonly root: string;
	constructor(root: string) {
		this.root = resolve(root);
	}
	private abs(p: string): string | null {
		const canonical = normalizeInternalPath(p, { allowRoot: true });
		if (!existsSync(this.root)) return null;
		return resolveWithinRoot(this.root, canonical, { allowRoot: true });
	}
	read(p: string): string | null {
		const a = this.abs(p);
		if (a === null || !existsSync(a) || !statSync(a).isFile()) return null;
		return readFileSync(a, 'utf8');
	}
	exists(p: string): boolean {
		const a = this.abs(p);
		return a !== null && existsSync(a);
	}
	isDir(p: string): boolean {
		const a = this.abs(p);
		return a !== null && existsSync(a) && statSync(a).isDirectory();
	}
	isSymbolicLink(p: string): boolean {
		const a = this.abs(p);
		if (a === null) return false;
		try {
			return lstatSync(a).isSymbolicLink();
		} catch {
			return false;
		}
	}
	list(p: string): string[] {
		const a = this.abs(p);
		return a !== null && existsSync(a) && statSync(a).isDirectory() ? readdirSync(a).sort() : [];
	}
}

export class MemoryFileSource implements FileSource {
	private readonly files = new Map<string, string>();
	private readonly dirs = new Set<string>(['']);
	constructor(files: Record<string, string>) {
		for (const [raw, content] of Object.entries(files)) {
			const path = normalizeInternalPath(raw, { allowRoot: true });
			this.files.set(path, content);
			for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) this.dirs.add(dir);
		}
	}
	read(p: string): string | null {
		return this.files.get(normalize(p)) ?? null;
	}
	exists(p: string): boolean {
		const n = normalize(p);
		return this.files.has(n) || this.dirs.has(n);
	}
	isDir(p: string): boolean {
		return this.dirs.has(normalize(p));
	}
	isSymbolicLink(_p: string): boolean {
		return false;
	}
	list(p: string): string[] {
		const base = normalizeInternalPath(p, { allowRoot: true });
		const prefix = base === '' ? '' : base + '/';
		const names = new Set<string>();
		for (const candidate of [...this.files.keys(), ...this.dirs]) {
			if (candidate === base || !candidate.startsWith(prefix)) continue;
			const name = candidate.slice(prefix.length).split('/')[0];
			if (name) names.add(name);
		}
		return [...names].sort();
	}
}

export class OverlayFileSource implements FileSource {
	private readonly base: FileSource;
	private readonly overlay: MemoryFileSource;
	constructor(base: FileSource, files: Record<string, string>) {
		this.base = base;
		this.overlay = new MemoryFileSource(files);
	}
	read(path: string): string | null {
		return this.overlay.exists(path) ? this.overlay.read(path) : this.base.read(path);
	}
	exists(path: string): boolean {
		return this.overlay.exists(path) || this.base.exists(path);
	}
	isDir(path: string): boolean {
		return this.overlay.exists(path) ? this.overlay.isDir(path) : this.base.isDir(path);
	}
	isSymbolicLink(path: string): boolean {
		return this.overlay.exists(path) ? false : (this.base.isSymbolicLink?.(path) ?? false);
	}
	list(path: string): string[] {
		if (this.overlay.exists(path) && !this.overlay.isDir(path)) return [];
		const baseNames = this.base.isDir(path) ? this.base.list(path) : [];
		const overlayNames = this.overlay.isDir(path) ? this.overlay.list(path) : [];
		return [...new Set([...baseNames, ...overlayNames])].sort();
	}
}
