import { createHash } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import {
  clearTerminalCookie,
  createTerminalSession,
  getTerminalContext,
  getTerminalContextByToken,
  requireTerminal,
  revokeTerminalSession,
  setTerminalCookie,
  type TerminalRequest,
} from "../auth/session.js";
import { withTransaction } from "../db.js";
import {
  normalizePhone,
  queryString,
  requestBodyPositiveInteger,
  requestBodyString,
} from "../http.js";

function hashTerminalKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function isSupportedTerminalKey(key: string): boolean {
  return /^(?:[A-Z0-9]{8}|[A-Z0-9]{12})$/.test(key);
}

function terminalContextResponse(context: Awaited<ReturnType<typeof getTerminalContext>>) {
  if (!context) return null;

  return {
    branch_id: context.branchId,
    branch_name: context.branchName,
    merchant_id: context.merchantId,
    store_name: context.storeName,
    is_active: context.isActive,
    daily_redemption_limit: context.dailyRedemptionLimit,
    theme_color: context.themeColor,
    reset_interval: context.resetInterval,
    reminder_interval: context.reminderInterval,
    enable_confetti: context.enableConfetti,
    enable_sound: context.enableSound,
    point_collection_effect: context.pointCollectionEffect,
    redemption_effect: context.redemptionEffect,
    screensaver_timeout: context.screensaverTimeout,
    logo_asset_id: context.logoAssetId,
    screensaver_asset_id: context.screensaverAssetId,
    collection_sound_asset_id: context.collectionSoundAssetId,
    redemption_sound_asset_id: context.redemptionSoundAssetId,
  };
}

export function createTerminalRouter(pool: pg.Pool): Router {
  const router = Router();

  router.post("/login", async (request, response, next) => {
    try {
      const key = requestBodyString(request, "key")?.toUpperCase();
      if (!key || !isSupportedTerminalKey(key)) {
        response.status(400).json({ error: "請輸入完整的 8 碼終端登入金鑰（商家代碼 + 4 位數字）" });
        return;
      }

      const result = await pool.query<{ branch_id: string; is_active: boolean }>(
        `select tc.branch_id, b.is_active
         from terminal_credentials tc
         join branches b on b.id = tc.branch_id
         where tc.key_hash = $1
           and tc.is_active = true
         limit 1`,
        [hashTerminalKey(key)],
      );

      const credential = result.rows[0];
      if (!credential) {
        response.status(401).json({ error: "找不到此金鑰對應的分店" });
        return;
      }

      if (!credential.is_active) {
        response.status(403).json({ error: "該分店目前暫停營運" });
        return;
      }

      const token = await createTerminalSession(pool, credential.branch_id);
      setTerminalCookie(response, token);
      const context = await getTerminalContextByToken(pool, token);

      response.json({ terminal: terminalContextResponse(context) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/context", requireTerminal, (request, response) => {
    response.json({ terminal: terminalContextResponse((request as TerminalRequest).terminal ?? null) });
  });

  router.post("/logout", async (request, response, next) => {
    try {
      await revokeTerminalSession(pool, request);
      clearTerminalCookie(response);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/customer", requireTerminal, async (request, response, next) => {
    try {
      const terminal = (request as TerminalRequest).terminal;
      const phone = queryString(request, "phone");
      if (!terminal || !phone) {
        response.status(400).json({ error: "請輸入顧客電話" });
        return;
      }

      const result = await pool.query<{
        id: string;
        phone_display: string;
        points_balance: number;
      }>(
        `select id, phone_display, points_balance
         from customers
         where merchant_id = $1 and phone_normalized = $2
         limit 1`,
        [terminal.merchantId, normalizePhone(phone)],
      );

      const customer = result.rows[0];
      response.json({
        customer: customer
          ? {
              id: customer.id,
              phone: customer.phone_display,
              points: customer.points_balance,
            }
          : null,
        points: customer?.points_balance ?? 0,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/options", requireTerminal, async (request, response, next) => {
    try {
      const terminal = (request as TerminalRequest).terminal;
      if (!terminal) {
        response.status(401).json({ error: "終端尚未登入" });
        return;
      }

      const result = await pool.query(
        `select id, type, label, value_points, display_order
         from loyalty_options
         where merchant_id = $1
           and branch_id = $2
           and is_active = true
         order by display_order asc, created_at asc`,
        [terminal.merchantId, terminal.branchId],
      );

      response.json({ options: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get("/redemption-count", requireTerminal, async (request, response, next) => {
    try {
      const terminal = (request as TerminalRequest).terminal;
      const phone = queryString(request, "phone");
      if (!terminal || !phone) {
        response.status(400).json({ error: "請輸入顧客電話" });
        return;
      }

      const result = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from point_transactions pt
         join customers c on c.id = pt.customer_id
         where pt.merchant_id = $1
           and pt.branch_id = $2
           and c.phone_normalized = $3
           and pt.type = 'redeem'
           and pt.created_at >= current_date
           and pt.created_at < current_date + interval '1 day'`,
        [terminal.merchantId, terminal.branchId, normalizePhone(phone)],
      );

      response.json({ count: Number(result.rows[0]?.count ?? 0) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/points/add", requireTerminal, async (request, response, next) => {
    try {
      const terminal = (request as TerminalRequest).terminal;
      const phone = requestBodyString(request, "phone");
      const amount = requestBodyPositiveInteger(request, "amount", 1);
      const idempotencyKey = requestBodyString(request, "idempotencyKey");

      if (!terminal || !phone || !amount) {
        response.status(400).json({ error: "電話與點數數量格式不正確" });
        return;
      }

      const result = await withTransaction(async (client) => {
        if (idempotencyKey) {
          const existing = await client.query<{ customer_id: string; balance_after: number }>(
            `select customer_id, balance_after
             from point_transactions
             where merchant_id = $1 and idempotency_key = $2
             limit 1`,
            [terminal.merchantId, idempotencyKey],
          );
          if (existing.rows[0]) {
            return {
              customerId: existing.rows[0].customer_id,
              balance: existing.rows[0].balance_after,
              reused: true,
            };
          }
        }

        await client.query(
          `insert into customers (merchant_id, phone_normalized, phone_display)
           values ($1, $2, $3)
           on conflict (merchant_id, phone_normalized)
           do update set phone_display = excluded.phone_display`,
          [terminal.merchantId, normalizePhone(phone), phone],
        );

        const customer = await client.query<{ id: string; points_balance: number }>(
          `select id, points_balance
           from customers
           where merchant_id = $1 and phone_normalized = $2
           for update`,
          [terminal.merchantId, normalizePhone(phone)],
        );
        const current = customer.rows[0];
        if (!current) throw new Error("CUSTOMER_CREATE_FAILED");

        const balance = current.points_balance + amount;
        await client.query(
          `update customers set points_balance = $1 where id = $2`,
          [balance, current.id],
        );
        await client.query(
          `insert into point_transactions
             (merchant_id, branch_id, customer_id, type, amount, delta, balance_after, actor_type, idempotency_key)
           values ($1, $2, $3, 'add', $4, $4, $5, 'terminal', $6)`,
          [terminal.merchantId, terminal.branchId, current.id, amount, balance, idempotencyKey ?? null],
        );

        return { customerId: current.id, balance, reused: false };
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/points/redeem", requireTerminal, async (request, response, next) => {
    try {
      const terminal = (request as TerminalRequest).terminal;
      const phone = requestBodyString(request, "phone");
      const amount = requestBodyPositiveInteger(request, "amount");
      const manual = request.body?.manual === true;
      const idempotencyKey = requestBodyString(request, "idempotencyKey");

      if (!terminal || !phone || !amount) {
        response.status(400).json({ error: "電話與點數數量格式不正確" });
        return;
      }

      const result = await withTransaction(async (client) => {
        if (idempotencyKey) {
          const existing = await client.query<{ balance_after: number }>(
            `select balance_after
             from point_transactions
             where merchant_id = $1 and idempotency_key = $2
             limit 1`,
            [terminal.merchantId, idempotencyKey],
          );
          if (existing.rows[0]) {
            return { balance: existing.rows[0].balance_after, reused: true };
          }
        }

        const customer = await client.query<{ id: string; points_balance: number }>(
          `select id, points_balance
           from customers
           where merchant_id = $1 and phone_normalized = $2
           for update`,
          [terminal.merchantId, normalizePhone(phone)],
        );
        const current = customer.rows[0];
        if (!current) return { balance: null, reused: false, reason: "CUSTOMER_NOT_FOUND" };
        if (current.points_balance < amount) {
          return { balance: current.points_balance, reused: false, reason: "INSUFFICIENT_POINTS" };
        }

        if (!manual && terminal.dailyRedemptionLimit > 0) {
          const daily = await client.query<{ count: string }>(
            `select count(*)::text as count
             from point_transactions
             where merchant_id = $1
               and branch_id = $2
               and customer_id = $3
               and type = 'redeem'
               and created_at >= current_date
               and created_at < current_date + interval '1 day'`,
            [terminal.merchantId, terminal.branchId, current.id],
          );
          if (Number(daily.rows[0]?.count ?? 0) >= terminal.dailyRedemptionLimit) {
            return { balance: current.points_balance, reused: false, reason: "LIMIT_REACHED" };
          }
        }

        const balance = current.points_balance - amount;
        await client.query(
          `update customers set points_balance = $1 where id = $2`,
          [balance, current.id],
        );
        await client.query(
          `insert into point_transactions
             (merchant_id, branch_id, customer_id, type, amount, delta, balance_after, actor_type, idempotency_key)
           values ($1, $2, $3, $4, $5, $6, $7, 'terminal', $8)`,
          [
            terminal.merchantId,
            terminal.branchId,
            current.id,
            manual ? "manual_redeem" : "redeem",
            amount,
            -amount,
            balance,
            idempotencyKey ?? null,
          ],
        );

        return { balance, reused: false };
      });

      if (result.reason === "CUSTOMER_NOT_FOUND") {
        response.status(404).json({ error: "找不到此顧客", code: result.reason });
        return;
      }
      if (result.reason === "INSUFFICIENT_POINTS") {
        response.status(409).json({ error: "點數不足", code: result.reason, points: result.balance });
        return;
      }
      if (result.reason === "LIMIT_REACHED") {
        response.status(409).json({ error: "今日兌點次數已達上限", code: result.reason, points: result.balance });
        return;
      }

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
