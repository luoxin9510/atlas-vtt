import { requestUrl } from 'obsidian';

/** One request of the image uploader: the table secret is written as a bearer here and nowhere else. */
export interface BinaryRequest {
  readonly url: string;
  readonly method: 'GET' | 'PUT' | 'POST';
  readonly secret: string;
  /** Image bytes (a part), sent as `application/octet-stream`. */
  readonly body?: ArrayBuffer;
  /** A JSON body, sent as `application/json`. */
  readonly json?: unknown;
}

/** The answer's status (0 when there was none) and its JSON, or null where it has none. */
export type BinaryHttp = (request: BinaryRequest) => Promise<{ status: number; json: unknown }>;

/**
 * Obsidian's `requestUrl` for the relay's image routes, which no browser's CORS rules hold back and
 * which sends bytes. It logs the class of a bad answer and never the URL, the secret or a body.
 */
export const obsidianBinaryHttp: BinaryHttp = async (request) => {
  let response: Awaited<ReturnType<typeof requestUrl>>;
  try {
    response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: { Authorization: `Bearer ${request.secret}` },
      ...(request.body === undefined ? {} : { body: request.body, contentType: 'application/octet-stream' }),
      ...(request.json === undefined ? {} : { body: JSON.stringify(request.json), contentType: 'application/json' }),
      throw: false,
    });
  } catch {
    console.warn(`[Atlas] Online play: image upload ${request.method} failed`);
    return { status: 0, json: null };
  }
  if (response.status >= 400 || response.status === 0) console.warn(`[Atlas] Online play: image upload ${request.method} answered ${Math.floor(response.status / 100)}xx`);
  let json: unknown = null;
  try {
    json = response.json;
  } catch {
    json = null;
  }
  return { status: response.status, json };
};
