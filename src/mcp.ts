// MCP server for cc-marketspec. Tool handlers are plain functions (transport-free,
// unit-testable). Repo-aware tools take file CONTENT (a path→content map) so the
// same handlers serve local stdio and a future hosted HTTP transport.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import yaml from 'js-yaml';
import { MemoryFileSource } from './fs-source.ts';
import { extractNativeFacts } from './native.ts';
import { analyzeCoverage, type CoverageReport } from './coverage.ts';
import { AUTHORING } from './authoring.generated.ts';
import { SCHEMAS, VERSION } from './schemas.generated.ts';

export function getSchema(which: keyof typeof SCHEMAS): object {
	return SCHEMAS[which];
}

export function listAuthoringSections(): { id: string; title: string; when: string }[] {
	return AUTHORING.map(({ id, title, when }) => ({ id, title, when }));
}

export function getAuthoringGuide(section: string): { section: string; title?: string; body?: string; error?: string; available?: string[] } {
	const found = AUTHORING.find((s) => s.id === section);
	if (!found) return { section, error: `unknown section "${section}"`, available: AUTHORING.map((s) => s.id) };
	return { section, title: found.title, body: found.body };
}

export function checkCoverage(args: { files: Record<string, string>; pluginId: string }): CoverageReport {
	const source = new MemoryFileSource(args.files);
	const facts = extractNativeFacts(source, `plugins/${args.pluginId}`);
	// entry.yaml content, if pasted, is parsed separately and passed as the entry overlay
	const entryRaw = args.files[`plugins/${args.pluginId}/entry.yaml`];
	const entry = entryRaw ? (yaml.load(entryRaw) as never) : null;
	return analyzeCoverage(facts, entry, {}, args.pluginId);
}

export function scaffoldEntry(args: { files: Record<string, string>; pluginId: string }): string {
	const source = new MemoryFileSource(args.files);
	const facts = extractNativeFacts(source, `plugins/${args.pluginId}`);
	const lines = [`# entry.yaml skeleton for ${args.pluginId} (generated)`];
	if (!facts.plugin.description) lines.push('# tagline: TODO');
	for (const s of facts.skills) lines.push(`# skill ${s.name}: add trigger/examples`);
	for (const m of facts.mcp) for (const k of m.envKeys) lines.push(`# mcp ${m.name} env ${k}: describe`);
	return lines.join('\n') + '\n';
}

// Transport-free tool dispatch shared by the stdio server (and any future HTTP
// transport). Any thrown error from a handler — e.g. malformed pasted entry.yaml
// in check_coverage — is caught and returned as a structured { error } payload so
// the tool never crashes the connection (spec §5.2). Returns an MCP tool result.
export function callTool(name: string, args: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
	const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
	try {
		switch (name) {
			case 'get_schema':
				return text(getSchema(args.which as keyof typeof SCHEMAS));
			case 'list_authoring_sections':
				return text(listAuthoringSections());
			case 'get_authoring_guide':
				return text(getAuthoringGuide(args.section as string));
			case 'check_coverage':
				return text(checkCoverage(args as { files: Record<string, string>; pluginId: string }));
			case 'scaffold_entry':
				return text(scaffoldEntry(args as { files: Record<string, string>; pluginId: string }));
			default:
				return text({ error: `unknown tool ${name}` });
		}
	} catch (e) {
		return text({ error: e instanceof Error ? e.message : String(e) });
	}
}

export const TOOLS = [
	{ name: 'get_schema', description: 'Return entry/catalog/manifest JSON schema', inputSchema: { type: 'object', properties: { which: { type: 'string', enum: ['entry', 'catalog', 'manifest'] } }, required: ['which'] } },
	{ name: 'list_authoring_sections', description: 'List entry.yaml authoring guide sections (id/title/when). Call this first, then get_authoring_guide for the section you need.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'get_authoring_guide', description: 'Return the full authoring guide markdown for one section id (from list_authoring_sections).', inputSchema: { type: 'object', properties: { section: { type: 'string' } }, required: ['section'] } },
	{ name: 'check_coverage', description: 'Report missing presentation metadata for a plugin (paste file contents)', inputSchema: { type: 'object', properties: { pluginId: { type: 'string' }, files: { type: 'object' } }, required: ['pluginId', 'files'] } },
	{ name: 'scaffold_entry', description: 'Produce an entry.yaml skeleton from native files (paste contents)', inputSchema: { type: 'object', properties: { pluginId: { type: 'string' }, files: { type: 'object' } }, required: ['pluginId', 'files'] } }
];

/** Build the MCP server with the shared tool table. Transport-agnostic — the
 *  stdio entry and the HTTP handler both call this so the tool set never drifts. */
export function createMcpServer(): Server {
	const server = new Server({ name: 'cc-marketspec', version: VERSION }, { capabilities: { tools: {} } });
	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
	server.setRequestHandler(CallToolRequestSchema, (req) => callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
	return server;
}

export async function startMcpServer(): Promise<void> {
	await createMcpServer().connect(new StdioServerTransport());
}
