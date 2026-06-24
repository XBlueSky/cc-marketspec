// MCP server for cc-marketspec. Tool handlers are plain functions (transport-free,
// unit-testable). Repo-aware tools take file CONTENT (a path→content map) so the
// same handlers serve local stdio and a future hosted HTTP transport.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import yaml from 'js-yaml';
import { MemoryFileSource } from './fs-source.ts';
import { extractNativeFacts } from './native.ts';
import { analyzeCoverage, type CoverageReport } from './coverage.ts';
import { describeField } from './entry.ts';

const SCHEMA_FILES = {
	entry: 'entry.schema.json',
	catalog: 'catalog.schema.json',
	manifest: 'manifest.schema.json'
} as const;

export function getSchema(which: keyof typeof SCHEMA_FILES): object {
	const p = fileURLToPath(new URL(`../schemas/${SCHEMA_FILES[which]}`, import.meta.url));
	return JSON.parse(readFileSync(p, 'utf8'));
}

export function explainField(path: string): { path: string; description?: string } {
	// path is "<component>.<field>" — e.g. skill.trigger, mcp.env, plugin.tagline.
	// Resolve the field's authored .describe() text from the live Entry schema via
	// describeField (single-sourced with the coverage schema-walk in entry.ts).
	// Unknown / malformed paths return description: undefined (never throw).
	const dot = path.indexOf('.');
	if (dot <= 0 || dot === path.length - 1) return { path, description: undefined };
	const component = path.slice(0, dot);
	const field = path.slice(dot + 1);
	return { path, description: describeField(component, field) };
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
				return text(getSchema(args.which as keyof typeof SCHEMA_FILES));
			case 'explain_field':
				return text(explainField(args.path as string));
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

export async function startMcpServer(): Promise<void> {
	const server = new Server({ name: 'cc-marketspec', version: '0.1.1' }, { capabilities: { tools: {} } });
	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: [
			{ name: 'get_schema', description: 'Return entry/catalog/manifest JSON schema', inputSchema: { type: 'object', properties: { which: { type: 'string', enum: ['entry', 'catalog', 'manifest'] } }, required: ['which'] } },
			{ name: 'explain_field', description: 'Explain an entry field by <component>.<field> path', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
			{ name: 'check_coverage', description: 'Report missing presentation metadata for a plugin (paste file contents)', inputSchema: { type: 'object', properties: { pluginId: { type: 'string' }, files: { type: 'object' } }, required: ['pluginId', 'files'] } },
			{ name: 'scaffold_entry', description: 'Produce an entry.yaml skeleton from native files (paste contents)', inputSchema: { type: 'object', properties: { pluginId: { type: 'string' }, files: { type: 'object' } }, required: ['pluginId', 'files'] } }
		]
	}));
	server.setRequestHandler(CallToolRequestSchema, (req) => callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
	await server.connect(new StdioServerTransport());
}
