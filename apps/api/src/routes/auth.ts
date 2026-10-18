import { Router } from "express";
import type pg from "pg";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  clearAccountCookie,
  createAccountSession,
  getAccountContext,
  requireAccount,
  revokeAccountSession,
  setAccountCookie,
  type AccountRequest,
} from "../auth/session.js";
import { requestBodyString } from "../http.js";

export function createAuthRouter(pool: pg.Pool): Router {
  const router = Router();

  router.post("/login", async (request, response, next) => {
    try {
      const email = requestBodyString(request, "email")?.toLowerCase();
      const password = requestBodyString(request, "password");

      if (!email || !password) {
        response.status(400).json({ error: "請輸入電子郵件與密碼" });
        return;
      }

      const result = await pool.query<{
        id: string;
        email: string;
        password_hash: string;
        role: "admin" | "merchant";
        status: "active" | "inactive" | "suspended";
      }>(
        `select id, email, password_hash, role, status
         from accounts
         where lower(email) = $1
         limit 1`,
        [email],
      );

      const account = result.rows[0];
      if (!account || !(await verifyPassword(password, account.password_hash))) {
        response.status(401).json({ error: "帳號或密碼不正確" });
        return;
      }

      if (account.status !== "active") {
        response.status(403).json({
          error:
            account.status === "suspended"
              ? "此帳號已被停權，請聯絡系統管理員"
              : "此帳號目前暫停服務，請聯絡系統管理員",
          code: "ACCOUNT_INACTIVE",
        });
        return;
      }

      await pool.query("update accounts set last_login_at = now() where id = $1", [
        account.id,
      ]);
      const token = await createAccountSession(pool, account.id);
      setAccountCookie(response, token);

      response.json({
        account: {
          id: account.id,
          email: account.email,
          role: account.role,
          status: account.status,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAccount, async (request, response, next) => {
    try {
      const context = (request as AccountRequest).auth;
      if (!context) {
        response.status(401).json({ error: "未登入或登入已過期" });
        return;
      }

      response.json({
        account: {
          id: context.accountId,
          email: context.email,
          role: context.role,
          merchantIds: context.merchantIds,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/password", requireAccount, async (request, response, next) => {
    try {
      const context = (request as AccountRequest).auth;
      const currentPassword = requestBodyString(request, "currentPassword");
      const newPassword = requestBodyString(request, "newPassword");
      if (!context || !currentPassword || !newPassword) {
        response.status(400).json({ error: "請輸入目前密碼與新密碼" });
        return;
      }
      if (newPassword.length < 12) {
        response.status(400).json({ error: "新密碼至少需要 12 個字元" });
        return;
      }

      const result = await pool.query<{ password_hash: string }>(
        "select password_hash from accounts where id = $1",
        [context.accountId],
      );
      const account = result.rows[0];
      if (!account || !(await verifyPassword(currentPassword, account.password_hash))) {
        response.status(401).json({ error: "目前密碼不正確" });
        return;
      }

      await pool.query(
        `update accounts
         set password_hash = $1
         where id = $2`,
        [await hashPassword(newPassword), context.accountId],
      );
      await pool.query(
        `update sessions
         set revoked_at = now()
         where account_id = $1 and id <> $2 and revoked_at is null`,
        [context.accountId, context.sessionId],
      );
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (request, response, next) => {
    try {
      await revokeAccountSession(pool, request);
      clearAccountCookie(response);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
