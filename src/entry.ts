import { z } from 'zod';
import { examples, note, slug, envKey, hookEvent } from './common.ts';
import type { Severity } from './coverage.ts';

// Per-plugin presentation overlay (entry.yaml). EVERY field is optional: the
// generator derives missing values from the native plugin (plugin.json,
// skills/*/SKILL.md, commands/*.md, agents/*.md frontmatter, .mcp.json,
// hooks/hooks.json) and falls back as documented. Authored entries are keyed by
// name and validated against the on-disk component (referential integrity, done
// in generator code — JSON Schema/Zod can't cross-reference files).

const skill = z
	.object({
		name: slug,
		description: z
			.string()
			.min(1)
			.max(600)
			.describe('Curated human copy; falls back to native SKILL.md description.')
			.optional(),
		trigger: z.string().min(1).max(280).describe("Human 'when to reach for it'.").meta({ coverage: 'warn' }).optional(),
		examples: examples.meta({ coverage: 'off' }).optional(),
		href: z.string().optional(),
		label: z.string().max(120).optional()
	})
	.strict();

const command = z
	.object({
		name: slug,
		description: z.string().min(1).max(600).describe('Curated long copy; falls back to native.').meta({ coverage: 'off' }).optional(),
		examples: examples.optional()
	})
	.strict();

const agent = z
	.object({
		name: slug,
		returns: z.string().min(1).max(280).describe('What the agent reports back.').optional(),
		not: z.string().min(1).max(280).describe('Boundaries / what it will not do.').optional(),
		description: z.string().min(1).max(600).describe('Curated copy; falls back to native.').meta({ coverage: { component: 'agent', field: 'summary', severity: 'warn' } }).optional(),
		examples: examples.optional()
	})
	.strict();

const mcpEnv = z
	.object({
		key: envKey,
		value: z.string().min(1).describe('Human description of the variable.'),
		secret: z.boolean().optional()
	})
	.strict();

const mcpSetup = z
	.object({
		text: z.string().min(1),
		cmd: z.string().min(1).optional(),
		href: z.string().optional(),
		label: z.string().max(120).optional()
	})
	.strict();

const mcpConfig = z.object({ key: z.string().min(1), value: z.string().min(1) }).strict();

const mcp = z
	.object({
		name: z.string().min(1).max(64).describe('Server name; must match a server in .mcp.json.'),
		install: z.boolean().describe('Whether the user must install it themselves.').optional(),
		auth: z.enum(['none', 'token', 'oauth']).optional(),
		repo: z.string().min(1).optional(),
		env: z
			.array(mcpEnv)
			.describe('Descriptions for env vars; keys must exist in .mcp.json (phantom = error).')
			.meta({ coverage: 'warn' })
			.optional(),
		setup: z.array(mcpSetup).optional(),
		description: z.string().min(1).max(600).optional(),
		provides: z
			.array(z.string().min(1))
			.min(1)
			.describe('Tool names. AUTHORED, best-effort: not statically validatable (runtime-discovered).')
			.meta({ coverage: 'off' })
			.optional(),
		config: z.array(mcpConfig).optional()
	})
	.strict();

const hook = z
	.object({
		event: hookEvent,
		matcher: z.string().describe('Disambiguates when an event has multiple hooks.').optional(),
		why: z.string().min(1).max(280).describe('What this hook does / why it exists.').optional()
	})
	.strict();

const configuration = z
	.object({
		key: envKey,
		type: z.enum(['string', 'boolean', 'number', 'array']),
		default: z.unknown().optional(),
		description: z.string().min(1).max(600),
		required: z.boolean().optional()
	})
	.strict();

export const Entry = z
	.object({
		group: z
			.string()
			.max(64)
			.describe('id of a catalog.yaml group (authored). Native classification is surfaced separately as the manifest category.')
			.meta({ coverage: { component: 'plugin', field: 'group', severity: 'off' } })
			.optional(),
		tagline: z
			.string()
			.min(1)
			.max(120)
			.describe('One-line summary for cards/meta; falls back to native description.')
			.meta({ coverage: { component: 'plugin', field: 'tagline', severity: 'warn' } })
			.optional(),
		intro: z
			.string()
			.min(1)
			.max(600)
			.describe('Full lede; falls back to native description.')
			.optional(),
		ccVersion: z
			.string()
			.regex(/^\d+\.\d+\.\d+$/)
			.describe('Minimum Claude Code version. No native source.')
			.optional(),
		skills: z.array(skill).optional(),
		commands: z.array(command).optional(),
		agents: z.array(agent).optional(),
		mcp: z.array(mcp).optional(),
		hooks: z.array(hook).optional(),
		configuration: z.array(configuration).optional(),
		tips: z.array(note).describe('Positive power-moves.').optional(),
		traps: z.array(note).describe('Negative gotchas / pitfalls.').optional()
	})
	.strict();

export type Entry = z.infer<typeof Entry>;

// Walk the Entry schema's fields (and the per-component array element shapes),
// collecting fields tagged with a `coverage` marker. A marker is either a bare
// severity (component inferred from the array key, field from the property name)
// or an explicit { component, field, severity } for synthetic targets.
//
// Implementation note: in Zod 4, chaining .meta().optional() stores the metadata
// on the inner type. Since the shape's field is ZodOptional, we must unwrap it
// (via def.innerType) before calling .meta() to retrieve the metadata.
export function coverageTargets(): { component: string; field: string; defaultSeverity: Severity }[] {
	const out: { component: string; field: string; defaultSeverity: Severity }[] = [];

	// Unwrap a ZodOptional to access the inner type's metadata.
	const unwrap = (schema: any): any => (schema?.type === 'optional' ? schema.def?.innerType : schema);

	const push = (component: string, field: string, meta: unknown) => {
		if (meta && typeof meta === 'object' && 'component' in meta) {
			const m = meta as { component: string; field: string; severity: Severity };
			out.push({ component: m.component, field: m.field, defaultSeverity: m.severity });
		} else if (typeof meta === 'string') {
			out.push({ component, field, defaultSeverity: meta as Severity });
		}
	};

	const shape = (Entry as unknown as { shape: Record<string, any> }).shape;
	for (const [key, schema] of Object.entries(shape)) {
		const inner = unwrap(schema);
		const topMeta = inner?.meta?.()?.coverage;
		if (topMeta) push('plugin', key, topMeta);

		// array-of-object component fields: skills/commands/agents/mcp/hooks
		if (inner?.type === 'array') {
			const el = inner.element;
			const elShape = el?.shape;
			if (elShape) {
				const component = key.replace(/s$/, ''); // skills -> skill, commands -> command, etc.
				for (const [field, fs] of Object.entries(elShape as Record<string, any>)) {
					const m = unwrap(fs)?.meta?.()?.coverage;
					if (m) push(component, field, m);
				}
			}
		}
	}
	return out;
}

// Read the `.describe()` text the live Entry schema attaches to a given
// <component>.<field> path. Backs the `explain_field` MCP tool. Returns undefined
// for paths that don't resolve (never throws). Walks the schema exactly like
// coverageTargets (unwrap ZodOptional via def.innerType, read array elements via
// .element) so the two stay single-sourced. Handles the synthetic coverage remaps
// the markers introduce: `agent.summary` is carried on the agent element's
// `description` field; `plugin.tagline`/`plugin.group` are top-level Entry fields.
export function describeField(component: string, field: string): string | undefined {
	const unwrap = (schema: any): any => (schema?.type === 'optional' ? schema.def?.innerType : schema);
	const shape = (Entry as unknown as { shape: Record<string, any> }).shape;

	// Resolve the element shape for a component array, or the top-level shape for
	// `plugin`. Returns the shape object whose keys are candidate field names.
	// The component name is derived from the array key by coverageTargets via
	// `key.replace(/s$/, '')` (skills -> skill, but mcp -> mcp). That mapping is not
	// invertible by appending 's', so find the array key the same way instead.
	const fieldShape = (): Record<string, any> | undefined => {
		if (component === 'plugin') return shape;
		for (const [key, schema] of Object.entries(shape)) {
			if (key.replace(/s$/, '') !== component) continue;
			const arr = unwrap(schema);
			if (arr?.type === 'array') return arr.element?.shape;
		}
		return undefined;
	};

	const target = fieldShape();
	if (!target) return undefined;

	// A coverage marker may expose a field under a synthetic name (e.g. agent's
	// `description` is surfaced as `summary`). Find the real shape key: prefer an
	// exact field-name match, else a marker whose {component, field} matches.
	let key: string | undefined = field in target ? field : undefined;
	if (!key) {
		for (const [k, schema] of Object.entries(target)) {
			const m = unwrap(schema)?.meta?.()?.coverage;
			if (m && typeof m === 'object' && m.component === component && m.field === field) {
				key = k;
				break;
			}
		}
	}
	if (!key) return undefined;

	const f = unwrap(target[key]);
	return f?.meta?.()?.description ?? f?.description;
}
