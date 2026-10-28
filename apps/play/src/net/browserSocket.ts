import type { SocketLike } from './TableSocket.ts';

/** The browser's `WebSocket` seen as a `SocketLike`: handlers take only what the table socket reads. */
export function openBrowserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const like: SocketLike = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    get readyState() { return ws.readyState; },
    get bufferedAmount() { return ws.bufferedAmount; },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (event) => like.onmessage?.({ data: event.data });
  ws.onclose = (event) => like.onclose?.({ code: event.code });
  ws.onerror = () => like.onerror?.();
  return like;
}
