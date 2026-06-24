// Golden end-to-end test: run the generator against the committed example
// marketplace and assert it reproduces the committed manifest.json exactly.
// This keeps examples/ honest (a living fixture, not stale docs) and exercises
// the full join + derive path on a realistic on-disk repo.
// If you intentionally change generator output, regenerate the golden with:
//   node dist/cli.js examples/marketplace
// Run: node --test test/example.test.ts   (Node >=23 strips TS types)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generate.ts';
import { NodeFileSource } from '../src/fs-source.ts';

const root = fileURLToPath(new URL('../examples/marketplace', import.meta.url));

test('the example marketplace reproduces its committed golden manifest', () => {
	const { manifest, errors, warnings } = generateManifest(new NodeFileSource(root));
	assert.deepEqual(errors, [], 'example must generate without errors');
	assert.deepEqual(warnings, [], 'example must generate without warnings');
	const golden = JSON.parse(readFileSync(new URL('../examples/marketplace/manifest.json', import.meta.url), 'utf8'));
	assert.deepEqual(manifest, golden, 'generator output drifted from examples/marketplace/manifest.json — regenerate it');
});
