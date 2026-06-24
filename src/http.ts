// Portable, web-standard HTTP transport for the cc-marketspec MCP tools.
// One handler: fetch(Request) -> Response. Runs on Cloudflare Workers, Deno,
// Bun, and Node 18+. Reuses the same tools as the stdio server via
// createMcpServer(); stateless (no session) with JSON responses (no SSE), and
// fully-open CORS by design (read-only, no secrets, content-as-params).
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './mcp.ts';

const CORS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version, last-event-id',
	'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version'
};

// The SDK builds its own Response; re-emit it with CORS headers merged in.
function withCors(res: Response): Response {
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function handleHttpRequest(req: Request): Promise<Response> {
	if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
	// Stateless JSON-only mode: SSE streams (GET) are not supported.
	if (req.method === 'GET') {
		return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'SSE not supported in stateless mode' }, id: null }), {
			status: 405,
			headers: { 'Content-Type': 'application/json', ...CORS }
		});
	}
	try {
		// Fresh server + transport per request: the SDK's stateless pattern. No
		// session, no cross-request state, fully horizontally scalable.
		const server = createMcpServer();
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true
		});
		await server.connect(transport);
		return withCors(await transport.handleRequest(req));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message }, id: null }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...CORS }
		});
	}
}
