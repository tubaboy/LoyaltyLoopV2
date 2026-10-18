import pg from "pg";
import { hashPassword } from "../src/auth/password.js";

const targetUrl = process.env.LOCAL_TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
const email = process.env.ACCOUNT_EMAIL?.trim().toLowerCase();
const newPassword = process.env.NEW_PASSWORD;

if (!targetUrl || !email || !newPassword) {
  console.error("DATABASE_URL or LOCAL_TARGET_DATABASE_URL, ACCOUNT_EMAIL and NEW_PASSWORD are required.");
  process.exit(1);
}

const parsedTarget = new URL(targetUrl);
if (process.env.NODE_ENV === "production" || !["db", "localhost", "127.0.0.1"].includes(parsedTarget.hostname)) {
  console.error("Account activation is restricted to an explicitly configured local database.");
  process.exit(1);
}
if (newPassword.length < 12) {
  console.error("NEW_PASSWORD must contain at least 12 characters.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: targetUrl });

try {
  const passwordHash = await hashPassword(newPassword);
  const result = await pool.query(
    `update accounts
     set password_hash = $1, status = 'active'
     where lower(email) = $2
     returning id`,
    [passwordHash, email],
  );
  if (result.rowCount !== 1) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }
  await pool.query(
    `update sessions s
     set revoked_at = now()
     from accounts a
     where a.id = s.account_id and lower(a.email) = $1 and s.revoked_at is null`,
    [email],
  );
  console.log("Local account activation completed.");
} catch (error) {
  console.error("Local account activation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
