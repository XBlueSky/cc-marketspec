// A minimal filesystem abstraction so the generator runs against either the real
// OS filesystem (CLI / local) or an in-memory file map (Cloudflare Worker, tests).
// All paths are RELATIVE to the source's root.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface FileSource {
	read(path: string): string | null; // file contents, or null if absent / not a file
	exists(path: string): boolean; // a file or directory exists at path
	isDir(path: string): boolean; // path exists and is a directory
	list(path: string): string[]; // child entry names if path is a dir, else []
}

function normalize(p: string): string {
	return p.replace(/^\.?\/+|^\.$/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
}

function parentOf(p: string): string {
	const i = p.lastIndexOf('/');
	return i === -1 ? '' : p.slice(0, i);
}

export class NodeFileSource implements FileSource {
	private readonly root: string;
	constructor(root: string) {
		this.root = root;
	}
	private abs(p: string): string {
		return join(this.root, normalize(p));
	}
	read(p: string): string | null {
		const a = this.abs(p);
		if (!existsSync(a) || !statSync(a).isFile()) return null;
		return readFileSync(a, 'utf8');
	}
	exists(p: string): boolean {
		return existsSync(this.abs(p));
	}
	isDir(p: string): boolean {
		const a = this.abs(p);
		return existsSync(a) && statSync(a).isDirectory();
	}
	list(p: string): string[] {
		return this.isDir(p) ? readdirSync(this.abs(p)) : [];
	}
}

export class MemoryFileSource implements FileSource {
	private readonly files = new Map<string, string>();
	private readonly dirs = new Set<string>(['']);
	constructor(files: Record<string, string>) {
		for (const [raw, content] of Object.entries(files)) {
			const path = normalize(raw);
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
	list(p: string): string[] {
		const base = normalize(p);
		const prefix = base === '' ? '' : base + '/';
		const names = new Set<string>();
		for (const f of [...this.files.keys(), ...this.dirs]) {
			if (f === base || !f.startsWith(prefix)) continue;
			const name = f.slice(prefix.length).split('/')[0];
			if (name) names.add(name);
		}
		return [...names];
	}
}
