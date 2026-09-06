// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output only. The data layer (src/lib) is deliberately framework-agnostic:
// it is plain TypeScript + Zod + YAML with no Astro imports, so the entire
// data + validation core survives a move to Next.js or anything else.

/**
 * An entity page's real freshness signal is the last commit to the data file
 * it's rendered from, not the build timestamp — every page would otherwise
 * report "modified" on every deploy regardless of whether its own data
 * changed, which is worse than no lastmod at all for a crawler deciding what
 * to re-fetch. Requires a non-shallow checkout (see .github/workflows/deploy.yml).
 */
const gitLastModCache = new Map();
function gitLastMod(relPath) {
  if (gitLastModCache.has(relPath)) return gitLastModCache.get(relPath);
  let result;
  try {
    result = execSync(`git log -1 --format=%cI -- "${relPath}"`).toString().trim() || undefined;
  } catch {
    result = undefined;
  }
  gitLastModCache.set(relPath, result);
  return result;
}

/** Map a route to the data file it's generated from, where one exists. */
function lastmodFor(pathname) {
  const show = pathname.match(/^\/shows\/([^/]+)\//);
  if (show) return gitLastMod(`data/shows/${show[1]}.yml`);
  const person = pathname.match(/^\/people\/([^/]+)\//);
  if (person) return gitLastMod(`data/people/${person[1]}.yml`);
  const channel = pathname.match(/^\/channels\/([^/]+)\//);
  if (channel) return gitLastMod(`data/channels/${channel[1]}.yml`);
  // Index/listing pages (/, /shows/, /about/, etc.) have no single backing
  // file — leaving lastmod unset here is more honest than a build timestamp.
  return undefined;
}

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
      serialize(item) {
        const lastmod = lastmodFor(new URL(item.url).pathname);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
});
