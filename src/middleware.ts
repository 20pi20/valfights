import { defineMiddleware } from 'astro:middleware';
import { refresh } from './lib/data';

// Pull the latest Notion data before rendering, so edits show up without a redeploy.
export const onRequest = defineMiddleware(async (_context, next) => {
  await refresh();
  return next();
});
