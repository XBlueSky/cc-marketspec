// Public API of @xbluesky/cc-marketspec-mcp: the portable HTTP handler plus
// the transport-free server pieces, for anyone deploying their own instance.
export { handleHttpRequest } from './http.ts';
export {
	TOOLS,
	callTool,
	checkCoverage,
	createMcpServer,
	getAuthoringGuide,
	getSchema,
	listAuthoringSections,
	listResources,
	readResource,
	scaffoldEntry,
	startMcpServer
} from './mcp.ts';
