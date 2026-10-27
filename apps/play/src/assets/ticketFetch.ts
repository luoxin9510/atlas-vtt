/**
 * Downloads an image from its ticket url (a same-origin path the GM issued). Null on anything but a
 * 200 with at most `maxBytes` of body, and on a network error: the caller then asks the GM for chunks.
 */
export async function fetchTicket(fetcher: typeof fetch, url: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetcher(url, { credentials: 'omit', cache: 'no-store' });
    if (response.status !== 200) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    if (response.body === null) {
      const whole = new Uint8Array(await response.arrayBuffer());
      return whole.length > maxBytes ? null : whole;
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
