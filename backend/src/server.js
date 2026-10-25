import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPgDb } from './db.js';

async function main() {
  const config = loadConfig();
  const db = createPgDb(config);
  await db.initialize(); // verifies the Supabase tables exist (see supabase/schema.sql)

  const app = createApp({ config, db });
  const stopBackgroundTasks = app.startBackgroundTasks();
  const server = app.listen(config.port, config.host, () => {
    console.log(`PocketSmart API listening on http://${config.host}:${config.port}`);
    console.log(`  environment: ${config.production ? 'production' : 'development'} | AI: ${config.geminiApiKey ? 'Gemini' : 'offline plans'}`);
    console.log(`  frontend:    ${config.hasFrontendBuild ? 'serving frontend/dist' : 'no build found (use the Vite dev server)'}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    stopBackgroundTasks();
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
