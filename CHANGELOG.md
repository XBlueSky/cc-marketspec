## [0.2.1](https://github.com/XBlueSky/cc-marketspec/compare/v0.2.0...v0.2.1) (2026-06-25)


### Bug Fixes

* **release:** regenerate inlined schemas on version bump ([c580d2b](https://github.com/XBlueSky/cc-marketspec/commit/c580d2be5b606538abc539d3da94f003c5fb7c93))

# [0.2.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.1.1...v0.2.0) (2026-06-25)


### Bug Fixes

* **ci:** rebuild lockfile against public registry so npm ci stops hanging ([e6b5dea](https://github.com/XBlueSky/cc-marketspec/commit/e6b5deac74e2fcec464743ae10fc6fc3a91a653d))
* **http:** reject DELETE symmetrically with GET; clearer 405 error code ([aefeb86](https://github.com/XBlueSky/cc-marketspec/commit/aefeb867bbc6803e1400b5dd32d67aa87c819678))
* **mcp:** resolve explain_field via live schema walk; guard tool errors ([a8ef728](https://github.com/XBlueSky/cc-marketspec/commit/a8ef72876d34976f96f819161061c77fd62f4286))


### Features

* add --strict-coverage flag promoting coverage warnings to errors ([8ba7e5e](https://github.com/XBlueSky/cc-marketspec/commit/8ba7e5e2ba133a5534c1785bdd5491fcfb9cb527))
* add coverage config block to catalog schema ([8ad11bf](https://github.com/XBlueSky/cc-marketspec/commit/8ad11bfa18dac8866b0fc72440d0f782bde56030))
* add coverage core with severity resolution and skill.trigger rule ([202d95f](https://github.com/XBlueSky/cc-marketspec/commit/202d95fed9f3107f57f4614d464eb1b336b459e5))
* add detection-based init scaffold command ([6467ecb](https://github.com/XBlueSky/cc-marketspec/commit/6467ecba3bfd40fd9178f950bf9e96164a594a87))
* add MCP server with schema/coverage/scaffold tools over stdio ([96131bc](https://github.com/XBlueSky/cc-marketspec/commit/96131bc02187003ecb984958796a6e046bef8c42))
* coverage framework — analyzeCoverage core + CLI/MCP/init outlets ([6de1f74](https://github.com/XBlueSky/cc-marketspec/commit/6de1f747345797524147873c9e5475cc57637fcf))
* fold coverage findings into the generator error/warning flow ([ba4e914](https://github.com/XBlueSky/cc-marketspec/commit/ba4e91493ded90b66e94154b37e41fa052268c12))
* **mcp:** build-inline schemas+version; drop runtime fs from getSchema ([a0dbec9](https://github.com/XBlueSky/cc-marketspec/commit/a0dbec94ac97b46733f0a1adbff3ae556d9f507a))
* **mcp:** portable web-standard HTTP handler over the shared tools ([68b321e](https://github.com/XBlueSky/cc-marketspec/commit/68b321e3998b971c7c2f2f7e38d8c196809b8547))
* reflect coverage rule set from entry schema markers ([2f7ad6e](https://github.com/XBlueSky/cc-marketspec/commit/2f7ad6efd0904d9c568d4c2c5c5fe9525963c802))
* **worker:** Cloudflare Worker entry + wrangler config for hosted MCP ([b761dff](https://github.com/XBlueSky/cc-marketspec/commit/b761dff07a53d7ad2091e092bb6f83c595dfe1db))

## [0.1.1](https://github.com/XBlueSky/cc-marketspec/compare/v0.1.0...v0.1.1) (2026-06-24)


### Bug Fixes

* **ci:** provide NODE_AUTH_TOKEN so npm auth resolves in release job ([724e7c8](https://github.com/XBlueSky/cc-marketspec/commit/724e7c8a2e2b5e76b603960fd60c75edf0d11b55))
* publish under [@xbluesky](https://github.com/xbluesky) scope ([8366bf2](https://github.com/XBlueSky/cc-marketspec/commit/8366bf2553e387cdbb99484f4a5078771308f7e0))
