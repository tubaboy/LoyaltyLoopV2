import { createHash, randomBytes, randomInt, scryptSync } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const adminEmail = "v2-admin@loyaltyloop.test";
const adminPassword = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const passwordHash = [
  "scrypt",
  16_384,
  8,
  1,
  salt.toString("base64url"),
  scryptSync(adminPassword, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  }).toString("base64url"),
].join("$");

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const storeCode = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
const pin = String(randomInt(1000, 10_000));
const terminalKey = `${storeCode}${pin}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query("BEGIN");
  await pool.query(
    "insert into accounts (email, password_hash, role) values ($1, $2, 'admin')",
    [adminEmail, passwordHash],
  );
  const merchant = await pool.query(
    "insert into merchants (store_name, store_code) values ($1, $2) returning id",
    ["LoyaltyLoop V2 平板測試", storeCode],
  );
  const branch = await pool.query(
    "insert into branches (merchant_id, name) values ($1, $2) returning id",
    [merchant.rows[0].id, "Ubuntu 測試分店"],
  );
  await pool.query("insert into branch_settings (branch_id) values ($1)", [branch.rows[0].id]);
  await pool.query(
    "insert into terminal_credentials (branch_id, key_hash, key_hint) values ($1, $2, $3)",
    [branch.rows[0].id, createHash("sha256").update(terminalKey).digest("hex"), `${storeCode}••••`],
  );
  await pool.query(
    `insert into loyalty_options (merchant_id, branch_id, type, label, value_points, display_order)
     values ($1, $2, 'add', '測試集點 +1', 1, 0),
            ($1, $2, 'redeem', '測試兌換', 10, 0)`,
    [merchant.rows[0].id, branch.rows[0].id],
  );
  await pool.query("COMMIT");
  console.log(`Admin email: ${adminEmail}`);
  console.log(`Admin password: ${adminPassword}`);
  console.log(`Terminal key: ${terminalKey}`);
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Test account seed failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
