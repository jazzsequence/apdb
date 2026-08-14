import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/** One show, as the same JSON record found in /api/shows.json. */
export async function getStaticPaths() {
  const db = await getDb();
  return db.shows.map((show) => ({ params: { id: show.id }, props: { show } }));
}

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.show), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
