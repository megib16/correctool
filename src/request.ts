/** Bounds both the request and its response body, and allows callers to cancel stale work. */
export async function apiFetch(url: string, init: RequestInit, timeoutMs = 45_000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal });
    const body = await response.blob();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (err) {
    if (timeout.aborted) throw new Error("The request timed out. Please try again.");
    throw err;
  }
}
