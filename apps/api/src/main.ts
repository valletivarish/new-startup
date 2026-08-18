import 'reflect-metadata';
import { buildApp } from './server.js';

const built = await buildApp();

await built.app.listen({ port: built.env.API_PORT, host: '0.0.0.0' });
built.logger.info(
  { port: built.env.API_PORT },
  'platform-api listening',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    built.logger.info({ signal }, 'shutting down');
    void built.close().then(() => process.exit(0));
  });
}
