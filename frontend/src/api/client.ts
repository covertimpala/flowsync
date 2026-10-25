// Every call to the backend goes through here. On first use we fetch the
// API key from /api/settings/bootstrap (localhost-only, no key required —
// see backend/app/routers/settings.py) and cache it in memory; every
// request after that carries it as X-API-Key, exactly like an external
// application calling the same API would.

let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const res = await fetch('/api/settings/bootstrap');
  if (!res.ok) throw new Error('Could not fetch API key from backend bootstrap endpoint');
  const data = await res.json();
  cachedApiKey = data.api_key;
  return cachedApiKey!;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiKey = await getApiKey();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    // FastAPI error responses are {"detail": "..."} — show that message
    // directly instead of the raw JSON blob when it parses that way.
    let message = body || res.statusText;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === 'string') message = parsed.detail;
    } catch {
      // not JSON — use the raw body as-is
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function currentApiKey(): Promise<string> {
  return getApiKey();
}
