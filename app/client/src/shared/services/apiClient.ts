/** Thin fetch wrapper for the local Express API. No caching, no retries — just JSON (or multipart) in/out. */

export class ApiError extends Error {
  status: number;
  errors: string[];
  /** Stable machine-readable reason, when the endpoint provides one (the generation endpoints do). */
  code: string | null;
  /** Whether the server says repeating the identical request could succeed. Cynth never retries on its own — this only decides whether a Retry button is offered. */
  retryable: boolean;

  constructor(status: number, errors: string[], code: string | null = null, retryable = false) {
    super(errors.join(' ') || 'Request failed.');
    this.status = status;
    this.errors = errors.length ? errors : ['Request failed.'];
    this.code = code;
    this.retryable = retryable;
  }
}

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
    );
  }

  return data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return handleResponse<T>(response);
}

/** For multipart/form-data (file uploads) — no Content-Type header, so the browser sets the multipart boundary. */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`/api${path}`, { method: 'POST', body: formData });
  return handleResponse<T>(response);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
};
