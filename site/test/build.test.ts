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

test('rendered HTML lists skills, commands, and mcp tools', () => {
	const html = readFileSync(`${siteDir}/dist/index.html`, 'utf8');
	assert.match(html, /marketplace-flow/, 'skill name appears');
	assert.match(html, /cc-generate/, 'command name appears');
	assert.match(html, /get_schema/, 'an mcp provided tool appears');
});

test('rendered HTML shows tips (incl. object-form href/label) and traps', () => {
	const html = readFileSync(`${siteDir}/dist/index.html`, 'utf8');
	assert.match(html, /dogfoods its own framework/, 'a string-form tip appears');
	assert.match(html, /Hosted MCP/, 'an object-form tip label appears');
	assert.match(html, /never restates native facts/, 'a trap appears');
});

test('build inlines fonts as data-URI (no font CDN)', () => {
	const html = readFileSync(`${siteDir}/dist/index.html`, 'utf8');
	assert.match(html, /data:font\/woff2;base64/, 'a font is inlined');
	assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, 'no google font CDN');
});
test('page uses the light-ground clay palette', () => {
	const html = readFileSync(`${siteDir}/dist/index.html`, 'utf8');
	assert.match(html, /#FBFAF8/i, 'paper ground token present');
	assert.match(html, /#C15F3C/i, 'clay accent token present');
});
