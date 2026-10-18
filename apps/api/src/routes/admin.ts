import { randomInt, randomUUID } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { hashPassword } from "../auth/password.js";
import { requireAccount, type AccountRequest } from "../auth/session.js";
import { withTransaction } from "../db.js";
import { clampLimit, queryString, requestBodyString } from "../http.js";

const accountStatuses = ["active", "inactive", "suspended"] as const;
type AccountStatus = (typeof accountStatuses)[number];
const storeCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function isAccountStatus(value: string | undefined): value is AccountStatus {
  return Boolean(value && accountStatuses.includes(value as AccountStatus));
}

function getAdmin(request: AccountRequest, response: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (request.auth?.role === "admin") return true;
  response.status(403).json({ error: "只有系統管理員可以管理商家" });
  return false;
}

function normalizeTaxId(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function isValidTaxId(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^\d{8}$/.test(value);
}

async function createStoreCode(client: pg.PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let candidate = "";
    for (let index = 0; index < 4; index += 1) {
      candidate += storeCodeAlphabet[randomInt(0, storeCodeAlphabet.length)];
    }
    const result = await client.query("select 1 from merchants where store_code = $1 limit 1", [candidate]);
    if (!result.rows[0]) return candidate;
  }
  throw new Error("STORE_CODE_GENERATION_FAILED");
}

export function createAdminRouter(pool: pg.Pool): Router {
  const router = Router();
  router.use(requireAccount);

  router.get("/merchants", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      if (!getAdmin(accountRequest, response)) return;

      const search = queryString(request, "search");
      const rawOffset = queryString(request, "offset");
      const offset = rawOffset === undefined ? 0 : Number(rawOffset);
      if (!Number.isInteger(offset) || offset < 0) {
        response.status(400).json({ error: "分頁位置格式不正確" });
        return;
      }
      const limit = clampLimit(queryString(request, "limit"), 20);
      const values: unknown[] = [];
      const conditions: string[] = [];
      const addValue = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, "\\$&").trim()}%`;
        conditions.push(`(
          m.store_name ilike ${addValue(pattern)} escape '\\'
          or m.store_code ilike ${addValue(pattern)} escape '\\'
          or m.tax_id ilike ${addValue(pattern)} escape '\\'
          or owner.email ilike ${addValue(pattern)} escape '\\'
        )`);
      }
      const limitParameter = addValue(limit + 1);
      const offsetParameter = addValue(offset);
      const result = await pool.query(
        `select
           m.id,
           m.store_name,
           m.store_code,
           m.contact_person,
           m.contact_phone,
           m.contact_address,
           m.tax_id,
           m.status,
           m.created_at,
           owner.email as owner_email,
           owner.status as account_status,
           (select count(*)::int from branches b where b.merchant_id = m.id) as branch_count,
           (select count(*)::int from customers c where c.merchant_id = m.id) as customer_count,
           (select count(*)::int from point_transactions pt where pt.merchant_id = m.id) as transaction_count
         from merchants m
         left join lateral (
           select a.email, a.status
           from merchant_members mm
           join accounts a on a.id = mm.account_id
           where mm.merchant_id = m.id
           order by case when mm.membership_role = 'owner' then 0 else 1 end, mm.created_at asc
           limit 1
         ) owner on true
         ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
         order by m.created_at desc
         limit ${limitParameter} offset ${offsetParameter}`,
        values,
      );
      const hasMore = result.rows.length > limit;
      response.json({
        offset,
        limit,
        hasMore,
        merchants: hasMore ? result.rows.slice(0, limit) : result.rows,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/merchants", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      if (!getAdmin(accountRequest, response)) return;

      const email = requestBodyString(request, "email")?.toLowerCase();
      const password = requestBodyString(request, "password");
      const storeName = requestBodyString(request, "storeName");
      const contactPerson = requestBodyString(request, "contactPerson");
      const contactPhone = requestBodyString(request, "contactPhone");
      const contactAddress = requestBodyString(request, "contactAddress");
      const taxId = normalizeTaxId(requestBodyString(request, "taxId"));
      const status = requestBodyString(request, "status") ?? "active";

      if (!email || !email.includes("@") || !password || password.length < 12 || !storeName || storeName.length > 120 || (contactPerson && contactPerson.length > 120) || (contactPhone && contactPhone.length > 60) || (contactAddress && contactAddress.length > 240) || !isValidTaxId(taxId) || !isAccountStatus(status)) {
        response.status(400).json({ error: "商家資料格式不正確" });
        return;
      }

      const duplicate = await pool.query("select 1 from accounts where lower(email) = $1 limit 1", [email]);
      if (duplicate.rows[0]) {
        response.status(409).json({ error: "此 Email 已被使用" });
        return;
      }

      const passwordHash = await hashPassword(password);
      const merchant = await withTransaction(async (client) => {
        const accountId = randomUUID();
        const merchantId = randomUUID();
        const storeCode = await createStoreCode(client);
        await client.query(
          `insert into accounts (id, email, password_hash, role, status)
           values ($1, $2, $3, 'merchant', $4)`,
          [accountId, email, passwordHash, status],
        );
        const inserted = await client.query(
          `insert into merchants (id, store_name, store_code, contact_person, contact_phone, contact_address, tax_id, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, store_name, store_code, contact_person, contact_phone, contact_address, tax_id, status, created_at`,
          [merchantId, storeName, storeCode, contactPerson ?? null, contactPhone ?? null, contactAddress ?? null, taxId, status],
        );
        await client.query(
          `insert into merchant_members (account_id, merchant_id, membership_role)
           values ($1, $2, 'owner')`,
          [accountId, merchantId],
        );
        return { ...inserted.rows[0], owner_email: email, account_status: status };
      });

      response.status(201).json({ merchant });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/merchants/:merchantId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      if (!getAdmin(accountRequest, response)) return;

      const merchantId = accountRequest.params.merchantId as string;
      const body = request.body as Record<string, unknown> | undefined;
      const has = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
      const storeName = requestBodyString(request, "storeName");
      const contactPerson = requestBodyString(request, "contactPerson");
      const contactPhone = requestBodyString(request, "contactPhone");
      const contactAddress = requestBodyString(request, "contactAddress");
      const taxId = normalizeTaxId(requestBodyString(request, "taxId"));
      const status = requestBodyString(request, "status");
      const invalid =
        (has("storeName") && (!storeName || storeName.length > 120)) ||
        (has("contactPerson") && contactPerson !== undefined && contactPerson.length > 120) ||
        (has("contactPhone") && contactPhone !== undefined && contactPhone.length > 60) ||
        (has("contactAddress") && contactAddress !== undefined && contactAddress.length > 240) ||
        (has("taxId") && !isValidTaxId(taxId)) ||
        (has("status") && !isAccountStatus(status));
      if (invalid || !["storeName", "contactPerson", "contactPhone", "contactAddress", "taxId", "status"].some(has)) {
        response.status(400).json({ error: "商家資料格式不正確" });
        return;
      }

      const updated = await withTransaction(async (client) => {
        const result = await client.query(
          `update merchants
           set store_name = case when $1 then $2 else store_name end,
               contact_person = case when $3 then $4 else contact_person end,
               contact_phone = case when $5 then $6 else contact_phone end,
               contact_address = case when $7 then $8 else contact_address end,
               tax_id = case when $9 then $10 else tax_id end,
               status = case when $11 then $12 else status end
           where id = $13
           returning id, store_name, store_code, contact_person, contact_phone, contact_address, tax_id, status, created_at, updated_at`,
          [has("storeName"), storeName ?? null, has("contactPerson"), contactPerson ?? null, has("contactPhone"), contactPhone ?? null, has("contactAddress"), contactAddress ?? null, has("taxId"), taxId, has("status"), status ?? null, merchantId],
        );
        const merchant = result.rows[0];
        if (!merchant) return null;
        if (has("status")) {
          await client.query(
            `update accounts
             set status = $1
             where role = 'merchant'
               and id in (select account_id from merchant_members where merchant_id = $2)`,
            [status, merchantId],
          );
        }
        return merchant;
      });

      if (!updated) {
        response.status(404).json({ error: "找不到商家" });
        return;
      }
      response.json({ merchant: updated });
    } catch (error) {
      next(error);
    }
  });

  router.post("/merchants/:merchantId/reset-password", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      if (!getAdmin(accountRequest, response)) return;

      const merchantId = accountRequest.params.merchantId as string;
      const password = requestBodyString(request, "password");
      if (!password || password.length < 12) {
        response.status(400).json({ error: "新密碼至少需要 12 個字元" });
        return;
      }

      const passwordHash = await hashPassword(password);
      const result = await pool.query<{ account_id: string }>(
        `select mm.account_id
         from merchant_members mm
         where mm.merchant_id = $1
         order by case when mm.membership_role = 'owner' then 0 else 1 end, mm.created_at asc
         limit 1`,
        [merchantId],
      );
      const accountId = result.rows[0]?.account_id;
      if (!accountId) {
        response.status(404).json({ error: "找不到商家帳號" });
        return;
      }
      await pool.query("update accounts set password_hash = $1 where id = $2", [passwordHash, accountId]);
      await pool.query("update sessions set revoked_at = now() where account_id = $1 and revoked_at is null", [accountId]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
