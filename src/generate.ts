// The framework: join native Claude Code plugin data with presentation
// (entry.yaml / catalog.yaml), derive what native already encodes, validate, and
// return the consolidated manifest. Reads through a FileSource so it runs against
// the OS filesystem (CLI) or an in-memory map (Worker, tests).
//
// Native alone yields a valid (plainer) manifest; entry.yaml/catalog.yaml enrich.
// Referential integrity (entry <-> on-disk components, group <-> catalog, env <->
// .mcp.json) is enforced here — it cannot live in declarative schema.

import { join } from 'node:path';
import { Manifest } from './manifest.ts';
import { Entry, coverageTargets } from './entry.ts';
import { Catalog } from './catalog.ts';
import { type FileSource, NodeFileSource, normalize } from './fs-source.ts';
import { readJSON, loadYaml, deriveSkills, deriveCommands, deriveAgents, deriveMcp, deriveHooks } from './native.ts';
import { analyzeCoverage, resolve as resolveCoverage, type CoverageConfig } from './coverage.ts';
import { PluginJson } from './plugin-json.ts';

const DEFAULT_SCHEMA_VERSION = '1.0';
const PLUGINS = 'plugins';

export interface GenerateResult {
	manifest: unknown;
	errors: string[];
	warnings: string[];
}

export function generateManifest(input: FileSource | string, opts: { strictCoverage?: boolean } = {}): GenerateResult {
	const source: FileSource = typeof input === 'string' ? new NodeFileSource(input) : input;
	const errors: string[] = [];
	const warns: string[] = [];
	const err = (m: string) => errors.push(m);
	const warn = (m: string) => warns.push(m);

	const prune = <T extends object>(o: T): T => {
		for (const k of Object.keys(o) as (keyof T)[]) {
			const v = o[k];
			if (v === undefined || (Array.isArray(v) && v.length === 0)) delete o[k];
		}
		return o;
	};

	// A plugin's id is its marketplace entry name; its directory is the entry's
	// `source` (normalized — "./" and "." mean the repo root). Missing source
	// preserves the legacy implicit plugins/<id> convention.
	function resolvePlugin(entry: Record<string, unknown>): { id: string; dir: string } {
		const id = entry.name as string;
		const dir = typeof entry.source === 'string' ? normalize(entry.source) : join(PLUGINS, id);
		return { id, dir };
	}

	function buildPlugin(id: string, dir: string, marketEntry: Record<string, unknown>, groupIds: Set<string>, coverageCfg: CoverageConfig = {}) {
		const pj = readJSON(source, join(dir, '.claude-plugin', 'plugin.json'));
		const pjParse = PluginJson.safeParse(pj);
		if (!pjParse.success)
			for (const i of pjParse.error.issues) err(`${id}/plugin.json: ${i.path.join('.')} ${i.message}`);
		if (typeof pj.author === 'string')
			err(`${id}/plugin.json: author must be an object {name, url?, email?}, not a string — Claude Code rejects string authors at install`);
		if (pj.name !== id) err(`${id}: plugin.json name "${pj.name}" != marketplace entry name "${id}" — both must be the canonical install id`);

		const entry = (() => {
			const raw = loadYaml<unknown>(source, join(dir, 'entry.yaml'));
			if (raw == null) return null;
			const p = Entry.safeParse(raw);
			if (!p.success) {
				err(`${id}/entry.yaml: ${p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
				return null;
			}
			return p.data;
		})();

		if (entry?.group && groupIds.size && !groupIds.has(entry.group))
			err(`${id}: group "${entry.group}" not declared in catalog.yaml groups[]`);

		const nSkills = deriveSkills(source, dir, warn);
		const eSkills = new Map((entry?.skills ?? []).map((s) => [s.name, s]));
		for (const s of eSkills.keys()) if (!nSkills.find((n) => n.name === s)) err(`${id}: entry skill "${s}" not found on disk`);
		const skills = nSkills.map((n) => {
			const o = eSkills.get(n.name);
			return prune({
				name: n.name,
				description: o?.description ?? n.description,
				trigger: o?.trigger,
				examples: o?.examples,
				href: o?.href,
				label: o?.label,
				autoload: n.autoload,
				resources: n.resources
			});
		});

		const nCmds = deriveCommands(source, dir, warn);
		const eCmds = new Map((entry?.commands ?? []).map((c) => [c.name, c]));
		for (const c of eCmds.keys()) if (!nCmds.find((n) => n.name === c)) err(`${id}: entry command "${c}" not found on disk`);
		const commands = nCmds.map((n) => {
			const o = eCmds.get(n.name);
			return prune({ name: n.name, summary: n.summary, description: o?.description, arguments: n.arguments, examples: o?.examples });
		});

		const nAgents = deriveAgents(source, dir, warn);
		const eAgents = new Map((entry?.agents ?? []).map((a) => [a.name, a]));
		for (const a of eAgents.keys()) if (!nAgents.find((n) => n.name === a)) err(`${id}: entry agent "${a}" not found on disk`);
		const agents = nAgents.map((n) => {
			const o = eAgents.get(n.name);
			return prune({ name: n.name, summary: n.summary, description: o?.description, returns: o?.returns, not: o?.not, tools: n.tools, examples: o?.examples });
		});

		const nMcp = deriveMcp(source, dir);
		const eMcp = new Map((entry?.mcp ?? []).map((m) => [m.name, m]));
		for (const m of eMcp.keys()) if (!nMcp.find((n) => n.name === m)) err(`${id}: entry mcp "${m}" not in .mcp.json`);
		const mcp = nMcp.map((n) => {
			const o = eMcp.get(n.name);
			for (const e of o?.env ?? []) if (!n.envKeys.includes(e.key)) err(`${id}/${n.name}: env "${e.key}" not in .mcp.json`);
			return prune({
				name: n.name,
				type: n.type,
				install: o?.install,
				auth: o?.auth,
				repo: o?.repo,
				env: o?.env,
				setup: o?.setup,
				description: o?.description,
				provides: o?.provides,
				config: o?.config
			});
		});

		const nHooks = deriveHooks(source, dir);
		const eHooks = entry?.hooks ?? [];
		const hookMatches = (e: { event: string; matcher?: string }, h: { event: string; matcher?: string }) =>
			e.event === h.event && (e.matcher === undefined || e.matcher === h.matcher);
		for (const e of eHooks)
			if (!nHooks.find((h) => hookMatches(e, h)))
				err(`${id}: entry hook "${e.event}${e.matcher ? `/${e.matcher}` : ''}" not found in hooks.json`);
		const hooks = nHooks.map((h) => prune({ ...h, why: eHooks.find((e) => hookMatches(e, h))?.why }));

		const facts = { plugin: pj, skills: nSkills, commands: nCmds, agents: nAgents, mcp: nMcp, hooks: nHooks };
		const cov = analyzeCoverage(facts, entry, coverageCfg, id, join(dir, 'entry.yaml'));
		for (const f of cov.findings) (f.severity === 'error' ? err : warn)(f.message);

		const author = pj.author
			? prune({ name: pj.author.name, email: pj.author.email, url: pj.author.url })
			: undefined;

		return prune({
			id,
			name: pj.name ?? id,
			version: pj.version ?? '0.0.0',
			description: pj.description,
			author,
			license: pj.license,
			homepage: pj.homepage,
			repository: typeof pj.repository === 'string' ? pj.repository : pj.repository?.url,
			keywords: pj.keywords,
			dependencies: pj.dependencies,
			category: marketEntry.category as string | undefined,
			group: entry?.group,
			tagline: entry?.tagline,
			intro: entry?.intro,
			ccVersion: entry?.ccVersion,
			skills,
			commands,
			agents,
			mcp,
			hooks,
			configuration: entry?.configuration,
			tips: (entry?.tips ?? []).map((t) => (typeof t === 'string' ? { text: t } : t)),
			traps: (entry?.traps ?? []).map((t) => (typeof t === 'string' ? { text: t } : t))
		});
	}

	const market = (() => {
		try {
			return readJSON(source, join('.claude-plugin', 'marketplace.json'));
		} catch {
			err(`cannot read .claude-plugin/marketplace.json — is this a Claude Code marketplace repo?`);
			return null;
		}
	})();
	if (!market) return { manifest: {}, errors, warnings: warns };

	const catalog = (() => {
		const raw = loadYaml<unknown>(source, 'catalog.yaml');
		if (raw == null) return null;
		const p = Catalog.safeParse(raw);
		if (!p.success) {
			err(`catalog.yaml: ${p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
			return null;
		}
		return p.data;
	})();
	const groupIds = new Set((catalog?.groups ?? []).map((g) => g.id));
	let coverageCfg: CoverageConfig = (catalog?.coverage ?? {}) as CoverageConfig;
	if (opts.strictCoverage) {
		const strict: CoverageConfig = {};
		for (const t of coverageTargets()) {
			const id = `${t.component}.${t.field}`;
			const eff = resolveCoverage(id, t.defaultSeverity, coverageCfg);
			strict[id] = eff === 'warn' ? 'error' : eff;
		}
		coverageCfg = strict;
	}

	const plugins = ((market.plugins as Record<string, unknown>[]) ?? [])
		.map((e) => {
			const { id, dir } = resolvePlugin(e);
			if (!id || !source.exists(join(dir, '.claude-plugin', 'plugin.json'))) return null;
			try {
				return buildPlugin(id, dir, e, groupIds, coverageCfg);
			} catch (ex) {
				err(`${id}: failed to process — ${ex instanceof Error ? ex.message : String(ex)}`);
				return null;
			}
		})
		.filter(Boolean);

	const manifest: Record<string, unknown> = {
		schemaVersion: catalog?.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
		marketplace: prune({ name: market.name, description: market.description, lang: catalog?.lang, owner: market.owner }),
		groups: catalog?.groups,
		plugins
	};
	if (!manifest.groups) delete manifest.groups;

	const result = Manifest.safeParse(manifest);
	if (!result.success) for (const i of result.error.issues) err(`manifest: ${i.path.join('.')} ${i.message}`);

	return { manifest, errors, warnings: warns };
}
