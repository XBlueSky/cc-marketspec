# [0.4.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.3.0...v0.4.0) (2026-06-26)


### Bug Fixes

* **skill:** add fetch-depth:0 to GitHub template, timeout to GitLab template ([dd27f8b](https://github.com/XBlueSky/cc-marketspec/commit/dd27f8b7d947f5668c65f15cca99944f1dbefee7))
* **skill:** add generate step, align step numbering, use /cc-check in detection ([d0bef60](https://github.com/XBlueSky/cc-marketspec/commit/d0bef6041588d9bc3b3b74cf4c49ecc5cd114576))
* **skill:** dogfooding fixes — warnings don't block, skill trigger guidance ([f12693d](https://github.com/XBlueSky/cc-marketspec/commit/f12693d2aab985ac488ef1cf0770807993a86b42))
* **skill:** use git-diff (not mtime) for staleness, fix Step 2 wording, add GitHub branch-protection note ([0253f3e](https://github.com/XBlueSky/cc-marketspec/commit/0253f3edd05c27e6de7760ae27432dea1025c1c8))


### Features

* **skill:** add GitHub/GitLab manifest CI workflow templates ([2333664](https://github.com/XBlueSky/cc-marketspec/commit/2333664b335b880372b328e3b4c3a68c433543fa))
* **skill:** add marketplace-flow navigation skill ([cf6d197](https://github.com/XBlueSky/cc-marketspec/commit/cf6d197edcb04922959539d121102bd851c05bcb))

# [0.3.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.2.1...v0.3.0) (2026-06-25)


### Features

* **marketplace:** add plugin entry.yaml and generate dogfooded manifest ([e297299](https://github.com/XBlueSky/cc-marketspec/commit/e297299ba18066a88ac87f93c407151502fc2baa))
* **marketplace:** make the repo a marketplace with a tools catalog ([2a8ea69](https://github.com/XBlueSky/cc-marketspec/commit/2a8ea69956e5a914a763128e1f133c3fb4249872))
* **plugin:** add cc-marketspec plugin manifest, MCP wiring, and commands ([6156f9d](https://github.com/XBlueSky/cc-marketspec/commit/6156f9de6f389a37e40973ed9060b580a671c85e))

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
