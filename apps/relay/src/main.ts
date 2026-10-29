import { loadConfig } from './config.ts';
import { installCrashHandler } from './crashHandler.ts';
import { startRelay } from './server.ts';

async function main(): Promise<void> {
  installCrashHandler((line) => console.error(line), (code) => process.exit(code));
  const config = loadConfig(process.env);
  const relay = await startRelay(config, (line) => console.log(line));
  console.log(`relay listening on ${relay.origin}`);
  const stop = (): void => {
    relay.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'relay failed to start');
  process.exit(1);
});
