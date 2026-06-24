import { z } from 'zod';

/** Concrete things a user would say / type. For commands, a filled-in invocation. */
export const examples = z.array(z.string().min(1).max(120)).max(5);

/** A tip or trap: a plain string, or an object with an optional link. */
export const note = z.union([
	z.string().min(1).max(280),
	z
		.object({
			text: z.string().min(1).max(280),
			href: z.string().optional(),
			label: z.string().max(120).optional()
		})
		.strict()
]);

export const slug = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/)
	.max(64);

export const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

/** Claude Code hook events. */
export const hookEvent = z.enum([
	'PreToolUse',
	'PostToolUse',
	'PostToolUseFailure',
	'PermissionRequest',
	'UserPromptSubmit',
	'Notification',
	'Stop',
	'SubagentStart',
	'SubagentStop',
	'SessionStart',
	'SessionEnd',
	'PreCompact'
]);
