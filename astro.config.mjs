// @ts-check
import { defineConfig } from 'astro/config';

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
});
