import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generate.ts';
import { NodeFileSource } from '../src/fs-source.ts';

// The repo dogfoods its own framework: the root marketplace describes the
// cc-marketspec plugin. Guard the committed manifest.json against drift, the
// same way example.test.ts guards examples/marketplace/manifest.json.
const root = fileURLToPath(new URL('..', import.meta.url));

test('root marketplace generates with no errors', () => {
  const { errors } = generateManifest(new NodeFileSource(root));
  assert.deepEqual(errors, [], 'root marketplace generate reported errors');
});

test('committed manifest.json matches generator output', () => {
  const { manifest } = generateManifest(new NodeFileSource(root));
  const golden = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, golden, 'manifest.json drifted — run `node dist/cli.js` and commit');
});
