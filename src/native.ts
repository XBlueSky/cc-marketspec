// Native-fact extraction: read a plugin's Claude Code native files through a
// FileSource and derive the structured facts the generator joins against and the
// authoring MCP feeds to an LLM. All paths are relative to the FileSource root.

import { posix, basename } from 'node:path';
import yaml from 'js-yaml';
import type { FileSource } from './fs-source.ts';

type Warn = (m: string) => void;

const compareName = <T extends { name: string }>(a: T, b: T) =>
	a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function readJSON(source: FileSource, p: string): any {
	const s = source.read(p);
	if (s === null) throw new Error(`file not found: ${p}`);
	return JSON.parse(s);
}

export function loadYaml<T>(source: FileSource, p: string): T | null {
	const s = source.read(p);
	return s === null ? null : ((yaml.load(s) as T) ?? null);
}

function countFiles(source: FileSource, p: string): number {
	return source.isDir(p) ? source.list(p).filter((f) => !f.startsWith('.')).length : 0;
}

export function frontmatter(source: FileSource, p: string, warn?: Warn): Record<string, unknown> {
	const s = source.read(p);
	if (s === null) return {};
	const m = s.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return {};
	try {
		return (yaml.load(m[1]) as Record<string, unknown>) ?? {};
	} catch {
		warn?.(`frontmatter parse failed: ${p}`);
		return {};
	}
}

export function firstSentence(s: string): string {
	const t = s.trim().replace(/\s+/g, ' ');
	const m = t.match(/^.*?(?:[。!?]|\.\s|$)/);
	return (m ? m[0] : t).trim();
}

export interface NativeSkill {
	name: string;
	description?: string;
	autoload: boolean;
	resources?: { scripts?: number; references?: number; assets?: number };
}

export function deriveSkills(source: FileSource, dir: string, warn?: Warn): NativeSkill[] {
	const r = posix.join(dir, 'skills');
	if (!source.isDir(r)) return [];
	return source
		.list(r)
		.filter((d) => source.exists(posix.join(r, d, 'SKILL.md')))
		.map((d) => {
			const fm = frontmatter(source, posix.join(r, d, 'SKILL.md'), warn);
			const res = {
				scripts: countFiles(source, posix.join(r, d, 'scripts')),
				references: countFiles(source, posix.join(r, d, 'references')),
				assets: countFiles(source, posix.join(r, d, 'assets'))
			};
			return {
				name: (fm.name as string) ?? d,
				description: (fm.description as string) ?? undefined,
				autoload: fm['user-invocable'] === false,
				resources: res.scripts || res.references || res.assets ? res : undefined
			};
		})
		.sort(compareName);
}

export interface NativeCommand {
	name: string;
	summary?: string;
	arguments?: { name: string; description?: string; required?: boolean }[];
}

export function deriveCommands(source: FileSource, dir: string, warn?: Warn): NativeCommand[] {
	const r = posix.join(dir, 'commands');
	if (!source.isDir(r)) return [];
	return source
		.list(r)
		.filter((f) => f.endsWith('.md'))
		.map((f) => {
			const fm = frontmatter(source, posix.join(r, f), warn);
			const desc = (fm.description as string) ?? '';
			const args = Array.isArray(fm.arguments)
				? (fm.arguments as Record<string, unknown>[]).map((a) => ({
						name: a.name as string,
						description: a.description as string | undefined,
						required: a.required as boolean | undefined
					}))
				: undefined;
			return { name: (fm.name as string) ?? basename(f, '.md'), summary: desc ? firstSentence(desc) : undefined, arguments: args };
		})
		.sort(compareName);
}

export interface NativeAgent {
	name: string;
	summary?: string;
	tools?: string[];
}

export function deriveAgents(source: FileSource, dir: string, warn?: Warn): NativeAgent[] {
	const r = posix.join(dir, 'agents');
	if (!source.isDir(r)) return [];
	return source
		.list(r)
		.filter((f) => f.endsWith('.md'))
		.map((f) => {
			const fm = frontmatter(source, posix.join(r, f), warn);
			const desc = (fm.description as string) ?? '';
			return {
				name: (fm.name as string) ?? basename(f, '.md'),
				summary: desc ? firstSentence(desc) : undefined,
				tools: Array.isArray(fm.tools) ? (fm.tools as string[]) : undefined
			};
		})
		.sort(compareName);
}

export interface NativeMcp {
	name: string;
	type: string;
	envKeys: string[];
}

export function deriveMcp(source: FileSource, dir: string): NativeMcp[] {
	const f = posix.join(dir, '.mcp.json');
	if (!source.exists(f)) return [];
	const servers = (readJSON(source, f).mcpServers ?? {}) as Record<
		string,
		{ type?: string; command?: string; url?: string; env?: Record<string, string> }
	>;
	return Object.entries(servers)
		.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
		.map(([name, server]) => ({
			name,
			type: server.type ?? (server.url ? 'http' : 'stdio'),
			envKeys: Object.entries(server.env ?? {})
				.filter(([, value]) => typeof value === 'string' && value.includes('${'))
				.map(([key]) => key)
				.sort()
		}));
}

export interface NativeHook {
	event: string;
	matcher?: string;
}

export function deriveHooks(source: FileSource, dir: string): NativeHook[] {
	const f = posix.join(dir, 'hooks', 'hooks.json');
	if (!source.exists(f)) return [];
	const hooks = (readJSON(source, f).hooks ?? {}) as Record<string, { matcher?: string }[]>;
	const out: NativeHook[] = [];
	for (const [event, entries] of Object.entries(hooks)) for (const e of entries) out.push({ event, matcher: e.matcher });
	return out.sort((left, right) => {
		const a = `${left.event}\0${left.matcher ?? ''}`;
		const b = `${right.event}\0${right.matcher ?? ''}`;
		return a < b ? -1 : a > b ? 1 : 0;
	});
}

export interface NativeFacts {
	plugin: Record<string, unknown>;
	skills: NativeSkill[];
	commands: NativeCommand[];
	agents: NativeAgent[];
	mcp: NativeMcp[];
	hooks: NativeHook[];
}

export function extractNativeFacts(source: FileSource, pluginDir: string, warn?: Warn): NativeFacts {
	const plugin = (() => {
		try {
			return readJSON(source, posix.join(pluginDir, '.claude-plugin', 'plugin.json')) as Record<string, unknown>;
		} catch {
			return {};
		}
	})();
	return {
		plugin,
		skills: deriveSkills(source, pluginDir, warn),
		commands: deriveCommands(source, pluginDir, warn),
		agents: deriveAgents(source, pluginDir, warn),
		mcp: deriveMcp(source, pluginDir),
		hooks: deriveHooks(source, pluginDir)
	};
}
