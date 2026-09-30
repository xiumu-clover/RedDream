// @ts-check
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	integrations: [mdx()],
	vite: {
		server: {
			// Long-running Windows background processes can miss native file-system events.
			// Polling keeps chapter Markdown hot reload reliable after sleep/resume as well.
			watch: {
				usePolling: true,
				interval: 500,
			},
		},
	},
});
