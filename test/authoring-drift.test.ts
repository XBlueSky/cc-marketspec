// Guards single-source: src/authoring.generated.ts and the plugin reference copy
// must both derive from src/authoring.md. If authoring.md changed without a
// rebuild, these drift and the test fails (run: npm run build:schemas).
// Run: node --test test/authoring-drift.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAuthoring } from '../src/authoring.ts';
import { AUTHORING } from '../src/authoring.generated.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'src', 'authoring.md'), 'utf8');
const fromSource = parseAuthoring(md);

test('authoring.generated.ts matches src/authoring.md (rebuild if this fails)', () => {
	assert.deepEqual(AUTHORING, fromSource);
});

test('plugin reference copy matches src/authoring.md verbatim (rebuild if this fails)', () => {
	const ref = readFileSync(join(root, 'plugins', 'cc-marketspec', 'skills', 'marketplace-flow', 'references', 'entry-authoring.md'), 'utf8');
	assert.equal(ref, md);
});
