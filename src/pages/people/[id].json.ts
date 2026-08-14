import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

/** One person, as the same JSON record found in /api/people.json. */
export async function getStaticPaths() {
  const db = await getDb();
  return db.people.map((person) => ({ params: { id: person.id }, props: { person } }));
}

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify(props.person), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
