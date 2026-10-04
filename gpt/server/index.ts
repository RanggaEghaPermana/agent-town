import { createOfficeApp } from './app.js';
import { engineHealth } from './engine.js';

const { app, runner } = await createOfficeApp();
await app.listen({ host: '127.0.0.1', port: Number(process.env.AGENT_TOWN_GPT_PORT || 4318) });
runner.health = await engineHealth();
runner.changed();
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  process.exit(0);
});
