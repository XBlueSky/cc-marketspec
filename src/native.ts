// Native-fact extraction: read a plugin's Claude Code native files through a
// FileSource and derive the structured facts the generator joins against and the
// authoring MCP feeds to an LLM. All paths are relative to the FileSource root.

import { posix, basename } from 'node:path';
import yaml from 'js-yaml';
import type { FileSource } from './fs-source.ts';
import { normalizeInternalPath } from './path-policy.ts';
import { ENTRY_HOOKS } from './effective-manifest.ts';

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


type Manifest = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The string entries of a plugin.json path field (string | string[]); objects are skipped. */
function pathList(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Resolve a plugin.json component path (`./x`, or `.` for the root) inside the plugin dir. */
function pluginPath(dir: string, raw: string, warn?: Warn): string | null {
	try {
		return posix.join(dir, normalizeInternalPath(raw, { allowRoot: true })) || '.';
	} catch (error) {
		warn?.(`${dir}: plugin.json path "${raw}" ignored — ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

/** Files with extension `ext` for a component that a plugin.json field replaces:
 *  the default folder when the field is unset, else the field's paths (a directory
 *  yields its direct children). Only an explicit path that is missing warns. */
function filesFrom(source: FileSource, dir: string, field: unknown, fallback: string, ext: string, warn?: Warn): string[] {
	const out: string[] = [];
	const explicit = field !== undefined;
	for (const raw of explicit ? pathList(field) : [`./${fallback}`]) {
		const p = pluginPath(dir, raw, warn);
		if (p === null) continue;
		if (source.isDir(p)) {
			for (const f of source.list(p)) if (f.endsWith(ext) && !f.startsWith('.')) out.push(posix.join(p, f));
		} else if (source.exists(p)) out.push(p);
		else if (explicit) warn?.(`${dir}: plugin.json path "${raw}" not found`);
	}
	return out;
}

function dedupe<T extends { name: string }>(items: T[]): T[] {
	const seen = new Map<string, T>();
	for (const item of items) if (!seen.has(item.name)) seen.set(item.name, item);
	return [...seen.values()].sort(compareName);
}

export interface NativeSkill {
	name: string;
	description?: string;
	autoload: boolean;
	resources?: { scripts?: number; references?: number; assets?: number };
}

function readSkill(source: FileSource, skillDir: string, fallbackName: string, warn?: Warn): NativeSkill {
	const fm = frontmatter(source, posix.join(skillDir, 'SKILL.md'), warn);
	const res = {
		scripts: countFiles(source, posix.join(skillDir, 'scripts')),
		references: countFiles(source, posix.join(skillDir, 'references')),
		assets: countFiles(source, posix.join(skillDir, 'assets'))
	};
	return {
		name: (fm.name as string) ?? fallbackName,
		description: (fm.description as string) ?? undefined,
		autoload: fm['user-invocable'] === false,
		resources: res.scripts || res.references || res.assets ? res : undefined
	};
}

/** skills/ plus every plugin.json `skills` path (the field adds to the default). A
 *  path that itself holds SKILL.md is one skill; otherwise each child folder is. */
export function deriveSkills(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeSkill[] {
	const out: NativeSkill[] = [];
	for (const raw of ['./skills', ...pathList(manifest.skills)]) {
		const root = pluginPath(dir, raw, warn);
		if (root === null || !source.isDir(root)) continue;
		if (source.exists(posix.join(root, 'SKILL.md'))) {
			out.push(readSkill(source, root, basename(root === '.' ? dir : root), warn));
			continue;
		}
		for (const d of source.list(root)) {
			if (source.exists(posix.join(root, d, 'SKILL.md'))) out.push(readSkill(source, posix.join(root, d), d, warn));
		}
	}
	return dedupe(out);
}

export interface NativeCommand {
	name: string;
	summary?: string;
	arguments?: { name: string; description?: string; required?: boolean }[];
}

function readCommand(source: FileSource, file: string, warn?: Warn, name?: string): NativeCommand {
	const fm = frontmatter(source, file, warn);
	const desc = (fm.description as string) ?? '';
	const args = Array.isArray(fm.arguments)
		? (fm.arguments as Record<string, unknown>[]).map((a) => ({
				name: a.name as string,
				description: a.description as string | undefined,
				required: a.required as boolean | undefined
			}))
		: undefined;
	return { name: name ?? (fm.name as string) ?? basename(file, '.md'), summary: desc ? firstSentence(desc) : undefined, arguments: args };
}

/** commands/ unless plugin.json `commands` replaces it: a path, a path list, or a
 *  `{name: {source | content, description?}}` map. */
export function deriveCommands(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeCommand[] {
	const spec = manifest.commands;
	if (isObject(spec)) {
		return dedupe(
			Object.entries(spec).map(([name, value]) => {
				const v = isObject(value) ? value : {};
				const file = typeof v.source === 'string' ? pluginPath(dir, v.source, warn) : null;
				const fromFile = file && source.exists(file) ? readCommand(source, file, warn, name) : { name };
				const desc = typeof v.description === 'string' ? v.description : undefined;
				return desc ? { ...fromFile, summary: firstSentence(desc) } : fromFile;
			})
		);
	}
	return dedupe(filesFrom(source, dir, spec, 'commands', '.md', warn).map((f) => readCommand(source, f, warn)));
}

export interface NativeAgent {
	name: string;
	summary?: string;
	tools?: string[];
}

/** agents/ unless plugin.json `agents` (file paths) replaces it. */
export function deriveAgents(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeAgent[] {
	return dedupe(
		filesFrom(source, dir, manifest.agents, 'agents', '.md', warn).map((f) => {
			const fm = frontmatter(source, f, warn);
			const desc = (fm.description as string) ?? '';
			return {
				name: (fm.name as string) ?? basename(f, '.md'),
				summary: desc ? firstSentence(desc) : undefined,
				tools: Array.isArray(fm.tools) ? (fm.tools as string[]) : undefined
			};
		})
	);
}

/** Server maps from a default file plus a merging plugin.json field (file path,
 *  inline map, or a list of both). A later server of the same name replaces an
 *  earlier one. `wrapper` is the key a config file nests its map under. */
function mergedServers(
	source: FileSource,
	dir: string,
	defaultFile: string,
	field: unknown,
	wrapper: string,
	warn?: Warn
): Map<string, Record<string, unknown>> {
	const out = new Map<string, Record<string, unknown>>();
	const addMap = (map: unknown) => {
		if (isObject(map)) for (const [name, server] of Object.entries(map)) out.set(name, isObject(server) ? server : {});
	};
	const addFile = (file: string) => {
		const data = readJSON(source, file);
		addMap(isObject(data) && wrapper in data ? data[wrapper] : data);
	};
	const defaultPath = posix.join(dir, defaultFile);
	if (source.exists(defaultPath)) addFile(defaultPath);
	for (const item of Array.isArray(field) ? field : field === undefined ? [] : [field]) {
		if (typeof item === 'string') {
			if (!item.endsWith('.json')) continue; // bundles (.mcpb/.dxt) and remote URLs are opaque
			const file = pluginPath(dir, item, warn);
			if (file === null) continue;
			if (source.exists(file)) addFile(file);
			else warn?.(`${dir}: plugin.json path "${item}" not found`);
		} else addMap(item);
	}
	return out;
}

export interface NativeMcp {
	name: string;
	type: string;
	envKeys: string[];
}

export function deriveMcp(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeMcp[] {
	const servers = mergedServers(source, dir, '.mcp.json', manifest.mcpServers, 'mcpServers', warn);
	return [...servers.entries()]
		.sort(([left], [right]) => compareStr(left, right))
		.map(([name, server]) => ({
			name,
			type: (server.type as string | undefined) ?? (server.url ? 'http' : 'stdio'),
			envKeys: Object.entries((server.env ?? {}) as Record<string, unknown>)
				.filter(([, value]) => typeof value === 'string' && value.includes('${'))
				.map(([key]) => key)
				.sort()
		}));
}

export interface NativeHook {
	event: string;
	matcher?: string;
}

export interface NativeMod {
	/** The hooks module, relative to the plugin root (e.g. `hooks/register.tsx`). */
	module: string;
}

/** hooks/hooks.json plus every plugin.json `hooks` source (file path, inline event
 *  map, or a list of both). Yields each source's event map and, for files, the
 *  function-hook `modules` it names, resolved against the file's folder. */
function hookSources(source: FileSource, dir: string, manifest: Manifest, warn?: Warn) {
	const events: Record<string, unknown>[] = [];
	const modules: string[] = [];
	const addFile = (file: string) => {
		const data = readJSON(source, file);
		if (!isObject(data)) return;
		if (isObject(data.hooks)) events.push(data.hooks);
		for (const m of pathList(data.modules)) {
			try {
				const rel = normalizeInternalPath(posix.join(posix.dirname(file), m), { allowRoot: false });
				modules.push(dir && dir !== '.' && rel.startsWith(`${dir}/`) ? rel.slice(dir.length + 1) : rel);
			} catch (error) {
				warn?.(`${file}: module "${m}" ignored — ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	const defaultPath = posix.join(dir, 'hooks', 'hooks.json');
	if (source.exists(defaultPath)) addFile(defaultPath);
	const field = manifest.hooks;
	for (const item of Array.isArray(field) ? field : field === undefined ? [] : [field]) {
		if (typeof item === 'string') {
			const file = pluginPath(dir, item, warn);
			if (file === null || file === defaultPath) continue;
			if (source.exists(file)) addFile(file);
			else warn?.(`${dir}: plugin.json path "${item}" not found`);
		} else if (isObject(item)) events.push(isObject(item.hooks) ? item.hooks : item);
	}
	return { events, modules };
}

export function deriveHooks(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeHook[] {
	const out: NativeHook[] = [];
	const events = hookSources(source, dir, manifest, warn).events;
	// A marketplace entry's inline hooks replace the plugin's matchers per event.
	const replacing = isObject(manifest[ENTRY_HOOKS]) ? manifest[ENTRY_HOOKS] : null;
	const maps = replacing
		? [...events.map((map) => Object.fromEntries(Object.entries(map).filter(([event]) => !(event in replacing)))), replacing]
		: events;
	for (const map of maps) {
		for (const [event, entries] of Object.entries(map)) {
			if (!Array.isArray(entries)) continue;
			for (const e of entries) out.push({ event, matcher: isObject(e) && typeof e.matcher === 'string' ? e.matcher : undefined });
		}
	}
	return out.sort((left, right) =>
		compareStr(`${left.event}\0${left.matcher ?? ''}`, `${right.event}\0${right.matcher ?? ''}`)
	);
}

/** Function-hook modules ("mods") named under `modules` in the plugin's hooks files. */
export function deriveMods(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeMod[] {
	return [...new Set(hookSources(source, dir, manifest, warn).modules)].sort(compareStr).map((module) => ({ module }));
}

export interface NativeLsp {
	name: string;
	languages: string[];
}

export function deriveLsp(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeLsp[] {
	const servers = mergedServers(source, dir, '.lsp.json', manifest.lspServers, 'lspServers', warn);
	return [...servers.entries()]
		.sort(([left], [right]) => compareStr(left, right))
		.map(([name, server]) => ({
			name,
			languages: [...new Set(Object.values(isObject(server.extensionToLanguage) ? server.extensionToLanguage : {})
				.filter((v): v is string => typeof v === 'string'))].sort(compareStr)
		}));
}

export interface NativeNamed {
	name: string;
	description?: string;
}

export function deriveOutputStyles(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeNamed[] {
	return dedupe(
		filesFrom(source, dir, manifest.outputStyles, 'output-styles', '.md', warn).map((f) => {
			const fm = frontmatter(source, f, warn);
			return {
				name: (fm.name as string) ?? basename(f, '.md'),
				description: typeof fm.description === 'string' ? fm.description : undefined
			};
		})
	);
}

export function deriveWorkflows(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeNamed[] {
	return dedupe(
		filesFrom(source, dir, manifest.workflows, 'workflows', '.js', warn).map((f) => ({ name: basename(f, '.js') }))
	);
}

export interface NativeTheme {
	name: string;
	base?: string;
}

const experimental = (manifest: Manifest, key: string): unknown =>
	isObject(manifest.experimental) ? manifest.experimental[key] : undefined;

export function deriveThemes(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeTheme[] {
	return dedupe(
		filesFrom(source, dir, experimental(manifest, 'themes'), 'themes', '.json', warn).map((f) => {
			const data = readJSON(source, f);
			return {
				name: isObject(data) && typeof data.name === 'string' ? data.name : basename(f, '.json'),
				base: isObject(data) && typeof data.base === 'string' ? data.base : undefined
			};
		})
	);
}

export interface NativeMonitor {
	name: string;
	description?: string;
	when?: string;
}

export function deriveMonitors(source: FileSource, dir: string, warn?: Warn, manifest: Manifest = {}): NativeMonitor[] {
	const field = experimental(manifest, 'monitors');
	const entries: unknown[] = [];
	if (Array.isArray(field)) entries.push(...field);
	else {
		const file = typeof field === 'string' ? pluginPath(dir, field, warn) : posix.join(dir, 'monitors', 'monitors.json');
		if (file !== null && source.exists(file)) {
			const data = readJSON(source, file);
			entries.push(...(Array.isArray(data) ? data : isObject(data) && Array.isArray(data.monitors) ? data.monitors : []));
		}
	}
	return dedupe(
		entries.filter(isObject).filter((m) => typeof m.name === 'string').map((m) => ({
			name: m.name as string,
			description: typeof m.description === 'string' ? m.description : undefined,
			when: typeof m.when === 'string' ? m.when : undefined
		}))
	);
}

/** Executables in bin/, put on PATH while the plugin is enabled. */
export function deriveBin(source: FileSource, dir: string): string[] {
	const r = posix.join(dir, 'bin');
	if (!source.isDir(r)) return [];
	return source.list(r).filter((f) => !f.startsWith('.') && !source.isDir(posix.join(r, f))).sort(compareStr);
}

export interface NativeChannel {
	server: string;
	displayName?: string;
}

export function deriveChannels(manifest: Manifest = {}): NativeChannel[] {
	if (!Array.isArray(manifest.channels)) return [];
	return manifest.channels
		.filter(isObject)
		.filter((c) => typeof c.server === 'string')
		.map((c) => ({ server: c.server as string, displayName: typeof c.displayName === 'string' ? c.displayName : undefined }))
		.sort((a, b) => compareStr(a.server, b.server));
}

export interface NativeConfig {
	key: string;
	type: string;
	title?: string;
	description?: string;
	required?: boolean;
	default?: unknown;
	options?: string[];
	multiple?: boolean;
	sensitive?: boolean;
	min?: number;
	max?: number;
}

/** plugin.json `userConfig`, in declaration order. A sensitive field's default is
 *  never surfaced. */
export function deriveUserConfig(manifest: Manifest = {}): NativeConfig[] {
	if (!isObject(manifest.userConfig)) return [];
	return Object.entries(manifest.userConfig).map(([key, raw]) => {
		const f = isObject(raw) ? raw : {};
		const pick = <T>(k: string, ok: (v: unknown) => boolean) => (ok(f[k]) ? (f[k] as T) : undefined);
		const str = (v: unknown) => typeof v === 'string';
		const bool = (v: unknown) => typeof v === 'boolean';
		const num = (v: unknown) => typeof v === 'number';
		const sensitive = pick<boolean>('sensitive', bool);
		return {
			key,
			type: pick<string>('type', str) ?? 'string',
			title: pick<string>('title', str),
			description: pick<string>('description', str),
			required: pick<boolean>('required', bool),
			default: sensitive ? undefined : f.default,
			options: pick<string[]>('options', (v) => Array.isArray(v) && v.every(str)),
			multiple: pick<boolean>('multiple', bool),
			sensitive,
			min: pick<number>('min', num),
			max: pick<number>('max', num)
		};
	});
}

export interface NativeFacts {
	plugin: Record<string, unknown>;
	skills: NativeSkill[];
	commands: NativeCommand[];
	agents: NativeAgent[];
	mcp: NativeMcp[];
	hooks: NativeHook[];
	mods: NativeMod[];
	lsp: NativeLsp[];
	outputStyles: NativeNamed[];
	workflows: NativeNamed[];
	themes: NativeTheme[];
	monitors: NativeMonitor[];
	bin: string[];
	channels: NativeChannel[];
	userConfig: NativeConfig[];
}

export function readPluginManifest(source: FileSource, pluginDir: string): Record<string, unknown> {
	try {
		const pj = readJSON(source, posix.join(pluginDir, '.claude-plugin', 'plugin.json'));
		return isObject(pj) ? pj : {};
	} catch {
		return {};
	}
}

/** Every native fact of a plugin. `plugin` defaults to its own plugin.json. */
export function extractNativeFacts(
	source: FileSource,
	pluginDir: string,
	warn?: Warn,
	plugin: Record<string, unknown> = readPluginManifest(source, pluginDir)
): NativeFacts {
	return {
		plugin,
		skills: deriveSkills(source, pluginDir, warn, plugin),
		commands: deriveCommands(source, pluginDir, warn, plugin),
		agents: deriveAgents(source, pluginDir, warn, plugin),
		mcp: deriveMcp(source, pluginDir, warn, plugin),
		hooks: deriveHooks(source, pluginDir, warn, plugin),
		mods: deriveMods(source, pluginDir, warn, plugin),
		lsp: deriveLsp(source, pluginDir, warn, plugin),
		outputStyles: deriveOutputStyles(source, pluginDir, warn, plugin),
		workflows: deriveWorkflows(source, pluginDir, warn, plugin),
		themes: deriveThemes(source, pluginDir, warn, plugin),
		monitors: deriveMonitors(source, pluginDir, warn, plugin),
		bin: deriveBin(source, pluginDir),
		channels: deriveChannels(plugin),
		userConfig: deriveUserConfig(plugin)
	};
}
