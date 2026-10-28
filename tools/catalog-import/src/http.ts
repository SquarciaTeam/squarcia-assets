export const USER_AGENT = "squarcia-assets-import (+https://github.com/SquarciaTeam/squarcia-assets)";

/** GET JSON con retry e backoff; restituisce null sul 404. */
export async function fetchJson<T>(url: string, retries = 3): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt));
    }
  }
  throw lastError;
}

/** Esegue `task` su ogni elemento con al massimo `concurrency` operazioni in parallelo. */
export async function mapLimit<T, R>(items: readonly T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
