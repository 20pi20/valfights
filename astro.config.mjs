import { defineConfig } from 'astro/config';

// Fully static build: Notion is read once by scripts/fetch-notion.mjs before `astro build`.
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
});
