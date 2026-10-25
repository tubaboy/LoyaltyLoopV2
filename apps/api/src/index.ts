import { createApp } from "./app.js";
import { pool } from "./db.js";
import { startMediaSync } from "./media-sync.js";

const port = Number(process.env.PORT ?? 3000);

const app = createApp();
startMediaSync(pool);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`LoyaltyLoopV2 API listening on port ${port}`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

