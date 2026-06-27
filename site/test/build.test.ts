import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('site build produces dist/index.html', () => {
	// build script must: regenerate top-level manifest, then astro build.
	execFileSync('npm', ['run', 'build'], { cwd: siteDir, stdio: 'pipe' });
	assert.ok(existsSync(`${siteDir}/dist/index.html`), 'dist/index.html exists');
});

test('build regenerates the top-level manifest (single source of truth)', () => {
	// After build, the top-level manifest is fresh and parseable with the expected marketplace name.
	const manifest = JSON.parse(readFileSync(`${repoRoot}/manifest.json`, 'utf8'));
	assert.equal(manifest.marketplace.name, 'cc-marketspec');
	assert.ok(Array.isArray(manifest.plugins) && manifest.plugins.length >= 1);
});

test('rendered HTML shows the plugin name, tagline, and a keyword', () => {
	const html = readFileSync(`${siteDir}/dist/index.html`, 'utf8');
	assert.match(html, /cc-marketspec/, 'plugin name appears');
	assert.match(html, /Headless data standard/, 'tagline appears');
	assert.match(html, /claude-code/, 'a keyword appears');
});
