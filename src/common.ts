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

/** Claude Code settings-hook events known to this release (documentation only). */
export const KNOWN_HOOK_EVENTS = [
	'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'Elicitation', 'ElicitationResult', 'FileChanged',
	'InstructionsLoaded', 'MessageDisplay', 'Notification', 'PermissionDenied', 'PermissionRequest',
	'PostCompact', 'PostModelSwitch', 'PostToolBatch', 'PostToolUse', 'PostToolUseFailure', 'PreCompact',
	'PreModelSwitch', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Setup', 'Stop', 'StopFailure',
	'SubagentStart', 'SubagentStop', 'TaskCompleted', 'TaskCreated', 'TeammateIdle', 'UserPromptExpansion',
	'UserPromptSubmit', 'WorktreeCreate', 'WorktreeRemove'
] as const;

/** A Claude Code hook event name. Open-ended (PascalCase) so a plugin using an event
 *  newer than this release still generates; authored hooks must match hooks.json
 *  anyway, which is the real check. */
export const hookEvent = z
	.string()
	.regex(/^[A-Z][A-Za-z0-9]*$/)
	.describe(`Hook event name, e.g. ${KNOWN_HOOK_EVENTS.slice(0, 4).join(', ')}.`);
