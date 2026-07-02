# [0.10.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.9.0...v0.10.0) (2026-07-02)


### Bug Fixes

* **lint:** declare Node globals for .mjs scripts ([5997699](https://github.com/XBlueSky/cc-marketspec/commit/599769959d42d2fceed0014c3f3ec047f47fd46a))
* **site:** derived item wording 'env-var keys' to match README exactly ([da65203](https://github.com/XBlueSky/cc-marketspec/commit/da65203d633af9ab96a357aef7faa3e658b73a0a))
* **site:** eliminate remaining mobile horizontal overflow (min-width:0 on Pipeline/MentalModel/QuickStart grid items) ([649e276](https://github.com/XBlueSky/cc-marketspec/commit/649e276668148741970367d4069517792614dfb8))
* **site:** heading weight matches shipped Fraunces face (700); fix mobile horizontal overflow (min-width:0 on hero grid items) ([877fe13](https://github.com/XBlueSky/cc-marketspec/commit/877fe1357f1717a26cc0488fbb45bfb94ea3be89))
* **site:** hero uses real full entry.yaml text; syntax colors promoted to global tokens ([a1648cd](https://github.com/XBlueSky/cc-marketspec/commit/a1648cd049d3a32fe3fcdde2787b02aa36c9316d))
* **site:** mark plugin.json truncation in mental-model panel (consistency with .mcp.json) ([ab37c5b](https://github.com/XBlueSky/cc-marketspec/commit/ab37c5ba4b9e0c73cba3611932f145acac67bebc))
* **site:** mark truncations in mental-model snippets (.mcp.json url, manifest plugin fields) ([b37e9ab](https://github.com/XBlueSky/cc-marketspec/commit/b37e9ab15d3af9b822b0740febdda1e296727c0f))
* **site:** mental-model native filenames match README exactly (add agents/*.md, qualify paths) ([1f8ac86](https://github.com/XBlueSky/cc-marketspec/commit/1f8ac86e7956d1155b1fda0cbca875c7d0c5afd6))
* **site:** reposition hero ambient bg to section lower-right bleed (not the awkward inter-card gap) ([b3ebed2](https://github.com/XBlueSky/cc-marketspec/commit/b3ebed27ef68371c18aeee4eac0686d6ecfce387))
* **site:** reveal-on-scroll degrades gracefully without JS (js-ready gating) ([545285f](https://github.com/XBlueSky/cc-marketspec/commit/545285fd1de3d46a96a99b7bf89cd841c8c238c3))
* **site:** WCAG AA contrast — deep clay (--accent-ink) for text/buttons/chips/syntax; bright clay kept for decoration ([e60513b](https://github.com/XBlueSky/cc-marketspec/commit/e60513bff51cc2813014a95f23f15005c6b95e21))
* **site:** wrap long code/YAML lines instead of horizontal-scrolling (removes ugly scrollbars) ([4203d2b](https://github.com/XBlueSky/cc-marketspec/commit/4203d2b26dcfa44bc8158a599a937bef0ad25eb0))


### Features

* **site:** denser hero — larger headline, in/out contrast line, real 2nd tip, clay connecting flow ([fb94229](https://github.com/XBlueSky/cc-marketspec/commit/fb942292411a8181d8d8f2b14f62de7a3ee3cbde))
* **site:** derived-fields section — what the generator derives ([ddecb79](https://github.com/XBlueSky/cc-marketspec/commit/ddecb79e0a269be7af1ec48b3d27b08b6905b243))
* **site:** dogfood showcase — real manifest rendered, sub-components re-skinned ([15aefe9](https://github.com/XBlueSky/cc-marketspec/commit/15aefe99bc6014c587a5345b62fa4a35766b1c50))
* **site:** hero — YAML→marketplace split, 'Ship data, not design.' ([efca56b](https://github.com/XBlueSky/cc-marketspec/commit/efca56b9ddd175d242ba06b4624d619afbcc3325))
* **site:** light-ground Paper & Clay foundation — tokens, inlined fonts, primitives ([78687b8](https://github.com/XBlueSky/cc-marketspec/commit/78687b843d8708aa7bdd691d09447a13aa04dbf6))
* **site:** live hero — YAML reveals line-by-line then card generates (reduced-motion + no-JS safe) ([d2e61db](https://github.com/XBlueSky/cc-marketspec/commit/d2e61db5539b4a3539e0f623ace58e7a0db19345))
* **site:** mental-model section — native vs presentation two-layer diagram ([6cbcd69](https://github.com/XBlueSky/cc-marketspec/commit/6cbcd697e65919abcf9ac405eee7361ba57e633b))
* **site:** mental-model shows real native→manifest code contrast (plugin.json/.mcp.json/entry.yaml) ([09aea0a](https://github.com/XBlueSky/cc-marketspec/commit/09aea0ac15dd3ba7edafa439fa546adbdf5d5f0b))
* **site:** new author-vs-derived comparison table — the 'write little, get much' proof ([ab109a5](https://github.com/XBlueSky/cc-marketspec/commit/ab109a540a7631b2b8c5bca4cca391ef51527722))
* **site:** page-wide staggered entrance choreography (house curve, --i stagger, reduced-motion safe) ([9969e9b](https://github.com/XBlueSky/cc-marketspec/commit/9969e9b06214de719e06565dfa91884f449bd80b))
* **site:** pipeline section — describe → generate → manifest flow ([3e2e9b7](https://github.com/XBlueSky/cc-marketspec/commit/3e2e9b7d6b912ae758f57f71a89e3f7bd83bd05b))
* **site:** pipeline shows real complete snippets (catalog.yaml, CLI output, manifest shape) ([b2cddb0](https://github.com/XBlueSky/cc-marketspec/commit/b2cddb013692c8245bab456a7d9b3c13d79fe24e))
* **site:** quick-start + footer + scroll-reveal script ([006a5dd](https://github.com/XBlueSky/cc-marketspec/commit/006a5dd27d1147809078c73f3bf3b9b220bb6e5e))
* **site:** section numbering 02–07 for rhythm; denser showcase card (resource counts, all mcp tools) ([b43e66f](https://github.com/XBlueSky/cc-marketspec/commit/b43e66fa2f356a7da4f9a17a84124e23e811debf))
* **site:** subtle ambient decoration (hero bg, section divider, OG image) — quiet the text-dense page ([ed25809](https://github.com/XBlueSky/cc-marketspec/commit/ed25809597a58d10ab063ffeef7de38955ba4d1d))
* **site:** v2 visual foundation — section numbers, hairlines, bg texture, on-accent token, hero scale ([b6f3682](https://github.com/XBlueSky/cc-marketspec/commit/b6f36824b1f9abf7859d4afdf03113169453c03d))
* **site:** v3 display face → Fraunces (drop Newsreader + unused bricolage dep) ([11c9aff](https://github.com/XBlueSky/cc-marketspec/commit/11c9affe05d2e010e0c00a3f11d2d7d88f5521f4))

# [0.9.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.8.0...v0.9.0) (2026-06-27)


### Bug Fixes

* **site:** pin public npm registry so the lockfile isn't poisoned by a private mirror ([8e57b0e](https://github.com/XBlueSky/cc-marketspec/commit/8e57b0e71ea5dc1785688293716fc994a855ef50))


### Features

* **site:** Astro skeleton with regenerate-manifest build pipeline ([751cef6](https://github.com/XBlueSky/cc-marketspec/commit/751cef61a15aec0cb0b40b91b291d42fe71b7be1))
* **site:** ComponentList renders skills/commands/agents/mcp from manifest ([aa3f960](https://github.com/XBlueSky/cc-marketspec/commit/aa3f9603e8251303218fd4b37c3261727aee5d44))
* **site:** Layout and PluginCard render plugin meta from manifest ([c1d4b61](https://github.com/XBlueSky/cc-marketspec/commit/c1d4b6195d0a2b61a6ce14a2281fe42211d7742a))
* **site:** TipsTraps renders string and object-form notes from manifest ([f0e7e4e](https://github.com/XBlueSky/cc-marketspec/commit/f0e7e4e395984a651dc0c8e590e0e69344bdd94e))

# [0.8.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.7.0...v0.8.0) (2026-06-26)


### Bug Fixes

* **coverage:** agent.summary hint must say "description:", the real entry.yaml key ([231a173](https://github.com/XBlueSky/cc-marketspec/commit/231a173c6f5f6877d40ccb6438d91db6e4db7e59))


### Features

* **coverage:** findings carry entry.yaml path and how-to-fix hint ([cf42be5](https://github.com/XBlueSky/cc-marketspec/commit/cf42be56b39333a9f51dd8711db825627c3596d4))

# [0.7.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.6.0...v0.7.0) (2026-06-26)


### Features

* **build:** inline authoring guide for MCP + copy to skill references ([70a69d7](https://github.com/XBlueSky/cc-marketspec/commit/70a69d7c19df9536db164575bb13c7435f1e5567))
* **docs:** canonical entry.yaml authoring guide + section parser ([76c5a00](https://github.com/XBlueSky/cc-marketspec/commit/76c5a00f07a2a41caa274272088c4a37d3656ff4))
* **init:** richer entry.yaml stub; dogfood traps + object-form tip ([5d3a0df](https://github.com/XBlueSky/cc-marketspec/commit/5d3a0dfd444d73a518f6e91dc3040f52084e6b6f))
* **mcp:** check_coverage returns needsMoreWork to drive the fix loop ([bb969ff](https://github.com/XBlueSky/cc-marketspec/commit/bb969ff9b589232836f15b4afa63d90866b2607d))
* **mcp:** expose entry/catalog/manifest schemas as MCP resources ([ebe9c36](https://github.com/XBlueSky/cc-marketspec/commit/ebe9c360a9570c0c5f505084d2d3a4504c0cd706))
* **mcp:** replace explain_field with two-stage authoring guide tools ([1704629](https://github.com/XBlueSky/cc-marketspec/commit/170462934f6de14fdc4b4686550bd6a2beec16ea))

# [0.6.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.5.2...v0.6.0) (2026-06-26)


### Bug Fixes

* **check:** align dependencies shape with manifest; actionable union messages ([ac74a32](https://github.com/XBlueSky/cc-marketspec/commit/ac74a325ba594e588f61d6cffa36a0c882a61949))


### Features

* add plugin.json shape schema (PluginJson) ([f005dbc](https://github.com/XBlueSky/cc-marketspec/commit/f005dbcbe241cd6cf420610a8429247d5aabea57))
* **check:** validate plugin.json field shapes; reject string author ([f635731](https://github.com/XBlueSky/cc-marketspec/commit/f635731427d175165d64f7a89fbd329ce787a914))

## [0.5.2](https://github.com/XBlueSky/cc-marketspec/compare/v0.5.1...v0.5.2) (2026-06-26)


### Bug Fixes

* drop Discussions contact link (not enabled on the repo) ([46662fb](https://github.com/XBlueSky/cc-marketspec/commit/46662fb45614c33f8b0ff83922ecbad0b8641c9c))

## [0.5.1](https://github.com/XBlueSky/cc-marketspec/compare/v0.5.0...v0.5.1) (2026-06-26)


### Bug Fixes

* **plugin:** author must be an object, not a string ([a1f6120](https://github.com/XBlueSky/cc-marketspec/commit/a1f61202501b77d604ed0059c535bbc3eb5d2b84))

# [0.5.0](https://github.com/XBlueSky/cc-marketspec/compare/v0.4.1...v0.5.0) (2026-06-26)


### Bug Fixes

* **skill:** anchor asset paths with ${CLAUDE_SKILL_DIR} ([47b1fcd](https://github.com/XBlueSky/cc-marketspec/commit/47b1fcd918f43cbfcdc41494cc40927ad666d188))
* **skill:** Step 0 bootstraps marketplace.json from a starter template ([db79ec9](https://github.com/XBlueSky/cc-marketspec/commit/db79ec9208e46bb0f29d0c167b7e92392ca21248))
* **skill:** Step 2 points downstream $schema at the published path ([68be240](https://github.com/XBlueSky/cc-marketspec/commit/68be240b62ecba96140675acf9343632d83bd463))


### Features

* **plugin:** add bundled README + LICENSE, bump plugin to 0.2.0 ([b87d0a3](https://github.com/XBlueSky/cc-marketspec/commit/b87d0a3db68aa393b3b185b49da88369c22e8a1b))

## [0.4.1](https://github.com/XBlueSky/cc-marketspec/compare/v0.4.0...v0.4.1) (2026-06-26)


### Bug Fixes

* **ci:** build from source in manifest workflow, not npx ([4a81837](https://github.com/XBlueSky/cc-marketspec/commit/4a818377e26d7bc2b6257fef0f8554dfd8bfd9be))

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
