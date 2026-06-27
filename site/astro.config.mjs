import { defineConfig } from 'astro/config';

// Static output (zero JS by default). The site reads the repo's manifest.json
// at build time and prerenders to dist/.
export default defineConfig({
	output: 'static'
});
