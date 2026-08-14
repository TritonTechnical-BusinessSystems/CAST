/**
 * Thin fetch wrapper for the CAST API. Same-origin (nginx proxies /api → the
 * api container in prod; Vite proxies it in dev), so the session cookie rides
 * along automatically.
 */
export interface ApiError {
  error: string;
  reason?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  // 204 No Content (every DELETE, some PATCH endpoints) has no body — calling
  // res.json() on it throws "Unexpected end of JSON input" even though the
  // request succeeded, silently breaking every caller that awaits the result.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart file upload (logo upload, etc.) — no Content-Type override, the browser sets the multipart boundary. */
  upload: async <T>(path: string, file: File, field = "file"): Promise<T> => {
    const form = new FormData();
    form.append(field, file);
    const res = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ApiError;
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  },
};
