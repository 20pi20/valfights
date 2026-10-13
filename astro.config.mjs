import { defineConfig, envField } from 'astro/config';
import netlify from '@astrojs/netlify';

// Pages are rendered on request so they always reflect the Notion database (see src/lib/data.ts).
export default defineConfig({
  output: 'server',
  adapter: netlify(),
  trailingSlash: 'ignore',
  // Not used here; the adapter would otherwise set up Netlify Blobs session storage.
  session: false,
  env: {
    schema: {
      NOTION_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      NOTION_DATABASE_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
