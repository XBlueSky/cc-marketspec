// The framework: join native Claude Code plugin data with presentation
// (.cc-marketspec/entries/plugin-<id>.yaml and .cc-marketspec/catalog.yaml),
// derive what native already encodes, validate, and
// return the consolidated manifest. Reads through a FileSource so it runs against
// the OS filesystem (CLI) or an in-memory map (Worker, tests).
//
// Native alone yields a valid (plainer) manifest; namespaced authored YAML enriches it.
// Referential integrity (entry <-> on-disk components, group <-> catalog, env <->
// .mcp.json) is enforced here — it cannot live in declarative schema.

import { posix } from 'node:path';
import { Manifest } from './manifest.ts';
import { Entry, coverageTargets } from './entry.ts';
import { Catalog } from './catalog.ts';
import { type FileSource, NodeFileSource } from './fs-source.ts';
import { readJSON, loadYaml, extractNativeFacts } from './native.ts';
import { analyzeCoverage, resolve as resolveCoverage, type CoverageConfig } from './coverage.ts';
import { PluginJson, type PluginDependency } from './plugin-json.ts';
import { effectiveManifest } from './effective-manifest.ts';
import {
	CATALOG_PATH,
	entryPathForLayout,
	inspectLayout,
	pluginRootOf,
	resolveMarketplacePlugins,
	type LayoutKind,
	type ResolvedPlugin
} from './layout.ts';
import { checkFormatVersion, CURRENT_FORMAT_VERSION } from './version.ts';

export interface GenerateResult {
	manifest: unknown;
	errors: string[];
	warnings: string[];
	layout: LayoutKind;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function generateManifest(input: FileSource | string, opts: { strictCoverage?: boolean } = {}): GenerateResult {
	const source: FileSource = typeof input === 'string' ? new NodeFileSource(input) : input;
	const errors: string[] = [];
	const warns: string[] = [];
	const err = (message: string) => errors.push(message);
	const warn = (message: string) => warns.push(message);
	const finish = (manifest: unknown, layout: LayoutKind): GenerateResult => ({
		manifest,
		errors: [...new Set(errors)].sort(compare),
		warnings: [...new Set(warns)].sort(compare),
		layout
	});

	const prune = <T extends object>(object: T): T => {
		for (const key of Object.keys(object) as (keyof T)[]) {
			const value = object[key];
			if (value === undefined || (Array.isArray(value) && value.length === 0)) delete object[key];
		}
		return object;
	};

	const rawMarket: unknown = (() => {
		try {
			return readJSON(source, posix.join('.claude-plugin', 'marketplace.json'));
		} catch {
			err('cannot read .claude-plugin/marketplace.json — is this a Claude Code marketplace repo?');
			return undefined;
		}
	})();
	if (rawMarket === undefined) return finish({}, 'fresh');
	if (rawMarket === null || typeof rawMarket !== 'object' || Array.isArray(rawMarket)) {
		err('.claude-plugin/marketplace.json: expected a JSON object');
		return finish({}, 'fresh');
	}
	const market = rawMarket as Record<string, unknown>;

	if (Array.isArray(market.plugins)) {
		for (const value of market.plugins) {
			const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};
			if (typeof entry.name !== 'string') {
				const sourceLabel = typeof entry.source === 'string' ? ` (source: "${entry.source}")` : '';
				err(`marketplace entry missing "name"${sourceLabel}`);
			}
		}
	}

	const resolution = resolveMarketplacePlugins(market.plugins, { pluginRoot: pluginRootOf(market) });
	errors.push(...resolution.errors);
	warns.push(...resolution.warnings);
	const inspected = inspectLayout(source, resolution.plugins);
	errors.push(...inspected.errors);
	warns.push(...inspected.warnings);
	const layout = inspected.kind;

	const catalog = (() => {
		if (layout === 'fresh') return null;
		if (layout === 'ambiguous' || inspected.catalogPath === null) return null;
		const catalogPath = inspected.catalogPath;
		const raw = (() => {
			try {
				return loadYaml<unknown>(source, catalogPath);
			} catch (error) {
				err(`${catalogPath}: cannot parse YAML — ${error instanceof Error ? error.message : String(error)}`);
				return undefined;
			}
		})();
		if (raw === undefined) return null;
		if (raw == null) {
			err(`${catalogPath}: catalog is required when authored entries exist`);
			return null;
		}
		const parsed = Catalog.safeParse(raw);
		if (!parsed.success) {
			err(`${catalogPath}: ${parsed.error.issues.map((issue) =>
				`${issue.path.join('.')} ${issue.message}`).join('; ')}`);
			return null;
		}
		const compatible = checkFormatVersion(parsed.data.schemaVersion, layout);
		if (!compatible.ok) {
			err(`${catalogPath}: schemaVersion ${parsed.data.schemaVersion}: ${compatible.error}`);
			return null;
		}
		if (compatible.warning) warn(compatible.warning);
		return parsed.data;
	})();
	const authoredOverlaysEnabled =
		(layout === 'namespaced' || layout === 'legacy') && catalog !== null;
	const groupIds = new Set((catalog?.groups ?? []).map((group) => group.id));
	let coverageCfg: CoverageConfig = (catalog?.coverage ?? {}) as CoverageConfig;
	if (opts.strictCoverage) {
		const strict: CoverageConfig = {};
		for (const target of coverageTargets()) {
			const id = `${target.component}.${target.field}`;
			const effective = resolveCoverage(id, target.defaultSeverity, coverageCfg);
			strict[id] = effective === 'warn' ? 'error' : effective;
		}
		coverageCfg = strict;
	}

	function buildPlugin(
		plugin: ResolvedPlugin,
		pluginGroupIds: Set<string>,
		pluginCoverageCfg: CoverageConfig = {}
	) {
		const { id, dir, marketEntry } = plugin;
		if (plugin.sourceKind === 'remote' || dir === null) {
			err(`${id}: cannot inspect remote source; use a local ./ source or pre-generate in the source repository`);
			return null;
		}
		const entryPath = authoredOverlaysEnabled ? entryPathForLayout(layout, plugin) : null;
		const presentationPath = entryPath ?? plugin.namespacedEntryPath;
		const entry = (() => {
			if (entryPath === null) return null;
			const raw = (() => {
				try {
					return loadYaml<unknown>(source, entryPath);
				} catch (error) {
					err(`${entryPath}: cannot parse YAML — ${error instanceof Error ? error.message : String(error)}`);
					return undefined;
				}
			})();
			if (raw === undefined) return null;
			if (raw == null) return null;
			const parsed = Entry.safeParse(raw);
			if (!parsed.success) {
				err(`${entryPath}: ${parsed.error.issues.map((issue) =>
					`${issue.path.join('.')} ${issue.message}`).join('; ')}`);
				return null;
			}
			return parsed.data;
		})();

		const pjPath = posix.join(dir, '.claude-plugin', 'plugin.json');
		const ownJson = source.exists(pjPath) ? readJSON(source, pjPath) : null;
		const label = ownJson === null ? 'marketplace entry' : 'plugin.json';
		const combined = effectiveManifest(source, dir, ownJson, marketEntry);
		errors.push(...combined.errors);
		const pj = combined.manifest as Record<string, any>;
		const pjParse = PluginJson.safeParse(pj);
		if (!pjParse.success) {
			for (const issue of pjParse.error.issues) err(`${id}/${label}: ${issue.path.join('.')} ${issue.message}`);
		}
		if (typeof pj.author === 'string') {
			err(`${id}/${label}: author must be an object {name, url?, email?}, not a string — Claude Code rejects string authors at install`);
		}
		if (ownJson !== null && ownJson.name !== id) {
			err(`${id}: plugin.json name "${ownJson.name}" != marketplace entry name "${id}" — both must be the canonical install id`);
		}

		if (entry?.group && !pluginGroupIds.has(entry.group)) {
			err(`${presentationPath}: group "${entry.group}" not declared in ${inspected.catalogPath ?? CATALOG_PATH} groups[]`);
		}

		const facts = extractNativeFacts(source, dir, warn, pj);
		const nSkills = facts.skills;
		const eSkills = new Map((entry?.skills ?? []).map((skill) => [skill.name, skill]));
		for (const skill of eSkills.keys()) {
			if (!nSkills.find((native) => native.name === skill)) err(`${presentationPath}: skill "${skill}" not found on disk`);
		}
		const skills = nSkills.map((native) => {
			const authored = eSkills.get(native.name);
			return prune({
				name: native.name,
				description: authored?.description ?? native.description,
				trigger: authored?.trigger,
				examples: authored?.examples,
				href: authored?.href,
				label: authored?.label,
				autoload: native.autoload,
				resources: native.resources
			});
		});

		const nCmds = facts.commands;
		const eCmds = new Map((entry?.commands ?? []).map((command) => [command.name, command]));
		for (const command of eCmds.keys()) {
			if (!nCmds.find((native) => native.name === command)) err(`${presentationPath}: command "${command}" not found on disk`);
		}
		const commands = nCmds.map((native) => {
			const authored = eCmds.get(native.name);
			return prune({
				name: native.name,
				summary: native.summary,
				description: authored?.description,
				arguments: native.arguments,
				examples: authored?.examples
			});
		});

		const nAgents = facts.agents;
		const eAgents = new Map((entry?.agents ?? []).map((agent) => [agent.name, agent]));
		for (const agent of eAgents.keys()) {
			if (!nAgents.find((native) => native.name === agent)) err(`${presentationPath}: agent "${agent}" not found on disk`);
		}
		const agents = nAgents.map((native) => {
			const authored = eAgents.get(native.name);
			return prune({
				name: native.name,
				summary: native.summary,
				description: authored?.description,
				returns: authored?.returns,
				not: authored?.not,
				tools: native.tools,
				examples: authored?.examples
			});
		});

		const nMcp = facts.mcp;
		const eMcp = new Map((entry?.mcp ?? []).map((server) => [server.name, server]));
		for (const server of eMcp.keys()) {
			if (!nMcp.find((native) => native.name === server)) err(`${presentationPath}: mcp "${server}" not in .mcp.json`);
		}
		const mcp = nMcp.map((native) => {
			const authored = eMcp.get(native.name);
			for (const env of authored?.env ?? []) {
				if (!native.envKeys.includes(env.key)) err(`${presentationPath}: ${native.name} env "${env.key}" not in .mcp.json`);
			}
			return prune({
				name: native.name,
				type: native.type,
				install: authored?.install,
				auth: authored?.auth,
				repo: authored?.repo,
				env: authored?.env,
				setup: authored?.setup,
				description: authored?.description,
				provides: authored?.provides,
				config: authored?.config
			});
		});

		const nHooks = facts.hooks;
		const eHooks = entry?.hooks ?? [];
		const hookMatches = (authored: { event: string; matcher?: string }, native: { event: string; matcher?: string }) =>
			authored.event === native.event && (authored.matcher === undefined || authored.matcher === native.matcher);
		for (const authored of eHooks) {
			if (!nHooks.find((native) => hookMatches(authored, native))) {
				err(`${presentationPath}: hook "${authored.event}${authored.matcher ? `/${authored.matcher}` : ''}" not found in hooks.json`);
			}
		}
		const hooks = nHooks.map((native) => prune({ ...native, why: eHooks.find((authored) => hookMatches(authored, native))?.why }));

		const eMods = new Map((entry?.mods ?? []).map((mod) => [mod.module.replace(/^(?:\.\/)+/, ''), mod]));
		for (const module of eMods.keys()) {
			if (!facts.mods.find((native) => native.module === module)) err(`${presentationPath}: mod "${module}" not named under modules in a hooks file`);
		}
		const mods = facts.mods.map((native) => prune({ module: native.module, description: eMods.get(native.module)?.description }));

		// userConfig fields first (declaration order), authored text overriding the
		// native description; then authored-only settings (e.g. .local.md keys).
		const eConfig = new Map((entry?.configuration ?? []).map((config) => [config.key, config]));
		const configuration = [
			...facts.userConfig.map((native) => {
				const authored = eConfig.get(native.key);
				if (authored?.type && authored.type !== native.type) {
					err(`${presentationPath}: configuration "${native.key}" type "${authored.type}" != plugin.json userConfig type "${native.type}"`);
				}
				return prune({
					...native,
					description: authored?.description ?? native.description,
					default: native.sensitive ? undefined : authored?.default ?? native.default,
					required: native.required ?? authored?.required,
					userConfig: true
				});
			}),
			...[...eConfig.values()]
				.filter((authored) => !facts.userConfig.some((native) => native.key === authored.key))
				.map((authored) => {
					if (!authored.type) err(`${presentationPath}: configuration "${authored.key}" needs a type (it is not a plugin.json userConfig field)`);
					return prune({ ...authored });
				})
		];
		const cov = analyzeCoverage(facts, entry, pluginCoverageCfg, id, entryPath ?? plugin.namespacedEntryPath);
		for (const finding of cov.findings) (finding.severity === 'error' ? err : warn)(finding.message);

		const author = pj.author
			? prune({ name: pj.author.name, email: pj.author.email, url: pj.author.url })
			: undefined;

		return prune({
			id,
			name: (ownJson?.name as string | undefined) ?? id,
			displayName: pj.displayName,
			version: pj.version ?? '0.0.0',
			description: pj.description,
			icon: pj.icon,
			defaultEnabled: pj.defaultEnabled,
			author,
			license: pj.license,
			homepage: pj.homepage,
			repository: typeof pj.repository === 'string' ? pj.repository : pj.repository?.url,
			keywords: pj.keywords,
			dependencies: pj.dependencies?.map((dep: PluginDependency) =>
				typeof dep === 'string' ? dep : dep.marketplace ? `${dep.name}@${dep.marketplace}` : dep.name),
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
			mods,
			lsp: facts.lsp,
			outputStyles: facts.outputStyles.map((style) => prune({ ...style })),
			workflows: facts.workflows.map((workflow) => prune({ ...workflow })),
			themes: facts.themes.map((theme) => prune({ ...theme })),
			monitors: facts.monitors.map((monitor) => prune({ ...monitor })),
			bin: facts.bin,
			channels: facts.channels.map((channel) => prune({ ...channel })),
			configuration,
			tips: (entry?.tips ?? []).map((tip) => (typeof tip === 'string' ? { text: tip } : tip)),
			traps: (entry?.traps ?? []).map((trap) => (typeof trap === 'string' ? { text: trap } : trap))
		});
	}

	const plugins = resolution.plugins
		.map((plugin) => {
			try {
				// Without plugin.json the marketplace entry is the manifest, but the
				// source folder itself must exist.
				if (plugin.sourceKind === 'local' && plugin.dir !== null && !source.isDir(plugin.dir)) {
					err(`${plugin.id}: local source folder ${plugin.dir || '.'} does not exist`);
					return null;
				}
				return buildPlugin(plugin, groupIds, coverageCfg);
			} catch (error) {
				err(`${plugin.id}: failed to process — ${error instanceof Error ? error.message : String(error)}`);
				return null;
			}
		})
		.filter((plugin): plugin is NonNullable<typeof plugin> => plugin !== null);

	const manifest = {
		schemaVersion: layout === 'legacy' && catalog ? catalog.schemaVersion : CURRENT_FORMAT_VERSION,
		marketplace: prune({ name: market.name, description: market.description, lang: catalog?.lang, owner: market.owner }),
		groups: catalog?.groups,
		plugins
	};
	if (!manifest.groups) delete (manifest as { groups?: unknown }).groups;

	const result = Manifest.safeParse(manifest);
	if (!result.success) {
		for (const issue of result.error.issues) err(`manifest: ${issue.path.join('.')} ${issue.message}`);
	}

	return finish(manifest, layout);
}
