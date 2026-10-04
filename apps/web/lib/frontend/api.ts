export class APIError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function requestJSON<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, signal, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok) throw new APIError(typeof payload.error === "string" ? payload.error : `Request failed (HTTP ${response.status})`, response.status);
  return payload as T;
}
