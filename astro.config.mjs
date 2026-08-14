// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output only. The data layer (src/lib) is deliberately framework-agnostic:
// it is plain TypeScript + Zod + YAML with no Astro imports, so the entire
// data + validation core survives a move to Next.js or anything else.
export default defineConfig({
  // Served from a custom domain on GitHub Pages, so the base is the root
  // rather than a /repo-name/ prefix.
  site: 'https://actualplaydb.com',
  base: '/',
  output: 'static',
  build: {
    format: 'directory',
  },
  // Every person/show/season page is only reachable by following links from
  // an index — a crawler with no interest in browsing has no way to
  // discover them all short of this. Excludes the /api/*.json endpoints and
  // per-entity .json mirrors: they're data, not pages, and are already
  // linked from /api/index.json.
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/api/') && !page.endsWith('.json'),
    }),
  ],
});
