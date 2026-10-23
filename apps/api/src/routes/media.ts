import { Router } from "express";
import type pg from "pg";
import { getAccountContext, getTerminalContext } from "../auth/session.js";
import { getObject } from "../storage.js";

export function createMediaRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/:assetId", async (request, response, next) => {
    try {
      const asset = await pool.query<{
        object_key: string;
        mime_type: string;
        merchant_id: string;
        branch_id: string | null;
      }>(
        `select object_key, mime_type, merchant_id, branch_id
         from media_assets
         where id = $1`,
        [request.params.assetId],
      );
      const record = asset.rows[0];
      if (!record) {
        response.status(404).json({ error: "找不到媒體資產" });
        return;
      }

      const account = await getAccountContext(pool, request);
      const terminal = account ? null : await getTerminalContext(pool, request);
      const accountCanRead = Boolean(
        account && (account.role === "admin" || account.merchantIds.includes(record.merchant_id)),
      );
      const terminalCanRead = Boolean(
        terminal && terminal.isActive && terminal.merchantId === record.merchant_id &&
        (!record.branch_id || terminal.branchId === record.branch_id),
      );
      if (!accountCanRead && !terminalCanRead) {
        response.status(404).json({ error: "找不到媒體資產" });
        return;
      }

      const stored = await getObject(record.object_key);
      response.setHeader("Content-Type", stored.contentType ?? record.mime_type);
      if (stored.contentLength !== undefined) response.setHeader("Content-Length", stored.contentLength);
      response.setHeader("Cache-Control", "private, max-age=300");
      (stored.body as NodeJS.ReadableStream & { pipe: (destination: typeof response) => void }).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
