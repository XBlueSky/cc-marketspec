// Single boundary to the core package. Everything the MCP server needs from
// @xbluesky/cc-marketspec flows through the core's PUBLIC index, imported
// relatively and bundled at build time: npm has no workspace: protocol, so a
// dependency on the published name would silently shadow the local workspace
// with the last released version (verified empirically).
export * from '../../../src/index.ts';
