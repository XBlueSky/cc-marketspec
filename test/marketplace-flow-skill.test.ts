import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const skillDir = fileURLToPath(
  new URL('../plugins/cc-marketspec/skills/marketplace-flow/', import.meta.url),
);

function frontmatter(md: string): Record<string, unknown> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'SKILL.md must start with a YAML frontmatter block');
  return yaml.load(m[1]) as Record<string, unknown>;
}

test('SKILL.md has valid frontmatter with name and description', () => {
  const md = readFileSync(new URL('SKILL.md', `file://${skillDir}`), 'utf8');
  const fm = frontmatter(md);
  assert.equal(fm.name, 'marketplace-flow');
  assert.equal(typeof fm.description, 'string');
  assert.ok((fm.description as string).length > 40, 'description should carry trigger phrases');
});

test('SKILL.md does not disable auto-trigger', () => {
  const md = readFileSync(new URL('SKILL.md', `file://${skillDir}`), 'utf8');
  const fm = frontmatter(md);
  // native.ts derives autoload from `user-invocable === false`; this skill must
  // stay auto-triggerable, so the key must be absent (or not false).
  assert.notEqual(fm['user-invocable'], false);
});

test('both CI workflow assets exist and are valid YAML', () => {
  for (const name of ['github-manifest.yml', 'gitlab-manifest.yml']) {
    const p = new URL(`assets/${name}`, `file://${skillDir}`);
    assert.ok(existsSync(p), `${name} must exist`);
    assert.doesNotThrow(() => yaml.load(readFileSync(p, 'utf8')), `${name} must be valid YAML`);
  }
});

test('CI templates regenerate the manifest via the npx entrypoint', () => {
  for (const name of ['github-manifest.yml', 'gitlab-manifest.yml']) {
    const body = readFileSync(new URL(`assets/${name}`, `file://${skillDir}`), 'utf8');
    assert.ok(body.includes('npx @xbluesky/cc-marketspec'), `${name} must call the cc-marketspec CLI`);
  }
});

test('starter marketplace.json asset exists and is valid JSON', () => {
  const p = new URL('assets/marketplace.json.example', `file://${skillDir}`);
  assert.ok(existsSync(p), 'marketplace.json.example must exist');
  assert.doesNotThrow(() => JSON.parse(readFileSync(p, 'utf8')), 'must be valid JSON');
});

test('SKILL.md anchors all asset references with ${CLAUDE_SKILL_DIR}', () => {
  const md = readFileSync(new URL('SKILL.md', `file://${skillDir}`), 'utf8');
  // every `assets/` mention must be preceded by the skill-dir variable
  const bare = md.split('\n').filter((l) => /assets\//.test(l) && !/CLAUDE_SKILL_DIR/.test(l));
  assert.deepEqual(bare, [], 'every assets/ reference must use ${CLAUDE_SKILL_DIR}');
});

test('SKILL.md does not use ${CLAUDE_PLUGIN_ROOT} (wrong var for skill body)', () => {
  const md = readFileSync(new URL('SKILL.md', `file://${skillDir}`), 'utf8');
  assert.ok(!md.includes('CLAUDE_PLUGIN_ROOT'), 'skill body must use CLAUDE_SKILL_DIR, not CLAUDE_PLUGIN_ROOT');
});

test('plugin ships a README and LICENSE', () => {
  const pluginDir = fileURLToPath(new URL('../plugins/cc-marketspec/', import.meta.url));
  assert.ok(existsSync(new URL('README.md', `file://${pluginDir}`)), 'plugin README must exist');
  assert.ok(existsSync(new URL('LICENSE', `file://${pluginDir}`)), 'plugin LICENSE must exist');
});

test('repo README $schema example uses the scoped package path', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(!/node_modules\/cc-marketspec\//.test(readme), 'must use scoped @xbluesky path, not bare cc-marketspec');
});
