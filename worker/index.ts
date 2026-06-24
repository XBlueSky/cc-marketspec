// Cloudflare Worker entry. The MCP HTTP handler is platform-neutral
// (fetch(Request) -> Response); this file is only the Cloudflare binding.
import { handleHttpRequest } from '../src/http.ts';

export default {
	fetch(request: Request): Promise<Response> {
		return handleHttpRequest(request);
	}
};
