---
name: cc-init
description: Scaffold namespaced marketplace authoring files from existing plugins.
allowed-tools: Bash(npx:*)
---

Run `npx @xbluesky/cc-marketspec@latest init` in the current working directory.
This detects existing plugins and creates authored files only; it does not
generate output.

- Authored catalog: `.cc-marketspec/catalog.yaml`
- Authored plugin entry: `.cc-marketspec/entries/plugin-<id>.yaml`
- Default generated output: `.cc-marketspec/dist/manifest.json`

`/cc-init` creates authored files only; it does not generate output. The default
generated path is ignored and is produced later by `/cc-generate`.

The scaffold's editor directive points to
`../../node_modules/@xbluesky/cc-marketspec/schemas/entry.schema.json`. Editor
completion therefore requires an exact devDependency in this repository. Install
it once and commit the resulting `package.json` and `package-lock.json`:

```bash
npm install --save-dev --save-exact @xbluesky/cc-marketspec@latest
```

CLI use through `npx` works without this local dependency; the install is for
editor schema completion and reproducible CI.

After it runs, tell the user which template fields to fill in next (taglines,
skill triggers, command/agent descriptions). Then point them at `/cc-check` to
validate, and `/cc-generate` once it is clean. The marketplace-flow skill can
drive this whole sequence end to end.
