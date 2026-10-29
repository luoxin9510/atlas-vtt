/** The one safe line for a crash: the error's class and message only, never the object (it could carry request data). */
export function crashLine(kind: string, error: unknown): string {
  if (error instanceof Error) return `relay crashed (${kind}): ${error.name}: ${error.message}`;
  return `relay crashed (${kind}): non-error value`;
}

/** The two handlers: each logs one line and exits with code 1. */
export function crashHandlers(log: (line: string) => void, exit: (code: number) => void): { onException: (error: unknown) => void; onRejection: (error: unknown) => void } {
  const handle = (kind: string) => (error: unknown): void => {
    log(crashLine(kind, error));
    exit(1);
  };
  return { onException: handle('uncaughtException'), onRejection: handle('unhandledRejection') };
}

/**
 * Exits with code 1 on an uncaught exception or rejection, so systemd (`Restart=on-failure`) starts the
 * relay again; the state file survives. Returns a function that removes the handlers.
 */
export function installCrashHandler(log: (line: string) => void, exit: (code: number) => void): () => void {
  const { onException, onRejection } = crashHandlers(log, exit);
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);
  return () => {
    process.off('uncaughtException', onException);
    process.off('unhandledRejection', onRejection);
  };
}
