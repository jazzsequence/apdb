#!/usr/bin/env tsx
/**
 * Backfill images for anything that has none.
 *
 * Imports call this automatically; this entry point exists for re-running the
 * pass over data that predates that, or after a licence check changes.
 *
 *   npm run fetch:images
 */
import {
  fetchArchiveArt,
  fetchOtherSeriesArt,
  fetchPortraits,
  fetchSeriesArt,
  fetchWikiPortraits,
} from '../src/lib/images.js';

// One source failing must not cost the others their turn.
async function pass(what: string, fetch: () => Promise<number>): Promise<void> {
  try {
    console.log(`${await fetch()} ${what}.`);
  } catch (error) {
    console.error(`Failed before finishing ${what}: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

await pass('series image(s) from YouTube thumbnails (fair use)', fetchSeriesArt);
await pass('series image(s) from wikis and podcast feeds (fair use)', fetchOtherSeriesArt);
await pass('cover image(s) from the Internet Archive', fetchArchiveArt);
await pass('portrait(s) from Commons (free licences only)', fetchPortraits);
// Free licences are tried first above; the wikis cover the indie long tail
// that Wikidata does not, under the fair-use claim in POLICY.md.
await pass('portrait(s) from fan wikis (fair use)', fetchWikiPortraits);
