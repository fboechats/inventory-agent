import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildApp } from './app.js';
import { openDatabase } from './database.js';

const path = process.env.DATABASE_PATH ?? './data/inventory.sqlite';
if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
const db = openDatabase(path);
const app = buildApp(db, { logger: true });
app.addHook('onClose', async () => { db.close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch(error => { app.log.error(error); process.exitCode = 1; });
  });
}
try {
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
