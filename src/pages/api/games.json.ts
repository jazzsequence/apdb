import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/**
 * The whole Games collection as JSON. See /api/index.json for the full set
 * of endpoints.
 */
export const GET: APIRoute = async () => {
  const db = await getDb();
  return new Response(JSON.stringify(db.games), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
