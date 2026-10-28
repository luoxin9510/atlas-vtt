/**
 * Downloads an image from its ticket url (a same-origin path the GM issued). Null on anything but a
 * 200 with at most `maxBytes` of body, on a network error and when `signal` aborts: the caller then
 * asks the GM for chunks. `onProgress` is called whenever bytes arrive, so the caller can tell a
 * slow download from a stalled one.
 */
export async function fetchTicket(
  fetcher: typeof fetch, url: string, maxBytes: number, onProgress: () => void, signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetcher(url, { credentials: 'omit', cache: 'no-store', signal });
    if (response.status !== 200) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    if (response.body === null) {
      const whole = new Uint8Array(await response.arrayBuffer());
      onProgress();
      return whole.length > maxBytes ? null : whole;
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      if (signal.aborted) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      const { done, value } = await reader.read();
      if (done) break;
      onProgress();
      total += value.length;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  } catch {
    return null;
  }
}
