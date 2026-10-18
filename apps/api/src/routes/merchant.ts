import { createHash, randomInt, randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type pg from "pg";
import { requireAccount, type AccountRequest } from "../auth/session.js";
import { withTransaction } from "../db.js";
import { clampLimit, normalizePhone, queryString, requestBodyBoolean, requestBodyInteger, requestBodyString } from "../http.js";
import { deleteObject, putObject } from "../storage.js";

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const allowedPointCollectionEffects = new Set(["shower", "flip"]);
const allowedRedemptionEffects = new Set(["confetti", "balloons"]);

function createBranchTerminalKey(storeCode: string, pin?: string): string {
  const normalizedStoreCode = storeCode.trim().toUpperCase();
  const normalizedPin = pin ?? randomInt(1000, 10_000).toString();
  return `${normalizedStoreCode}${normalizedPin}`;
}

function hashTerminalKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    callback(null, Boolean(imageExtensions[file.mimetype]));
  },
});

function resolveMerchantId(request: AccountRequest, requested?: string): string | undefined {
  if (!request.auth) return undefined;
  if (requested && request.auth.role === "admin") return requested;
  if (requested && request.auth.merchantIds.includes(requested)) return requested;
  return request.auth.merchantIds[0];
}

type BranchAccess =
  | { branchId: string; merchantId: string }
  | { status: 403 | 404; error: string };

async function resolveBranchAccess(
  pool: pg.Pool,
  account: AccountRequest["auth"],
  branchId: string,
): Promise<BranchAccess> {
  const result = await pool.query<{ merchant_id: string }>(
    "select merchant_id from branches where id = $1",
    [branchId],
  );
  const branch = result.rows[0];
  if (!branch) return { status: 404, error: "找不到分店" };
  if (!account || (account.role !== "admin" && !account.merchantIds.includes(branch.merchant_id))) {
    return { status: 403, error: "沒有此分店的管理權限" };
  }
  return { branchId, merchantId: branch.merchant_id };
}

async function cleanupUnreferencedMediaAsset(pool: pg.Pool, assetId: string): Promise<void> {
  const assetResult = await pool.query<{ id: string; objectKey: string }>(
    `select ma.id, ma.object_key as "objectKey"
     from media_assets ma
     where ma.id = $1
       and not exists (
         select 1
         from branch_settings bs
         where bs.logo_asset_id = ma.id or bs.screensaver_asset_id = ma.id
       )`,
    [assetId],
  );
  const asset = assetResult.rows[0];
  if (!asset) return;

  try {
    await deleteObject(asset.objectKey);
  } catch (error) {
    // Keep the database row when storage cleanup fails so a later cleanup can retry it.
    console.warn("MEDIA_ASSET_STORAGE_CLEANUP_FAILED", { assetId: asset.id, error });
    return;
  }

  await pool.query(
    `delete from media_assets ma
     where ma.id = $1
       and not exists (
         select 1
         from branch_settings bs
         where bs.logo_asset_id = ma.id or bs.screensaver_asset_id = ma.id
       )`,
    [asset.id],
  );
}

export function createMerchantRouter(pool: pg.Pool): Router {
  const router = Router();
  router.use(requireAccount);

  router.post("/media", imageUpload.single("file"), async (request, response, next) => {
    let objectKey: string | undefined;
    try {
      const accountRequest = request as AccountRequest;
      const account = accountRequest.auth;
      const branchId = requestBodyString(request, "branchId");
      const kind = requestBodyString(request, "kind");
      const file = request.file;

      if (!account || !branchId || (kind !== "logo" && kind !== "screensaver") || !file) {
        response.status(400).json({ error: "請選擇分店、圖片用途與圖片檔案" });
        return;
      }

      const branchResult = await pool.query<{ merchant_id: string }>(
        "select merchant_id from branches where id = $1",
        [branchId],
      );
      const branch = branchResult.rows[0];
      if (!branch) {
        response.status(404).json({ error: "找不到分店" });
        return;
      }
      if (account.role !== "admin" && !account.merchantIds.includes(branch.merchant_id)) {
        response.status(403).json({ error: "沒有此分店的圖片管理權限" });
        return;
      }

      const extension = imageExtensions[file.mimetype];
      objectKey = `${branch.merchant_id}/${branchId}/${kind}/${randomUUID()}.${extension}`;
      await putObject(objectKey, file.buffer, file.mimetype);

      const asset = await withTransaction(async (client) => {
        await client.query(
          "insert into branch_settings (branch_id) values ($1) on conflict (branch_id) do nothing",
          [branchId],
        );

        const settingColumn = kind === "logo" ? "logo_asset_id" : "screensaver_asset_id";
        const previousAsset = await client.query<{ assetId: string | null }>(
          `select ${settingColumn} as "assetId"
           from branch_settings
           where branch_id = $1
           for update`,
          [branchId],
        );

        const inserted = await client.query<{
          id: string;
          kind: string;
          mime_type: string;
          byte_size: number;
        }>(
          `insert into media_assets (merchant_id, branch_id, kind, object_key, original_name, mime_type, byte_size)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, kind, mime_type, byte_size`,
          [branch.merchant_id, branchId, kind, objectKey, file.originalname.slice(0, 255), file.mimetype, file.size],
        );

        await client.query(`update branch_settings set ${settingColumn} = $1 where branch_id = $2`, [inserted.rows[0].id, branchId]);
        return {
          ...inserted.rows[0],
          previousAssetId: previousAsset.rows[0]?.assetId ?? null,
        };
      });

      if (asset.previousAssetId) {
        try {
          await cleanupUnreferencedMediaAsset(pool, asset.previousAssetId);
        } catch (cleanupError) {
          // The new asset is already active; cleanup can be retried without failing the upload.
          console.warn("MEDIA_ASSET_DATABASE_CLEANUP_FAILED", { assetId: asset.previousAssetId, cleanupError });
        }
      }

      response.status(201).json({
        asset: {
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mime_type,
          byteSize: asset.byte_size,
          url: `/api/v2/media/${asset.id}`,
        },
      });
    } catch (error) {
      if (objectKey) await deleteObject(objectKey).catch(() => undefined);
      next(error);
    }
  });

  router.get("/overview", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, queryString(request, "merchantId"));
      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }

      const result = await pool.query<{
        store_name: string;
        branch_count: string;
        customer_count: string;
        transaction_count: string;
      }>(
        `select
           m.store_name,
           (select count(*) from branches b where b.merchant_id = m.id)::text as branch_count,
           (select count(*) from customers c where c.merchant_id = m.id)::text as customer_count,
           (select count(*) from point_transactions pt where pt.merchant_id = m.id)::text as transaction_count
         from merchants m
         where m.id = $1`,
        [merchantId],
      );

      const overview = result.rows[0];
      if (!overview) {
        response.status(404).json({ error: "找不到商家" });
        return;
      }

      response.json({
        merchantId,
        storeName: overview.store_name,
        branchCount: Number(overview.branch_count),
        customerCount: Number(overview.customer_count),
        transactionCount: Number(overview.transaction_count),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/dashboard", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, queryString(request, "merchantId"));
      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }

      const branchId = queryString(request, "branchId");
      if (branchId) {
        const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
        if ("status" in access) {
          response.status(access.status).json({ error: access.error });
          return;
        }
        if (access.merchantId !== merchantId) {
          response.status(403).json({ error: "沒有此分店的 Dashboard 查詢權限" });
          return;
        }
      }

      const requestedDateFrom = queryString(request, "dateFrom");
      const requestedDateTo = queryString(request, "dateTo");
      if ((requestedDateFrom && Number.isNaN(Date.parse(requestedDateFrom))) || (requestedDateTo && Number.isNaN(Date.parse(requestedDateTo)))) {
        response.status(400).json({ error: "日期格式不正確" });
        return;
      }

      const defaultDateTo = new Date();
      const defaultDateFrom = new Date(defaultDateTo);
      defaultDateFrom.setHours(0, 0, 0, 0);
      const dateFrom = requestedDateFrom ?? defaultDateFrom.toISOString();
      const dateTo = requestedDateTo ?? defaultDateTo.toISOString();
      if (Date.parse(dateFrom) > Date.parse(dateTo)) {
        response.status(400).json({ error: "開始日期不能晚於結束日期" });
        return;
      }

      const granularity = queryString(request, "granularity") ?? "day";
      if (granularity !== "hour" && granularity !== "day") {
        response.status(400).json({ error: "圖表粒度格式不正確" });
        return;
      }

      const values: unknown[] = [merchantId, dateFrom, dateTo];
      const conditions = ["pt.merchant_id = $1", "pt.created_at >= $2", "pt.created_at <= $3"];
      const addValue = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (branchId) conditions.push(`pt.branch_id = ${addValue(branchId)}`);
      const transactionWhere = conditions.join(" and ");

      const merchantNamePromise = pool.query<{ store_name: string }>(
        "select store_name from merchants where id = $1",
        [merchantId],
      );

      const statsPromise = pool.query<{
        period_issued: number;
        period_redeemed: number;
        period_add_count: number;
        redemption_count: number;
      }>(
        `select
           coalesce(sum(pt.amount) filter (where pt.type = 'add'), 0)::int as period_issued,
           coalesce(sum(pt.amount) filter (where pt.type in ('redeem', 'manual_redeem')), 0)::int as period_redeemed,
           (count(*) filter (where pt.type = 'add'))::int as period_add_count,
           (count(*) filter (where pt.type in ('redeem', 'manual_redeem')))::int as redemption_count
         from point_transactions pt
         where ${transactionWhere}`,
        values,
      );

      const customerStatsPromise = pool.query<{ total_customers: number; new_members: number }>(
        `select
           count(*)::int as total_customers,
           (count(*) filter (where c.created_at >= $2 and c.created_at <= $3))::int as new_members
         from customers c
         where c.merchant_id = $1`,
        [merchantId, dateFrom, dateTo],
      );

      const lifetimeValues: unknown[] = [merchantId];
      let lifetimeWhere = "pt.merchant_id = $1 and pt.type = 'add'";
      if (branchId) {
        lifetimeValues.push(branchId);
        lifetimeWhere += " and pt.branch_id = $2";
      }
      const lifetimePromise = pool.query<{ lifetime_issued: number }>(
        `select coalesce(sum(pt.amount), 0)::int as lifetime_issued
         from point_transactions pt
         where ${lifetimeWhere}`,
        lifetimeValues,
      );

      const activeBranchesPromise = pool.query<{ active_branches: number }>(
        `select count(*)::int as active_branches
         from branches
         where merchant_id = $1 and is_active = true`,
        [merchantId],
      );

      const recentValues = [...values, 5];
      const recentPromise = pool.query(
        `select
           pt.id,
           pt.branch_id,
           b.name as branch_name,
           pt.customer_id,
           c.phone_display,
           pt.type,
           pt.amount,
           pt.delta,
           pt.balance_after,
           pt.actor_type,
           pt.created_at
         from point_transactions pt
         join customers c on c.id = pt.customer_id
         left join branches b on b.id = pt.branch_id
         where ${transactionWhere}
         order by pt.created_at desc
         limit $${recentValues.length}`,
        recentValues,
      );

      const rankingPromise = pool.query(
        `select
           c.id as customer_id,
           c.phone_display,
           c.points_balance,
           coalesce(sum(pt.amount) filter (where pt.type = 'add'), 0)::int as accumulated,
           coalesce(sum(pt.amount) filter (where pt.type in ('redeem', 'manual_redeem')), 0)::int as redeemed,
           count(pt.id)::int as transaction_count,
           max(pt.created_at) as last_seen
         from point_transactions pt
         join customers c on c.id = pt.customer_id
         where ${transactionWhere}
         group by c.id
         order by accumulated desc, last_seen desc
         limit 10`,
        values,
      );

      const chartBucket = granularity === "hour" ? "date_trunc('hour', pt.created_at)" : "date_trunc('day', pt.created_at)";
      const chartPromise = pool.query(
        `select
           ${chartBucket} as bucket,
           coalesce(sum(pt.amount) filter (where pt.type = 'add'), 0)::int as points
         from point_transactions pt
         where ${transactionWhere}
         group by bucket
         order by bucket asc`,
        values,
      );

      const branchSummaryPromise = branchId
        ? Promise.resolve({ rows: [] as Record<string, unknown>[] })
        : pool.query(
          `select
             coalesce(b.name, '未指定分店') as branch_name,
             coalesce(sum(pt.amount) filter (where pt.type = 'add'), 0)::int as issued,
             coalesce(sum(pt.amount) filter (where pt.type in ('redeem', 'manual_redeem')), 0)::int as redeemed,
             count(distinct pt.customer_id)::int as unique_members,
             count(*)::int as transaction_count
           from point_transactions pt
           left join branches b on b.id = pt.branch_id
           where ${transactionWhere}
           group by b.id, b.name
           order by issued desc, branch_name asc`,
          values,
        );

      const [merchantNameResult, statsResult, customerStatsResult, lifetimeResult, activeBranchesResult, recentResult, rankingResult, chartResult, branchSummaryResult] = await Promise.all([
        merchantNamePromise,
        statsPromise,
        customerStatsPromise,
        lifetimePromise,
        activeBranchesPromise,
        recentPromise,
        rankingPromise,
        chartPromise,
        branchSummaryPromise,
      ]);

      const stats = statsResult.rows[0];
      const customerStats = customerStatsResult.rows[0];
      const lifetime = lifetimeResult.rows[0];
      const activeBranches = activeBranchesResult.rows[0];
      const periodIssued = Number(stats?.period_issued ?? 0);
      const periodRedeemed = Number(stats?.period_redeemed ?? 0);

      response.json({
        merchantId,
        storeName: merchantNameResult.rows[0]?.store_name ?? null,
        branchId: branchId ?? null,
        dateFrom,
        dateTo,
        granularity,
        stats: {
          totalCustomers: Number(customerStats?.total_customers ?? 0),
          newMembers: Number(customerStats?.new_members ?? 0),
          periodIssued,
          periodRedeemed,
          lifetimeIssued: Number(lifetime?.lifetime_issued ?? 0),
          periodAddCount: Number(stats?.period_add_count ?? 0),
          redemptionCount: Number(stats?.redemption_count ?? 0),
          burnRate: periodIssued > 0 ? Math.round((periodRedeemed / periodIssued) * 1000) / 10 : 0,
          activeBranches: Number(activeBranches?.active_branches ?? 0),
        },
        chart: chartResult.rows.map((row) => ({ bucket: row.bucket, points: Number(row.points ?? 0) })),
        recentTransactions: recentResult.rows,
        memberRankings: rankingResult.rows.map((row) => ({
          ...row,
          accumulated: Number(row.accumulated ?? 0),
          redeemed: Number(row.redeemed ?? 0),
          transaction_count: Number(row.transaction_count ?? 0),
        })),
        branchSummary: branchSummaryResult.rows.map((row) => ({
          ...row,
          issued: Number(row.issued ?? 0),
          redeemed: Number(row.redeemed ?? 0),
          unique_members: Number(row.unique_members ?? 0),
          transaction_count: Number(row.transaction_count ?? 0),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/branches", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, requestBodyString(request, "merchantId"));
      const name = requestBodyString(request, "name");
      const address = requestBodyString(request, "address");
      const phone = requestBodyString(request, "phone");
      const timezone = requestBodyString(request, "timezone") ?? "Asia/Taipei";
      const isActive = requestBodyBoolean(request, "isActive") ?? true;
      const terminalPin = requestBodyString(request, "terminalPin");
      const body = request.body as Record<string, unknown> | undefined;
      const hasInvalidIsActive = body?.isActive !== undefined && requestBodyBoolean(request, "isActive") === undefined;
      const hasInvalidTerminalPin = body?.terminalPin !== undefined && !/^\d{4}$/.test(terminalPin ?? "");
      if (!merchantId || !name || name.length > 120 || (address && address.length > 240) || (phone && phone.length > 60) || timezone.length > 80 || hasInvalidIsActive || hasInvalidTerminalPin) {
        response.status(400).json({ error: "分店資料格式不正確" });
        return;
      }

      const merchantResult = await pool.query<{ store_code: string }>(
        "select store_code from merchants where id = $1",
        [merchantId],
      );
      const merchant = merchantResult.rows[0];
      if (!merchant) {
        response.status(404).json({ error: "找不到商家" });
        return;
      }

      const key = createBranchTerminalKey(merchant.store_code, terminalPin);
      const keyHash = hashTerminalKey(key);
      const branch = await withTransaction(async (client) => {
        const duplicate = await client.query("select 1 from terminal_credentials where key_hash = $1 limit 1", [keyHash]);
        if (duplicate.rows[0]) throw new Error("TERMINAL_KEY_EXISTS");

        const inserted = await client.query(
          `insert into branches (merchant_id, name, address, phone, timezone, is_active)
           values ($1, $2, $3, $4, $5, $6)
           returning id, name, address, phone, is_active, timezone, created_at`,
          [merchantId, name, address ?? null, phone ?? null, timezone, isActive],
        );
        await client.query("insert into branch_settings (branch_id) values ($1)", [inserted.rows[0].id]);
        await client.query(
          `insert into terminal_credentials (branch_id, key_hash, key_hint, is_active)
           values ($1, $2, $3, true)`,
          [inserted.rows[0].id, keyHash, `${merchant.store_code}••••`],
        );
        return inserted.rows[0];
      });

      response.status(201).json({
        branch: { ...branch, daily_redemption_limit: 2, theme_color: "teal", terminal_key_active: true, terminal_key_hint: `${merchant.store_code}••••` },
        key,
        keyHint: `${merchant.store_code}••••`,
        warning: "此金鑰只會顯示一次，請立即保存",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TERMINAL_KEY_EXISTS") {
        response.status(409).json({ error: "這組分店登入金鑰已被使用，請更換後 4 碼 PIN" });
        return;
      }
      next(error);
    }
  });

  router.patch("/branches/:branchId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const branchId = accountRequest.params.branchId as string;
      const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const has = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
      const name = requestBodyString(request, "name");
      const address = requestBodyString(request, "address");
      const phone = requestBodyString(request, "phone");
      const timezone = requestBodyString(request, "timezone");
      const isActive = requestBodyBoolean(request, "isActive");
      const invalid =
        (has("name") && (!name || name.length > 120)) ||
        (has("address") && address !== undefined && address.length > 240) ||
        (has("phone") && phone !== undefined && phone.length > 60) ||
        (has("timezone") && (!timezone || timezone.length > 80)) ||
        (has("isActive") && isActive === undefined);
      if (invalid || !["name", "address", "phone", "timezone", "isActive"].some(has)) {
        response.status(400).json({ error: "分店資料格式不正確" });
        return;
      }

      const updated = await withTransaction(async (client) => {
        const result = await client.query(
          `update branches
           set name = case when $1 then $2 else name end,
               address = case when $3 then $4 else address end,
               phone = case when $5 then $6 else phone end,
               timezone = case when $7 then $8 else timezone end,
               is_active = case when $9 then $10 else is_active end
           where id = $11 and merchant_id = $12
           returning id, name, address, phone, is_active, timezone, created_at, updated_at`,
          [has("name"), name ?? null, has("address"), address ?? null, has("phone"), phone ?? null, has("timezone"), timezone ?? null, has("isActive"), isActive ?? null, branchId, access.merchantId],
        );
        if (!result.rows[0]) return null;
        await client.query("insert into branch_settings (branch_id) values ($1) on conflict (branch_id) do nothing", [branchId]);
        if (has("isActive") && isActive === false) {
          await client.query("update terminal_sessions set revoked_at = coalesce(revoked_at, now()) where branch_id = $1 and revoked_at is null", [branchId]);
        }
        return result.rows[0];
      });

      if (!updated) {
        response.status(404).json({ error: "找不到分店" });
        return;
      }
      response.json({ branch: updated });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/branches/:branchId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const branchId = accountRequest.params.branchId as string;
      const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const transactionResult = await pool.query<{ count: string }>(
        "select count(*)::text as count from point_transactions where branch_id = $1",
        [branchId],
      );
      if (Number(transactionResult.rows[0]?.count ?? 0) > 0) {
        response.status(409).json({ error: "此分店已有交易紀錄，請改用停用分店" });
        return;
      }

      const assetResult = await pool.query<{ objectKey: string }>(
        `select object_key as "objectKey"
         from media_assets
         where branch_id = $1`,
        [branchId],
      );
      const result = await pool.query(
        "delete from branches where id = $1 and merchant_id = $2",
        [branchId, access.merchantId],
      );
      if (result.rowCount) {
        await Promise.all(assetResult.rows.map(async (asset) => {
          try {
            await deleteObject(asset.objectKey);
          } catch (cleanupError) {
            // The branch metadata is already deleted; retain a warning for operational cleanup.
            console.warn("BRANCH_MEDIA_STORAGE_CLEANUP_FAILED", { branchId, cleanupError });
          }
        }));
      }
      response.status(result.rowCount ? 204 : 404).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/branches", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, queryString(request, "merchantId"));
      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }

      const merchantResult = await pool.query<{ store_code: string }>(
        "select store_code from merchants where id = $1",
        [merchantId],
      );
      const merchant = merchantResult.rows[0];
      if (!merchant) {
        response.status(404).json({ error: "找不到商家" });
        return;
      }

      const result = await pool.query(
        `select
           b.id,
           b.name,
           b.address,
           b.phone,
           b.is_active,
           b.timezone,
           bs.daily_redemption_limit,
           bs.theme_color,
           bs.reset_interval,
           bs.reminder_interval,
           bs.enable_confetti,
           bs.enable_sound,
           bs.point_collection_effect,
           bs.redemption_effect,
           bs.screensaver_timeout,
           bs.logo_asset_id,
           bs.screensaver_asset_id,
           tc.key_hint as terminal_key_hint,
           tc.created_at as terminal_key_created_at,
           coalesce(tc.is_active, false) as terminal_key_active
         from branches b
         left join branch_settings bs on bs.branch_id = b.id
         left join lateral (
           select key_hint, created_at, is_active
           from terminal_credentials
           where branch_id = b.id
           order by created_at desc
           limit 1
         ) tc on true
         where b.merchant_id = $1
         order by b.created_at asc`,
        [merchantId],
      );

      response.json({ merchantId, storeCode: merchant.store_code, branches: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/branches/:branchId/settings", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const account = accountRequest.auth;
      const branchId = accountRequest.params.branchId;
      const branchResult = await pool.query<{ merchant_id: string }>(
        "select merchant_id from branches where id = $1",
        [branchId],
      );
      const branch = branchResult.rows[0];
      if (!branch) {
        response.status(404).json({ error: "找不到分店" });
        return;
      }
      if (!account || (account.role !== "admin" && !account.merchantIds.includes(branch.merchant_id))) {
        response.status(403).json({ error: "沒有此分店的設定權限" });
        return;
      }

      const dailyRedemptionLimit = requestBodyInteger(request, "dailyRedemptionLimit", { min: 0, max: 10 });
      const resetInterval = requestBodyInteger(request, "resetInterval", { min: 0, max: 86400 });
      const reminderInterval = requestBodyInteger(request, "reminderInterval", { min: 0, max: 86400 });
      const screensaverTimeout = requestBodyInteger(request, "screensaverTimeout", { min: 0, max: 86400 });
      const numericValues = [dailyRedemptionLimit, resetInterval, reminderInterval, screensaverTimeout];
      const body = request.body as Record<string, unknown> | undefined;
      const hasInvalidNumericValue = ["dailyRedemptionLimit", "resetInterval", "reminderInterval", "screensaverTimeout"]
        .some((key, index) => body?.[key] !== undefined && numericValues[index] === undefined);
      if (hasInvalidNumericValue) {
        response.status(400).json({ error: "分店數值設定超出允許範圍" });
        return;
      }

      const name = requestBodyString(request, "name");
      const address = requestBodyString(request, "address");
      const phone = requestBodyString(request, "phone");
      const timezone = requestBodyString(request, "timezone");
      const themeColor = requestBodyString(request, "themeColor");
      const pointCollectionEffect = requestBodyString(request, "pointCollectionEffect");
      const redemptionEffect = requestBodyString(request, "redemptionEffect");
      const enableConfetti = requestBodyBoolean(request, "enableConfetti");
      const enableSound = requestBodyBoolean(request, "enableSound");
      if (themeColor && !/^[a-z0-9_-]{1,32}$/i.test(themeColor)) {
        response.status(400).json({ error: "主題色格式不正確" });
        return;
      }
      if ((pointCollectionEffect && pointCollectionEffect.length > 32) || (redemptionEffect && redemptionEffect.length > 32)) {
        response.status(400).json({ error: "動畫效果設定格式不正確" });
        return;
      }
      if (pointCollectionEffect && !allowedPointCollectionEffects.has(pointCollectionEffect)) {
        response.status(400).json({ error: "集點動畫效果格式不正確" });
        return;
      }
      if (redemptionEffect && !allowedRedemptionEffects.has(redemptionEffect)) {
        response.status(400).json({ error: "兌換動畫效果格式不正確" });
        return;
      }

      await withTransaction(async (client) => {
        await client.query(
          `update branches
           set name = coalesce($1, name), address = coalesce($2, address), phone = coalesce($3, phone), timezone = coalesce($4, timezone)
           where id = $5`,
          [name ?? null, address ?? null, phone ?? null, timezone ?? null, branchId],
        );
        await client.query(
          `insert into branch_settings (branch_id, daily_redemption_limit, theme_color, reset_interval, reminder_interval, enable_confetti, enable_sound, point_collection_effect, redemption_effect, screensaver_timeout)
           values ($1, coalesce($2, 2), coalesce($3, 'teal'), coalesce($4, 10), coalesce($5, 10), coalesce($6, true), coalesce($7, true), coalesce($8, 'shower'), coalesce($9, 'confetti'), coalesce($10, 0))
           on conflict (branch_id) do update set
             daily_redemption_limit = coalesce($2, branch_settings.daily_redemption_limit),
             theme_color = coalesce($3, branch_settings.theme_color),
             reset_interval = coalesce($4, branch_settings.reset_interval),
             reminder_interval = coalesce($5, branch_settings.reminder_interval),
             enable_confetti = coalesce($6, branch_settings.enable_confetti),
             enable_sound = coalesce($7, branch_settings.enable_sound),
             point_collection_effect = coalesce($8, branch_settings.point_collection_effect),
             redemption_effect = coalesce($9, branch_settings.redemption_effect),
             screensaver_timeout = coalesce($10, branch_settings.screensaver_timeout)`,
          [branchId, dailyRedemptionLimit ?? null, themeColor ?? null, resetInterval ?? null, reminderInterval ?? null, enableConfetti ?? null, enableSound ?? null, pointCollectionEffect ?? null, redemptionEffect ?? null, screensaverTimeout ?? null],
        );
      });

      const updated = await pool.query(
        `select b.id, b.name, b.address, b.phone, b.is_active, b.timezone,
                bs.daily_redemption_limit, bs.theme_color, bs.reset_interval, bs.reminder_interval,
                bs.enable_confetti, bs.enable_sound, bs.point_collection_effect, bs.redemption_effect,
                bs.screensaver_timeout, bs.logo_asset_id, bs.screensaver_asset_id
         from branches b
         left join branch_settings bs on bs.branch_id = b.id
         where b.id = $1`,
        [branchId],
      );
      response.json({ branch: updated.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.post("/branches/:branchId/terminal-key", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const account = accountRequest.auth;
      const branchId = accountRequest.params.branchId;
      const branchResult = await pool.query<{ merchant_id: string; store_code: string }>(
        `select b.merchant_id, m.store_code
         from branches b
         join merchants m on m.id = b.merchant_id
         where b.id = $1`,
        [branchId],
      );
      const branch = branchResult.rows[0];
      if (!branch) {
        response.status(404).json({ error: "找不到分店" });
        return;
      }
      if (!account || (account.role !== "admin" && !account.merchantIds.includes(branch.merchant_id))) {
        response.status(403).json({ error: "沒有此分店的終端管理權限" });
        return;
      }

      const key = createBranchTerminalKey(branch.store_code);
      const keyHint = `${branch.store_code}••••`;
      const createdAt = await withTransaction(async (client) => {
        await client.query(
          "update terminal_credentials set is_active = false, revoked_at = coalesce(revoked_at, now()) where branch_id = $1 and is_active = true",
          [branchId],
        );
        await client.query(
          "update terminal_sessions set revoked_at = coalesce(revoked_at, now()) where branch_id = $1 and revoked_at is null",
          [branchId],
        );
        const inserted = await client.query<{ created_at: string }>(
          `insert into terminal_credentials (branch_id, key_hash, key_hint, is_active)
           values ($1, $2, $3, true)
           returning created_at`,
          [branchId, hashTerminalKey(key), keyHint],
        );
        return inserted.rows[0]?.created_at;
      });
      response.status(201).json({ key, keyHint, createdAt, warning: "此金鑰只會顯示一次，請立即保存" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/branches/:branchId/terminal-key/revoke", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const account = accountRequest.auth;
      const branchId = accountRequest.params.branchId;
      const branchResult = await pool.query<{ merchant_id: string }>(
        "select merchant_id from branches where id = $1",
        [branchId],
      );
      const branch = branchResult.rows[0];
      if (!branch) {
        response.status(404).json({ error: "找不到分店" });
        return;
      }
      if (!account || (account.role !== "admin" && !account.merchantIds.includes(branch.merchant_id))) {
        response.status(403).json({ error: "沒有此分店的終端管理權限" });
        return;
      }

      const revoked = await withTransaction(async (client) => {
        const result = await client.query(
          `update terminal_credentials
           set is_active = false, revoked_at = coalesce(revoked_at, now())
           where branch_id = $1 and is_active = true`,
          [branchId],
        );
        await client.query(
          "update terminal_sessions set revoked_at = coalesce(revoked_at, now()) where branch_id = $1 and revoked_at is null",
          [branchId],
        );
        return result.rowCount ?? 0;
      });
      response.json({ revoked });
    } catch (error) {
      next(error);
    }
  });

  router.get("/loyalty-options", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const branchId = queryString(request, "branchId");
      if (!branchId) {
        response.status(400).json({ error: "分店資訊不完整" });
        return;
      }
      const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const result = await pool.query(
        `select id, branch_id, type, label, value_points, display_order, is_active
         from loyalty_options
         where merchant_id = $1 and branch_id = $2
         order by display_order asc, created_at asc`,
        [access.merchantId, access.branchId],
      );

      response.json({ merchantId: access.merchantId, branchId: access.branchId, options: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.post("/loyalty-options", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const branchId = requestBodyString(request, "branchId");
      const type = requestBodyString(request, "type");
      const label = requestBodyString(request, "label");
      const valuePoints = requestBodyInteger(request, "valuePoints", { min: 1, max: 1_000_000 });
      const displayOrder = requestBodyInteger(request, "displayOrder", { min: 0, max: 10_000 }) ?? 0;
      const isActive = requestBodyBoolean(request, "isActive") ?? true;
      const body = request.body as Record<string, unknown> | undefined;
      const hasInvalidValuePoints = body?.valuePoints !== undefined && valuePoints === undefined;
      const hasInvalidDisplayOrder = body?.displayOrder !== undefined && requestBodyInteger(request, "displayOrder", { min: 0, max: 10_000 }) === undefined;
      const hasInvalidIsActive = body?.isActive !== undefined && requestBodyBoolean(request, "isActive") === undefined;
      if (!branchId || (type !== "add" && type !== "redeem") || !label || label.length > 80 || hasInvalidValuePoints || hasInvalidDisplayOrder || hasInvalidIsActive || valuePoints === undefined) {
        response.status(400).json({ error: "兌換項目資料格式不正確" });
        return;
      }

      const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const result = await pool.query(
        `insert into loyalty_options (merchant_id, branch_id, type, label, value_points, display_order, is_active)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, branch_id, type, label, value_points, display_order, is_active`,
        [access.merchantId, access.branchId, type, label, valuePoints, displayOrder, isActive],
      );
      response.status(201).json({ option: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/loyalty-options/:optionId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const optionId = accountRequest.params.optionId;
      const optionResult = await pool.query<{ merchant_id: string; branch_id: string }>(
        "select merchant_id, branch_id from loyalty_options where id = $1",
        [optionId],
      );
      const existing = optionResult.rows[0];
      if (!existing) {
        response.status(404).json({ error: "找不到兌換項目" });
        return;
      }

      const access = await resolveBranchAccess(pool, accountRequest.auth, existing.branch_id);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const has = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
      const type = requestBodyString(request, "type");
      const label = requestBodyString(request, "label");
      const valuePoints = requestBodyInteger(request, "valuePoints", { min: 1, max: 1_000_000 });
      const displayOrder = requestBodyInteger(request, "displayOrder", { min: 0, max: 10_000 });
      const isActive = requestBodyBoolean(request, "isActive");
      const invalid =
        (has("type") && type !== "add" && type !== "redeem") ||
        (has("label") && (!label || label.length > 80)) ||
        (has("valuePoints") && valuePoints === undefined) ||
        (has("displayOrder") && displayOrder === undefined) ||
        (has("isActive") && isActive === undefined);
      if (invalid || !["type", "label", "valuePoints", "displayOrder", "isActive"].some(has)) {
        response.status(400).json({ error: "兌換項目資料格式不正確" });
        return;
      }

      const result = await pool.query(
        `update loyalty_options
         set type = coalesce($1, type),
             label = coalesce($2, label),
             value_points = coalesce($3, value_points),
             display_order = coalesce($4, display_order),
             is_active = coalesce($5, is_active)
         where id = $6 and merchant_id = $7 and branch_id = $8
         returning id, branch_id, type, label, value_points, display_order, is_active`,
        [type ?? null, label ?? null, valuePoints ?? null, displayOrder ?? null, isActive ?? null, optionId, access.merchantId, access.branchId],
      );
      response.json({ option: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/loyalty-options/:optionId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const optionId = accountRequest.params.optionId;
      const optionResult = await pool.query<{ branch_id: string }>(
        "select branch_id from loyalty_options where id = $1",
        [optionId],
      );
      const existing = optionResult.rows[0];
      if (!existing) {
        response.status(404).json({ error: "找不到兌換項目" });
        return;
      }

      const access = await resolveBranchAccess(pool, accountRequest.auth, existing.branch_id);
      if ("status" in access) {
        response.status(access.status).json({ error: access.error });
        return;
      }

      const result = await pool.query(
        "delete from loyalty_options where id = $1 and merchant_id = $2 and branch_id = $3",
        [optionId, access.merchantId, access.branchId],
      );
      response.status(result.rowCount ? 204 : 404).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/customers", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const requestedMerchantId = queryString(request, "merchantId");
      const branchId = queryString(request, "branchId");
      let merchantId = resolveMerchantId(accountRequest, requestedMerchantId);

      if (branchId) {
        const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
        if ("status" in access) {
          response.status(access.status).json({ error: access.error });
          return;
        }
        if (requestedMerchantId && access.merchantId !== merchantId) {
          response.status(403).json({ error: "沒有此分店的會員查詢權限" });
          return;
        }
        merchantId = access.merchantId;
      }

      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }

      const search = queryString(request, "search") ?? queryString(request, "phone");
      const rawOffset = queryString(request, "offset");
      const offset = rawOffset === undefined ? 0 : Number(rawOffset);
      if (!Number.isInteger(offset) || offset < 0) {
        response.status(400).json({ error: "分頁位置格式不正確" });
        return;
      }

      const limit = clampLimit(queryString(request, "limit"), 20);
      const values: unknown[] = [merchantId];
      const conditions = ["c.merchant_id = $1"];
      const addValue = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };

      if (search) {
        const normalizedSearch = normalizePhone(search).replace(/[\\%_]/g, "\\$&");
        if (normalizedSearch) {
          conditions.push(`c.phone_normalized ilike ${addValue(`%${normalizedSearch}%`)} escape '\\'`);
        }
      }
      if (branchId) {
        conditions.push(`exists (
          select 1
          from point_transactions branch_transactions
          where branch_transactions.customer_id = c.id
            and branch_transactions.merchant_id = c.merchant_id
            and branch_transactions.branch_id = ${addValue(branchId)}
        )`);
      }

      const limitParameter = addValue(limit + 1);
      const offsetParameter = addValue(offset);
      const result = await pool.query(
        `select
           c.id,
           c.phone_display,
           c.points_balance,
           c.created_at,
           c.updated_at,
           count(pt.id)::int as transaction_count,
           max(pt.created_at) as last_transaction_at
         from customers c
         left join point_transactions pt
           on pt.customer_id = c.id and pt.merchant_id = c.merchant_id
         where ${conditions.join(" and ")}
         group by c.id
         order by c.updated_at desc, c.created_at desc, c.id asc
         limit ${limitParameter} offset ${offsetParameter}`,
        values,
      );

      const hasMore = result.rows.length > limit;
      response.json({
        merchantId,
        branchId: branchId ?? null,
        offset,
        limit,
        hasMore,
        customers: hasMore ? result.rows.slice(0, limit) : result.rows,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/customers/:customerId", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, queryString(request, "merchantId"));
      const customerId = accountRequest.params.customerId;
      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }
      if (!customerId) {
        response.status(400).json({ error: "會員資訊不完整" });
        return;
      }

      const customerResult = await pool.query(
        `select
           c.id,
           c.phone_display,
           c.points_balance,
           c.created_at,
           c.updated_at,
           count(pt.id)::int as transaction_count,
           max(pt.created_at) as last_transaction_at
         from customers c
         left join point_transactions pt
           on pt.customer_id = c.id and pt.merchant_id = c.merchant_id
         where c.id = $1 and c.merchant_id = $2
         group by c.id`,
        [customerId, merchantId],
      );
      const customer = customerResult.rows[0];
      if (!customer) {
        response.status(404).json({ error: "找不到會員" });
        return;
      }

      const rawOffset = queryString(request, "offset");
      const offset = rawOffset === undefined ? 0 : Number(rawOffset);
      if (!Number.isInteger(offset) || offset < 0) {
        response.status(400).json({ error: "分頁位置格式不正確" });
        return;
      }
      const limit = clampLimit(queryString(request, "limit"), 20);
      const transactions = await pool.query(
        `select
           pt.id,
           pt.branch_id,
           b.name as branch_name,
           pt.type,
           pt.amount,
           pt.delta,
           pt.balance_after,
           pt.actor_type,
           pt.created_at
         from point_transactions pt
         left join branches b on b.id = pt.branch_id
         where pt.customer_id = $1 and pt.merchant_id = $2
         order by pt.created_at desc
         limit $3 offset $4`,
        [customerId, merchantId, limit + 1, offset],
      );
      const hasMore = transactions.rows.length > limit;

      response.json({
        merchantId,
        customer: {
          ...customer,
          transaction_count: Number(customer.transaction_count),
        },
        offset,
        limit,
        hasMore,
        transactions: hasMore ? transactions.rows.slice(0, limit) : transactions.rows,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/transactions", async (request, response, next) => {
    try {
      const accountRequest = request as AccountRequest;
      const merchantId = resolveMerchantId(accountRequest, queryString(request, "merchantId"));
      if (!merchantId) {
        response.status(403).json({ error: "目前帳號沒有可用的商家" });
        return;
      }

      const branchId = queryString(request, "branchId");
      if (branchId) {
        const access = await resolveBranchAccess(pool, accountRequest.auth, branchId);
        if ("status" in access) {
          response.status(access.status).json({ error: access.error });
          return;
        }
        if (access.merchantId !== merchantId) {
          response.status(403).json({ error: "沒有此分店的交易查詢權限" });
          return;
        }
      }

      const type = queryString(request, "type");
      if (type && !["add", "redeem", "manual_redeem", "adjustment"].includes(type)) {
        response.status(400).json({ error: "交易類型格式不正確" });
        return;
      }
      const phone = queryString(request, "phone");
      const dateFrom = queryString(request, "dateFrom");
      const dateTo = queryString(request, "dateTo");
      if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) {
        response.status(400).json({ error: "日期格式不正確" });
        return;
      }

      const rawOffset = queryString(request, "offset");
      const offset = rawOffset === undefined ? 0 : Number(rawOffset);
      if (!Number.isInteger(offset) || offset < 0) {
        response.status(400).json({ error: "分頁位置格式不正確" });
        return;
      }

      const limit = clampLimit(queryString(request, "limit"), 20);
      const values: unknown[] = [merchantId];
      const conditions = ["pt.merchant_id = $1"];
      const addValue = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (branchId) conditions.push(`pt.branch_id = ${addValue(branchId)}`);
      if (type) conditions.push(`pt.type = ${addValue(type)}`);
      if (phone) conditions.push(`c.phone_normalized ilike ${addValue(`%${normalizePhone(phone)}%`)}`);
      if (dateFrom) conditions.push(`pt.created_at >= ${addValue(dateFrom)}`);
      if (dateTo) conditions.push(`pt.created_at <= ${addValue(dateTo)}`);

      const limitParameter = addValue(limit + 1);
      const offsetParameter = addValue(offset);
      const result = await pool.query(
        `select
           pt.id,
           pt.branch_id,
           pt.customer_id,
           c.phone_display,
           b.name as branch_name,
           pt.type,
           pt.amount,
           pt.delta,
           pt.balance_after,
           pt.actor_type,
           pt.created_at
         from point_transactions pt
         join customers c on c.id = pt.customer_id
         left join branches b on b.id = pt.branch_id
         where ${conditions.join(" and ")}
         order by pt.created_at desc
         limit ${limitParameter} offset ${offsetParameter}`,
        values,
      );

      const hasMore = result.rows.length > limit;
      response.json({ merchantId, offset, limit, hasMore, transactions: hasMore ? result.rows.slice(0, limit) : result.rows });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
