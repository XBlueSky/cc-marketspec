import { defineConfig } from 'astro/config';

// Static output (zero JS by default). The site reads the repo's manifest.json
// at build time and prerenders to dist/.
export default defineConfig({
	output: 'static',
	build: {
		// Inline all stylesheets so the HTML is self-contained (font data-URIs
		// and palette tokens appear directly in index.html, making build tests
		// straightforward).
		inlineStylesheets: 'always',
	},
});
