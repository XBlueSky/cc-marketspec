// Pure-function coverage core: given a plugin's native facts and its (optional)
// entry overlay, report which presentation fields are unfilled, at a severity
// resolved from config. No fs/cli/mcp. Rules are addressed by <component>.<field>
// dot paths; the checkable field set is reflected from the entry schema (Task 2).

import type { NativeFacts } from './native.ts';
import type { Entry } from './entry.ts';
import { coverageTargets } from './entry.ts';

export type Severity = 'error' | 'warn' | 'off';

export interface CoverageFinding {
	ruleId: string;
	severity: 'error' | 'warn';
	pluginId: string;
	component?: string;
	message: string;
}

export interface CoverageReport {
	findings: CoverageFinding[];
	summary: { error: number; warn: number; off: number };
}

export type CoverageConfig = Record<string, Severity>;

// A rule: which native components to scan, the entry field that satisfies it,
// its built-in default severity, and how to tell if it's unfilled.
interface Rule {
	id: string; // "<component>.<field>"
	defaultSeverity: Severity;
	// returns the list of unsatisfied component instances (by display name)
	scan(facts: NativeFacts, entry: Entry | null): string[];
}

// Per-rule scan functions keyed by "<component>.<field>".
// Each returns the list of unsatisfied component instances (by display name).
const SCANNERS: Record<string, (facts: NativeFacts, entry: Entry | null) => string[]> = {
	'skill.trigger': (f, e) => {
		const a = new Map((e?.skills ?? []).map((s) => [s.name, s]));
		return f.skills.filter((s) => !a.get(s.name)?.trigger).map((s) => s.name);
	},
	'skill.examples': (f, e) => {
		const a = new Map((e?.skills ?? []).map((s) => [s.name, s]));
		return f.skills.filter((s) => !(a.get(s.name)?.examples?.length)).map((s) => s.name);
	},
	'command.description': (f, e) => {
		const a = new Map((e?.commands ?? []).map((c) => [c.name, c]));
		return f.commands.filter((c) => !a.get(c.name)?.description).map((c) => c.name);
	},
	'agent.summary': (f, e) => {
		const a = new Map((e?.agents ?? []).map((x) => [x.name, x]));
		return f.agents.filter((x) => !x.summary && !a.get(x.name)?.description).map((x) => x.name);
	},
	'mcp.env': (f, e) => {
		const a = new Map((e?.mcp ?? []).map((m) => [m.name, m]));
		return f.mcp
			.filter((m) => m.envKeys.length > 0)
			.filter((m) => {
				const described = new Set((a.get(m.name)?.env ?? []).map((x) => x.key));
				return m.envKeys.some((k) => !described.has(k));
			})
			.map((m) => m.name);
	},
	'mcp.provides': (f, e) => {
		const a = new Map((e?.mcp ?? []).map((m) => [m.name, m]));
		return f.mcp.filter((m) => !(a.get(m.name)?.provides?.length)).map((m) => m.name);
	},
	'plugin.tagline': (f, e) => (!e?.tagline && !f.plugin.description ? ['plugin'] : []),
	'plugin.group': (_f, e) => (!e?.group ? ['plugin'] : [])
};

// Build RULES by reflecting coverage markers from the Entry schema.
// The entry schema fields carry .meta({ coverage }) markers; coverageTargets()
// walks the schema and returns { component, field, defaultSeverity } for each.
const RULES: Rule[] = coverageTargets().map((t) => ({
	id: `${t.component}.${t.field}`,
	defaultSeverity: t.defaultSeverity,
	scan: SCANNERS[`${t.component}.${t.field}`] ?? (() => [])
}));

function resolve(ruleId: string, def: Severity, config: CoverageConfig): Severity {
	return config[ruleId] ?? config['*'] ?? def;
}

export function analyzeCoverage(
	facts: NativeFacts,
	entry: Entry | null,
	config: CoverageConfig,
	pluginId: string
): CoverageReport {
	const findings: CoverageFinding[] = [];
	const summary = { error: 0, warn: 0, off: 0 };
	for (const rule of RULES) {
		const severity = resolve(rule.id, rule.defaultSeverity, config);
		const hits = rule.scan(facts, entry);
		if (hits.length === 0) continue;
		if (severity === 'off') {
			summary.off += 1;
			continue;
		}
		for (const component of hits) {
			findings.push({
				ruleId: rule.id,
				severity,
				pluginId,
				component,
				message: `${rule.id}: "${component}" has no authored value`
			});
			summary[severity] += 1;
		}
	}
	return { findings, summary };
}
