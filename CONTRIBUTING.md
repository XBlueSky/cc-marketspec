# Contributing

## Prerequisites

- **Node.js ≥ 22.6** for development. The test suite runs TypeScript directly via
  `node --test` (native type stripping), which needs 22.6+. See [`.nvmrc`](.nvmrc).
  The *published* package (`dist/`, plain JS) runs on Node ≥ 20 — that's what
  `engines` declares; the higher floor is a contributor-only requirement.

```bash
nvm use            # picks up .nvmrc (22)
npm ci
```

## Source of truth

The Zod schemas in `src/{entry,catalog,manifest}.ts` are the single source of
truth. The published JSON Schemas in `schemas/*.schema.json` are **generated**
from them — never hand-edit `schemas/`.

```bash
npm run build:schemas   # regenerate schemas/ from the Zod source
```

CI fails (`schema_drift` job) if the committed `schemas/` differ from what the
Zod source emits, so regenerate and commit whenever you touch a schema.

## Local checks (mirror CI)

```bash
npm run type-check      # tsc --noEmit
npm run lint            # eslint
npm test                # node --test (schemas, generator, cli, example golden)
npm run build:schemas && git diff --exit-code -- schemas/   # schema drift
npm run build           # tsup -> dist/
```

The example marketplace doubles as a golden fixture. If you intentionally change
generator output, regenerate it and commit the result:

```bash
node dist/cli.js examples/marketplace
```

## Commits & releases

Use [Conventional Commits](https://www.conventionalcommits.org/) — `feat:` /
`fix:` / `docs:` / `chore:` / `ci:` / `build:` / `refactor:` / `test:`.
semantic-release derives the version, changelog, npm publish, and GitLab release
from commit history on the default branch. `feat` → minor, `fix` → patch.
