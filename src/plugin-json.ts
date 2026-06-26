// Shape-only validation for the plugin.json fields the generator reads.
// Every field is optional — absence is fine (presence is a coverage-gate
// concern, not here). Present fields must have the right type. Unknown keys
// pass through (z.looseObject) so official manifest additions don't fail.
// This is NOT the Claude Code official plugin manifest schema; it only
// guards the fields THIS generator consumes, so --check is not more lenient
// than the downstream consumer for those fields.

import { z } from 'zod';

export const PluginJson = z.looseObject({
	name: z.string().optional(),
	version: z.string().optional(),
	description: z.string().optional(),
	author: z
		.union(
			[
				z.string(),
				z.looseObject({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() }),
			],
			{ error: 'author must be a string or an object {name, url?, email?}' },
		)
		.optional(),
	license: z.string().optional(),
	homepage: z.string().optional(),
	repository: z
		.union([z.string(), z.looseObject({ url: z.string().optional() })], {
			error: 'repository must be a string or an object {url?}',
		})
		.optional(),
	keywords: z.array(z.string()).optional(),
	dependencies: z.array(z.string()).optional(),
});
