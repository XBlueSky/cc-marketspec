import { z } from 'zod';
import { examples, note, slug, envKey, hookEvent } from './common.ts';

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
		trigger: z.string().min(1).max(280).describe("Human 'when to reach for it'.").optional(),
		examples: examples.optional(),
		href: z.string().optional(),
		label: z.string().max(120).optional()
	})
	.strict();

const command = z
	.object({
		name: slug,
		description: z.string().min(1).max(600).describe('Curated long copy; falls back to native.').optional(),
		examples: examples.optional()
	})
	.strict();

const agent = z
	.object({
		name: slug,
		returns: z.string().min(1).max(280).describe('What the agent reports back.').optional(),
		not: z.string().min(1).max(280).describe('Boundaries / what it will not do.').optional(),
		description: z.string().min(1).max(600).describe('Curated copy; falls back to native.').optional(),
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
			.optional(),
		setup: z.array(mcpSetup).optional(),
		description: z.string().min(1).max(600).optional(),
		provides: z
			.array(z.string().min(1))
			.min(1)
			.describe('Tool names. AUTHORED, best-effort: not statically validatable (runtime-discovered).')
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
			.optional(),
		tagline: z
			.string()
			.min(1)
			.max(120)
			.describe('One-line summary for cards/meta; falls back to native description.')
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
