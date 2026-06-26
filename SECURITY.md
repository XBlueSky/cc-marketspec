# Security Policy

## Supported Versions

cc-marketspec follows [semantic versioning](https://semver.org/). Security fixes
are released against the latest published version on npm. Please upgrade to the
latest `@xbluesky/cc-marketspec` release before reporting an issue, in case it
has already been addressed.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately through GitHub Security Advisories:

1. Go to the repository's
   [Security Advisories](https://github.com/XBlueSky/cc-marketspec/security/advisories/new)
   page.
2. Click **Report a vulnerability** and describe the issue, including steps to
   reproduce and the affected version.

You should receive an acknowledgement within a few days. We will work with you to
understand and resolve the issue, and will coordinate the timing of any public
disclosure.

## Scope

cc-marketspec is a headless data standard and generator. The most relevant
security surfaces are:

- The CLI / library (`@xbluesky/cc-marketspec`) that reads marketplace data and
  writes `manifest.json`.
- The hosted MCP server (`https://cc-marketspec-mcp.xbluesky.workers.dev`), which
  is read-only and stateless — it returns schema and validation help for the
  content you pass it and stores nothing.

If you find an issue in a dependency rather than in this project's own code,
please report it upstream to that project; we will still appreciate a heads-up.
