// Pure-function coverage core: given a plugin's native facts and its (optional)
// entry overlay, report which presentation fields are unfilled, at a severity
// resolved from config. No fs/cli/mcp. Rules are addressed by <component>.<field>
// dot paths; the checkable field set is reflected from the entry schema (Task 2).

import type { NativeFacts } from './native.ts';
import type { Entry } from './entry.ts';

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

// Task 1 ships one explicit rule; Task 2 replaces this array with one reflected
// from the entry schema markers. Keeping it explicit here locks the data flow.
const RULES: Rule[] = [
	{
		id: 'skill.trigger',
		defaultSeverity: 'warn',
		scan(facts, entry) {
			const authored = new Map((entry?.skills ?? []).map((s) => [s.name, s]));
			return facts.skills.filter((s) => !authored.get(s.name)?.trigger).map((s) => s.name);
		}
	}
];

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
