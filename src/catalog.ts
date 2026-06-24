import { z } from 'zod';
import { slug } from './common.ts';

// Marketplace-level presentation data (catalog.yaml). DATA only — no site design
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

export const Catalog = z
	.object({
		schemaVersion: z
			.string()
			.regex(/^\d+\.\d+$/)
			.describe('MAJOR.MINOR of the standard this catalog targets. Consumers gate on MAJOR.'),
		lang: z
			.string()
			.describe('BCP-47 primary language of all authored text (e.g. zh-TW). Defaults to en.')
			.optional(),
		groups: z
			.array(group)
			.describe('Group taxonomy; array order is the canonical display order.')
			.optional()
	})
	.strict();

export type Catalog = z.infer<typeof Catalog>;
