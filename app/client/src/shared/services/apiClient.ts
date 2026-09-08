/** Thin fetch wrapper for the local Express API. No caching, no retries — just JSON (or multipart) in/out. */

export class ApiError extends Error {
  status: number;
  errors: string[];
  /** Stable machine-readable reason, when the endpoint provides one (the generation endpoints do). */
  code: string | null;
  /** Whether the server says repeating the identical request could succeed. Cynth never retries on its own — this only decides whether a Retry button is offered. */
  retryable: boolean;
  /**
   * The rest of the error body, for endpoints that return structure alongside
   * their message (Milestone 15).
   *
   * Model validation is the reason this exists: a refused model comes back
   * with a per-stage report, and collapsing that into an `errors` array would
   * throw away the one thing that makes the failure actionable — WHICH stage
   * failed. Anything not in `errors`, `code` or `retryable` survives here.
   */
  details: Record<string, any> | null;

  constructor(
    status: number,
    errors: string[],
    code: string | null = null,
    retryable = false,
    details: Record<string, any> | null = null,
  ) {
    const resolved = errors.length ? errors : [describeBareStatus(status)];
    super(resolved.join(' '));
    this.status = status;
    this.errors = resolved;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/**
 * What to say when a response carries no `errors` array of its own.
 *
 * The old fallback was a bare "Request failed.", which collapsed genuinely
 * different problems into one unhelpful sentence — most damagingly, a backend
 * that simply isn't running looked identical to a rejected request. Cynth is
 * two local processes, so "the server isn't up" is a routine state and the UI
 * has to name it.
 */
function describeBareStatus(status: number): string {
  if (status === 0) {
    return 'Cannot reach the Cynth server. Check that the backend is running (npm run dev in app/server), then try again.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return `The Cynth server did not respond (HTTP ${status}). It may have stopped or restarted — check that the backend is running, then try again.`;
  }
  if (status === 404) {
    return 'That endpoint does not exist on the Cynth server (HTTP 404). The client and server may be out of sync.';
  }
  if (status >= 500) {
    return `The Cynth server hit an unexpected error (HTTP ${status}). Check the server console for details.`;
  }
  return `The request was rejected (HTTP ${status}).`;
}

/** Network-level failure — status 0, because no HTTP response ever arrived. */
export const SERVER_UNREACHABLE = 'server_unreachable';

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      response.status,
      Array.isArray(data.errors) ? data.errors : [],
      typeof data.code === 'string' ? data.code : null,
      data.retryable === true,
      data && typeof data === 'object' ? (data as Record<string, any>) : null,
    );
  }

  return data as T;
}

/**
 * fetch() rejects rather than resolving when the server is unreachable — the
 * dev server down, the proxy unable to connect, the machine offline. Left
 * unhandled that surfaced as a raw TypeError, which callers could not tell
 * apart from a bug in their own code. It becomes an ApiError like any other,
 * so every caller's existing `instanceof ApiError` branch reports it properly.
 */
async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, [describeBareStatus(0)], SERVER_UNREACHABLE, true);
  }

  return handleResponse<T>(response);
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return send<T>(path, { headers: { 'Content-Type': 'application/json' }, ...options });
}

/** For multipart/form-data (file uploads) — no Content-Type header, so the browser sets the multipart boundary. */
function upload<T>(path: string, formData: FormData): Promise<T> {
  return send<T>(path, { method: 'POST', body: formData });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
};
