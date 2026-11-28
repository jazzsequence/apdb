/**
 * fetch that waits out throttling.
 *
 * A sweep makes hundreds of calls to shared APIs. Treating the first 429 as a
 * failed lookup cost one weekly run 158 of its 189 people.
 */
export async function politeFetch(url: string, init?: RequestInit, attempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init);
    if ((response.status !== 429 && response.status !== 503) || attempt >= attempts) return response;
    const asked = Number(response.headers.get('retry-after'));
    const seconds = Number.isFinite(asked) && asked > 0 ? asked : 5 * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, Math.min(seconds, 60) * 1000));
  }
}
