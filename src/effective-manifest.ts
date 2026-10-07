// How a marketplace entry combines with the plugin's own plugin.json, per the
// Claude Code marketplace reference ("How an entry combines with plugin.json"):
//   - no plugin.json: the entry is the manifest, whatever `strict` says;
//   - plugin.json present, strict (default true): plugin.json is the manifest; the
//     entry's component fields are appended, except `hooks`, whose matchers
//     replace the manifest's per event; entry display fields win;
//   - plugin.json present, strict: false, and the entry declares components: a
//     conflict, and Claude Code refuses to load the plugin.

import { posix } from 'node:path';
import type { FileSource } from './fs-source.ts';

/** Internal key carrying entry hooks that replace plugin hooks per event. */
export const ENTRY_HOOKS = '\0entryHooks';

/** Keys only a marketplace entry has; never part of the plugin manifest. */
const ENTRY_ONLY = new Set(['source', 'category', 'tags', 'strict', 'relevance', 'metadata', 'headers', 'headersHelper']);
/** Fields where the entry's value is what users see, even when plugin.json sets one. */
const DISPLAY = ['displayName', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'defaultEnabled'];
/** Component fields an entry may append to a strict plugin.json, with the default folder each replaces. */
const APPENDED: Record<string, string | null> = { commands: 'commands', agents: 'agents', skills: null, outputStyles: 'output-styles' };
const COMPONENTS = ['commands', 'agents', 'skills', 'hooks', 'outputStyles', 'themes'];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function effectiveManifest(
	source: FileSource,
	dir: string,
	pluginJson: Record<string, unknown> | null,
	entry: Record<string, unknown>
): { manifest: Record<string, unknown>; errors: string[] } {
	const id = String(entry.name);
	const fromEntry = Object.fromEntries(Object.entries(entry).filter(([key]) => !ENTRY_ONLY.has(key)));
	const declared = COMPONENTS.filter((key) => entry[key] !== undefined);
	const errors: string[] = [];
	if (isObject(entry.hooks) === false && entry.hooks !== undefined) {
		errors.push(`${id}: marketplace entry hooks must be an inline object (file paths and arrays fail at load time)`);
	}

	if (pluginJson === null) {
		const manifest: Record<string, unknown> = { ...fromEntry };
		if (entry.themes !== undefined) manifest.experimental = { ...(isObject(manifest.experimental) ? manifest.experimental : {}), themes: entry.themes };
		return { manifest, errors };
	}
	if (entry.strict === false && declared.length > 0) {
		errors.push(
			`${id}: strict: false but the marketplace entry declares ${declared.join(', ')} while plugin.json exists — Claude Code refuses to load conflicting manifests`
		);
		return { manifest: pluginJson, errors };
	}

	const manifest: Record<string, unknown> = { ...pluginJson };
	for (const key of DISPLAY) if (entry[key] !== undefined) manifest[key] = entry[key];
	for (const [key, folder] of Object.entries(APPENDED)) {
		if (entry[key] === undefined) continue;
		const base = manifest[key] !== undefined
			? asList(manifest[key])
			: folder !== null && source.isDir(posix.join(dir, folder)) ? [`./${folder}`] : [];
		manifest[key] = [...base, ...asList(entry[key])];
	}
	if (entry.themes !== undefined) {
		const experimental = isObject(manifest.experimental) ? manifest.experimental : {};
		const base = experimental.themes !== undefined
			? asList(experimental.themes)
			: source.isDir(posix.join(dir, 'themes')) ? ['./themes'] : [];
		manifest.experimental = { ...experimental, themes: [...base, ...asList(entry.themes)] };
	}
	if (isObject(entry.hooks)) manifest[ENTRY_HOOKS] = entry.hooks;
	return { manifest, errors };
}
