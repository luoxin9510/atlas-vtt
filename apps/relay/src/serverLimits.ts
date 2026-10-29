/** The HTTP server's time and connection limits. */
export interface ServerLimits {
  /** Time a client has to send the complete request headers. Applies to HTTP requests only, never to an upgraded WebSocket. */
  readonly headersTimeoutMs: number;
  /** Time for a whole request including its body. An 8 MiB part must fit: 300 s is enough down to about 28 KB/s. */
  readonly requestTimeoutMs: number;
  /** Idle time a kept-alive connection survives. Above cloudflared's 90 s origin keep-alive, so a reused tunnel connection is never closed under it. */
  readonly keepAliveTimeoutMs: number;
  /** Open connections, WebSockets included; over it new connections are dropped. 10 tables x 13 sockets plus HTTP stays under a 1024 fd limit. */
  readonly maxConnections: number;
  /** How often Node checks connections against the two request timeouts. */
  readonly checkIntervalMs: number;
}

export const SERVER_LIMITS: ServerLimits = {
  headersTimeoutMs: 20_000,
  requestTimeoutMs: 300_000,
  keepAliveTimeoutMs: 95_000,
  maxConnections: 512,
  checkIntervalMs: 30_000,
};
