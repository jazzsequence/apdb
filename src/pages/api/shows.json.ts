import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/**
 * The whole Shows collection as JSON, seasons included. See /api/index.json
 * for the full set of endpoints.
 */
export const GET: APIRoute = async () => {
  const db = await getDb();
  return new Response(JSON.stringify(db.shows), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
