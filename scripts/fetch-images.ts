#!/usr/bin/env tsx
/**
 * Backfill images for anything that has none.
 *
 * Imports call this automatically; this entry point exists for re-running the
 * pass over data that predates that, or after a licence check changes.
 *
 *   npm run fetch:images
 */
import { fetchPortraits, fetchSeriesArt } from '../src/lib/images.js';

const art = await fetchSeriesArt();
console.log(`${art} series image(s) added (YouTube thumbnails, fair use).`);
const portraits = await fetchPortraits();
console.log(`${portraits} portrait(s) added (Commons, free licences only).`);
