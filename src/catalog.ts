import { z } from 'zod';
import { slug } from './common.ts';
import { coverageTargets } from './entry.ts';

// Marketplace-level authored presentation data (.cc-marketspec/catalog.yaml).
// DATA only — no site design
// (theme/hero/nav/layout are the consumer's). Native marketplace metadata
// (name/description/owner) comes from .claude-plugin/marketplace.json and is NOT
// restated here.

const group = z
	.object({
		id: slug,
		label: z.string().min(1).max(120),
		note: z.string().min(1).max(120).describe('Short sub-label / description.').optional()
	})
	.strict();

const groups = z
	.array(group)
	.superRefine((values, context) => {
		const seen = new Set<string>();
		for (const [index, value] of values.entries()) {
			if (seen.has(value.id)) {
				context.addIssue({
					code: 'custom',
					path: [index, 'id'],
					message: `duplicate group id "${value.id}"`
				});
				break;
			}
			seen.add(value.id);
		}
	})
	.describe('Group taxonomy; array order is the canonical display order.');

const severity = z.enum(['error', 'warn', 'off']);
const validKeys = new Set(['*', ...coverageTargets().map((t) => `${t.component}.${t.field}`)]);

const coverage = z
	.record(z.string(), severity)
	.refine((o) => Object.keys(o).every((k) => validKeys.has(k)), {
		message: 'unknown coverage rule path (use <component>.<field> or "*")'
	})
	.describe('Per-rule severity overrides for the coverage gate.');

export const Catalog = z
	.object({
		schemaVersion: z
			.string()
			.regex(/^\d+\.\d+$/)
			.describe('MAJOR.MINOR format compatibility version. This is not package SemVer; runtime compatibility is enforced by version.ts.'),
		lang: z
			.string()
			.describe('BCP-47 primary language of all authored text (e.g. zh-TW). Defaults to en.')
			.optional(),
		groups: groups.optional(),
		coverage: coverage.optional()
	})
	.strict();

export type Catalog = z.infer<typeof Catalog>;
