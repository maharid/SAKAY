/**
 * Calls to the SAKAY server API (/api/...). Every one of them needs the signed-in user's Supabase access token: the server refuses
 * anything else. This is the one place that attaches it, so no screen has to remember to.
 *
 * - The token comes from the Supabase session (getSession() refreshes it when it is about to expire).
 * - With no signed-in user the call is NOT sent; a 401 response is returned so the caller's usual "not ok" handling shows a message.
 * - A call that takes longer than `timeoutMs` (default 20 s) is aborted.
 */
export interface SessionCapableClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
  };
}

export interface ApiFetchInit extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const NOT_SIGNED_IN = 'Please sign in to continue.';

function notSignedIn(): Response {
  return new Response(JSON.stringify({ success: false, error: NOT_SIGNED_IN }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function apiFetch(client: SessionCapableClient, path: string, init: ApiFetchInit = {}): Promise<Response> {
  let token: string | null = null;
  try {
    const { data } = await client.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    token = null;
  }
  if (!token) return notSignedIn();

  const { timeoutMs = 20000, signal, headers, body, ...rest } = init;
  const merged = new Headers(headers);
  merged.set('Authorization', `Bearer ${token}`);
  if (typeof body === 'string' && !merged.has('Content-Type')) merged.set('Content-Type', 'application/json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(path, { ...rest, body, headers: merged, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A call to a server route that needs NO sign-in (password recovery: the person who forgot the password has no session). Nothing is attached
 * but the JSON body, and the same time limit applies. Use apiPostJson for everything else.
 */
export async function apiPostPublic(
  path: string,
  payload: unknown,
  init: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; data: Record<string, any> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20000);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data: (data ?? {}) as Record<string, any> };
  } finally {
    clearTimeout(timer);
  }
}

/** apiFetch for a JSON body; returns the parsed reply (or an empty object when the reply was not JSON). */
export async function apiPostJson(
  client: SessionCapableClient,
  path: string,
  payload: unknown,
  init: ApiFetchInit = {}
): Promise<{ ok: boolean; status: number; data: Record<string, any> }> {
  const response = await apiFetch(client, path, { ...init, method: 'POST', body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data: (data ?? {}) as Record<string, any> };
}
