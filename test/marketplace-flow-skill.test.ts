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
