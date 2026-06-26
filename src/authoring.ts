// Parse the canonical authoring guide (src/authoring.md) into sections. Each
// section starts with an HTML marker comment:
//   <!-- section: <id> | when: <one-line use-case> -->
// followed by a "## <title>" line; the body runs to the next marker or EOF.
// Single source of truth for both the build-inlined MCP data and the skill
// reference copy.

export interface AuthoringSection {
	id: string;
	title: string;
	when: string;
	body: string;
}

const MARKER = /^<!--\s*section:\s*([a-zA-Z0-9-]+)\s*\|\s*when:\s*(.+?)\s*-->\s*$/;

export function parseAuthoring(md: string): AuthoringSection[] {
	const lines = md.split('\n');
	const sections: AuthoringSection[] = [];
	let cur: { id: string; when: string; title: string; body: string[] } | null = null;
	for (const line of lines) {
		const m = line.match(MARKER);
		if (m) {
			if (cur) sections.push({ id: cur.id, title: cur.title, when: cur.when, body: cur.body.join('\n').trim() });
			cur = { id: m[1], when: m[2], title: '', body: [] };
			continue;
		}
		if (!cur) continue;
		if (!cur.title && line.startsWith('## ')) {
			cur.title = line.slice(3).trim();
			continue;
		}
		cur.body.push(line);
	}
	if (cur) sections.push({ id: cur.id, title: cur.title, when: cur.when, body: cur.body.join('\n').trim() });
	return sections;
}
