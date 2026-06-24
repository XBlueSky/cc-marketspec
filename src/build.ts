// Emit the published JSON Schema artifacts from the Zod source of truth.
// The emitted JSON mirrors the strict Zod 1:1 so the published contract and the
// runtime validator agree exactly. (An x-* extension hatch is a future
// back-compatible MINOR — omitted in v1 to keep the two layers identical.)
// Run: npm run build:schemas

import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Entry } from './entry.ts';
import { Catalog } from './catalog.ts';
import { Manifest } from './manifest.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const ID_BASE = 'https://raw.githubusercontent.com/XBlueSky/cc-marketspec/main/schemas';

const TARGETS = [
	{ name: 'entry', schema: Entry, title: 'Marketplace plugin entry (presentation descriptor)' },
	{ name: 'catalog', schema: Catalog, title: 'Marketplace catalog (presentation)' },
	{ name: 'manifest', schema: Manifest, title: 'Marketplace manifest (generated consumer API)' }
] as const;

for (const { name, schema, title } of TARGETS) {
	const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
	js.$schema = 'http://json-schema.org/draft-07/schema#';
	js.$id = `${ID_BASE}/${name}.schema.json`;
	js.title = title;
	writeFileSync(join(out, `${name}.schema.json`), JSON.stringify(js, null, 2) + '\n');
	console.log(`emitted schemas/${name}.schema.json`);
}
