import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleHttpRequest } from '../src/http.ts';

const POST_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json, text/event-stream'
};
function rpc(method: string, params: unknown = {}, id: number | string = 1): Request {
	return new Request('https://mcp.test/', {
		method: 'POST',
		headers: POST_HEADERS,
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
	});
}
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } };

test('OPTIONS preflight returns 204 with permissive CORS', async () => {
	const res = await handleHttpRequest(new Request('https://mcp.test/', { method: 'OPTIONS' }));
	assert.equal(res.status, 204);
	assert.equal(res.headers.get('access-control-allow-origin'), '*');
	assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
});

test('initialize returns 200 JSON with cc-marketspec server info and CORS', async () => {
	const res = await handleHttpRequest(rpc('initialize', INIT));
	assert.equal(res.status, 200);
	assert.match(res.headers.get('content-type') ?? '', /application\/json/);
	assert.equal(res.headers.get('access-control-allow-origin'), '*');
	const body = await res.json() as { result: { serverInfo: { name: string }; protocolVersion: string } };
	assert.equal(body.result.serverInfo.name, 'cc-marketspec');
	assert.ok(body.result.protocolVersion);
});

test('tools/list returns exactly the four tools', async () => {
	const res = await handleHttpRequest(rpc('tools/list'));
	assert.equal(res.status, 200);
	const body = await res.json() as { result: { tools: { name: string }[] } };
	const names = body.result.tools.map((t: { name: string }) => t.name).sort();
	assert.deepEqual(names, ['check_coverage', 'explain_field', 'get_schema', 'scaffold_entry']);
});

test('tools/call get_schema returns the entry schema as JSON text', async () => {
	const res = await handleHttpRequest(rpc('tools/call', { name: 'get_schema', arguments: { which: 'entry' } }));
	assert.equal(res.status, 200);
	const body = await res.json() as { result: { content: { type: string; text: string }[] } };
	const schema = JSON.parse(body.result.content[0].text) as { properties?: object };
	assert.ok(schema.properties);
});

test('a malformed JSON body yields a JSON-RPC error, not a thrown crash', async () => {
	const res = await handleHttpRequest(new Request('https://mcp.test/', { method: 'POST', headers: POST_HEADERS, body: '{not json' }));
	assert.ok(res.status >= 400);
	assert.equal(res.headers.get('access-control-allow-origin'), '*');
	const body = await res.json() as { error?: unknown };
	assert.ok(body.error);
});

test('GET (no SSE stream in stateless mode) is rejected cleanly with CORS', async () => {
	const res = await handleHttpRequest(new Request('https://mcp.test/', { method: 'GET', headers: { Accept: 'text/event-stream' } }));
	assert.ok(res.status >= 400);
	assert.equal(res.headers.get('access-control-allow-origin'), '*');
});
