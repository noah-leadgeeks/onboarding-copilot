/** JSON envelopes for agent routes: `{ ok: true, data }` or `{ ok: false, error, message }`. */

export function withNoStore(response: Response): Response {
  try {
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    // Some Response instances (e.g. from fetch) have immutable headers; copy them.
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export function agentJson<T>(data: T, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json({ ok: true, data }, { status: init.status ?? 200, headers });
}

export function agentError(status: number, error: string, message: string, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  merged.set('Cache-Control', 'no-store');
  return Response.json({ ok: false, error, message }, { status, headers: merged });
}
