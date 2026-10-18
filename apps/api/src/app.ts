import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createMerchantRouter } from "./routes/merchant.js";
import { createMediaRouter } from "./routes/media.js";
import { createTerminalRouter } from "./routes/terminal.js";

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled API error", error);
  if (response.headersSent) return;
  response.status(500).json({ error: "系統發生錯誤，請稍後再試" });
};

export function createApp() {
  const app = express();
  app.locals.pool = pool;

  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, service: "loyaltyloop-v2-api" });
  });

  app.get("/readyz", async (_request, response) => {
    try {
      await pool.query("select 1");
      response.json({ ok: true, database: "ready" });
    } catch (error) {
      console.error("Database readiness check failed", error);
      response.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  app.get("/api/v2/meta", (_request, response) => {
    response.json({
      name: "LoyaltyLoopV2",
      stage: "core-api",
      supabase: false,
      lineBot: false,
      n8n: false,
    });
  });

  app.use("/api/v2/auth", createAuthRouter(pool));
  app.use("/api/v2/admin", createAdminRouter(pool));
  app.use("/api/v2/terminal", createTerminalRouter(pool));
  app.use("/api/v2/merchant", createMerchantRouter(pool));
  app.use("/api/v2/media", createMediaRouter(pool));
  app.use(errorHandler);

  return app;
}
