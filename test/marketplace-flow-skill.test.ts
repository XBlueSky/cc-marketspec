import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import yaml from 'js-yaml';

const skillDir = fileURLToPath(
  new URL('../plugins/cc-marketspec/skills/marketplace-flow/', import.meta.url),
);

const SKILL_DIR = skillDir;

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

test('plugin README carries the install commands (the first thing a user sees)', () => {
  const readme = readFileSync(new URL('../plugins/cc-marketspec/README.md', import.meta.url), 'utf8');
  assert.match(readme, /claude plugin marketplace add XBlueSky\/cc-marketspec/, 'has marketplace add');
  assert.match(readme, /claude plugin install cc-marketspec/, 'has install');
});

test('repo README $schema example uses the scoped package path', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(!/node_modules\/cc-marketspec\//.test(readme), 'must use scoped @xbluesky path, not bare cc-marketspec');
});

test('repo README publishes the complete namespaced format 1.1 contract', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const value of [
    '.cc-marketspec/catalog.yaml',
    '.cc-marketspec/entries/plugin-<id>.yaml',
    '.cc-marketspec/dist/manifest.json',
    'migrate --dry-run',
    'migrate --from legacy',
    '--output site/public/manifest.json',
    'Format `1.0`',
    'format `1.1`',
    'npm package versions',
  ]) assert.match(readme, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /workflow artifacts? (?:are|is) temporary/i);
  assert.match(readme, /remote source objects?.*not fetched/is);
  assert.match(readme, /do not .*commit.*\.cc-marketspec\/dist\/manifest\.json/i);
  assert.doesNotMatch(readme, /generated `manifest\.json` can be committed/i);
});

test('tracked dogfood presentation teaches only canonical bundle paths', () => {
  const entry = readFileSync(new URL('../.cc-marketspec/entries/plugin-cc-marketspec.yaml', import.meta.url), 'utf8');
  assert.match(entry, /\.cc-marketspec\/dist\/manifest\.json/);
  assert.match(entry, /\.cc-marketspec\/catalog\.yaml/);
  assert.match(entry, /\.cc-marketspec\/entries\/plugin-<id>\.yaml/);
  assert.doesNotMatch(entry, /description: (?:Generate|Scaffold) (?:manifest\.json|catalog\.yaml)/);
});

test('SKILL.md Step 2 points to the entry-authoring reference and the MCP authoring tools', () => {
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /entry-authoring/);
  assert.match(skill, /list_authoring_sections|get_authoring_guide/);
});

test('workflow guidance uses namespaced paths and never commits generated output', () => {
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /\.cc-marketspec\/catalog\.yaml/);
  assert.match(skill, /\.cc-marketspec\/entries\/plugin-<id>\.yaml/);
  assert.match(skill, /\.cc-marketspec\/dist\/manifest\.json/);
  assert.match(skill, /migrate --from legacy/);
  assert.doesNotMatch(skill, /commit (the )?manifest|git path|push.*manifest/i);
  assert.doesNotMatch(skill, /--force/);

  for (const name of ['github-manifest.yml', 'gitlab-manifest.yml']) {
    const body = readFileSync(new URL(`assets/${name}`, `file://${SKILL_DIR}`), 'utf8');
    assert.match(body, /--check/);
    assert.match(body, /\.cc-marketspec\/dist\/manifest\.json/);
    assert.doesNotMatch(body, /git add|git commit|git push|contents:\s*write/);
  }
});

test('CI assets validate before generating source-only build artifacts', () => {
  const github = readFileSync(new URL('assets/github-manifest.yml', `file://${SKILL_DIR}`), 'utf8');
  assert.match(github, /permissions:\s*\n\s*contents: read/);
  assert.match(github, /pull_request:/);
  assert.match(github, /needs: validate/);

  const gitlab = readFileSync(new URL('assets/gitlab-manifest.yml', `file://${SKILL_DIR}`), 'utf8');
  assert.match(gitlab, /stages: \[validate, build\]/);
  assert.match(gitlab, /validate-marketplace:/);
  assert.match(gitlab, /generate-marketplace:/);

  for (const body of [github, gitlab]) {
    assert.doesNotMatch(body, /\bgit\s+(?:add|commit|push)\b/);
    assert.doesNotMatch(body, /(?:^|\s)(?:>|>>).*\.cc-marketspec\//m);
  }
});

test('plugin exposes a safe, resumable migration command', () => {
  const path = new URL('../plugins/cc-marketspec/commands/cc-migrate.md', import.meta.url);
  assert.equal(existsSync(path), true);
  const body = readFileSync(path, 'utf8');
  assert.match(body, /cc-marketspec@latest migrate/);
  assert.match(body, /--dry-run/);
  assert.match(body, /explicit(?:ly)? (?:confirm|confirmation)/i);
  assert.match(body, /rerun safely resumes cleanup/i);
  assert.doesNotMatch(body, /--force|git add|git commit|git push/i);
});

test('all plugin command docs distinguish authored inputs from ignored generated output', () => {
  const commandDir = new URL('../plugins/cc-marketspec/commands/', import.meta.url);
  const init = readFileSync(new URL('cc-init.md', commandDir), 'utf8');
  const check = readFileSync(new URL('cc-check.md', commandDir), 'utf8');
  const generate = readFileSync(new URL('cc-generate.md', commandDir), 'utf8');
  const migrate = readFileSync(new URL('cc-migrate.md', commandDir), 'utf8');
  const readme = readFileSync(new URL('../plugins/cc-marketspec/README.md', import.meta.url), 'utf8');

  for (const body of [init, check, generate, readme]) {
    assert.match(body, /\.cc-marketspec\/catalog\.yaml/);
    assert.match(body, /\.cc-marketspec\/entries\/plugin-<id>\.yaml/);
    assert.match(body, /\.cc-marketspec\/dist\/manifest\.json/);
  }
  assert.match(init, /authored files only/i);
  assert.match(check, /without writing any file/i);
  assert.match(generate, /ignored output by default/i);
  assert.match(generate, /--output.*explicit consumer-build escape hatch/is);
  assert.doesNotMatch([init, check, generate, migrate, readme].join('\n'), /--force|git add|git commit|git push/i);
});

test('authoring source defines canonical marketplace-owned overlay paths', () => {
  const authoring = readFileSync(new URL('../src/authoring.md', import.meta.url), 'utf8');
  const prose = authoring.replace(/```yaml[\s\S]*?```/g, '');
  assert.match(authoring, /^`\.cc-marketspec\/entries\/plugin-<id>\.yaml` is a marketplace-owned presentation/m);
  assert.match(authoring, /\.cc-marketspec\/catalog\.yaml/);
  assert.doesNotMatch(prose, /(?<![\w/.`-])entry\.yaml/);
  assert.doesNotMatch(prose, /(?<![\w/.`-])catalog\.yaml/);
  assert.doesNotMatch(authoring, /(?<![\w/.`-])entry\.yaml/);
});

test('canonical entry guidance resolves the published schema from the entry directory', () => {
  const directive = '../../node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json';
  const init = readFileSync(new URL('../src/init.ts', import.meta.url), 'utf8');
  const authoring = readFileSync(new URL('../src/authoring.md', import.meta.url), 'utf8');
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  for (const body of [init, authoring, skill]) assert.match(body, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
