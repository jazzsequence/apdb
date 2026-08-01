#!/usr/bin/env tsx
/**
 * Backfill images for anything that has none.
 *
 * Imports call this automatically; this entry point exists for re-running the
 * pass over data that predates that, or after a licence check changes.
 *
 *   npm run fetch:images
 */
import { fetchOtherSeriesArt, fetchPortraits, fetchSeriesArt } from '../src/lib/images.js';

const yt = await fetchSeriesArt();
console.log(`${yt} series image(s) from YouTube thumbnails (fair use).`);

const other = await fetchOtherSeriesArt();
console.log(`${other} series image(s) from wikis and podcast feeds (fair use).`);

const portraits = await fetchPortraits();
console.log(`${portraits} portrait(s) from Commons and Openverse (free licences only).`);
