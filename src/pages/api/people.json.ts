import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/**
 * The whole People collection as JSON — the same validated data the site
 * renders from, one fetch instead of 838 HTML pages. See /api/index.json for
 * the full set of endpoints and /llms.txt for how this data is licensed and
 * how to file a correction.
 */
export const GET: APIRoute = async () => {
  const db = await getDb();
  return new Response(JSON.stringify(db.people), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
