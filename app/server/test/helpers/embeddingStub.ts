/**
 * A stand-in for OpenRouter's embeddings endpoint, for tests whose fetch stub
 * only knows chat completions.
 *
 * Every pipeline run now asks for embeddings (the coverage gates), and a stub
 * that answered those requests with a chat reply would fail the gate — which
 * is the correct behaviour in production, where a gate that cannot look must
 * not pass. So tests answer them properly instead: a deterministic
 * bag-of-words vector, in which texts sharing words sit close together and
 * unrelated texts do not. Close enough to meaning for a test to reason about.
 */

const DIMENSIONS = 256;

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) vector[hash(word) % DIMENSIONS] += 1;
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / length);
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request)?.url ?? '';
}

/** Wraps a fetch stub so embedding requests are answered and everything else reaches the stub untouched. */
export function withEmbeddings(stub: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (!urlOf(input).endsWith('/embeddings')) return stub(input, init);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const inputs: string[] = Array.isArray(body.input) ? body.input : [String(body.input ?? '')];
    return new Response(
      JSON.stringify({
        data: inputs.map((text, index) => ({ index, embedding: fakeEmbedding(text) })),
        usage: { prompt_tokens: inputs.join(' ').split(/\s+/).length, cost: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}
