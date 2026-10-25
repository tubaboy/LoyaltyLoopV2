import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "../src/auth/password.js";

const { Pool } = pg;

type LegacyProfile = {
  id: string;
  role: string | null;
  created_at: Date | null;
};

type LegacyMerchant = {
  id: string;
  store_name: string;
  settings: Record<string, unknown> | null;
  created_at: Date | null;
  contact_person: string | null;
  contact_phone: string | null;
  contact_address: string | null;
  tax_id: string | null;
  email: string | null;
  recovery_password: string | null;
  status: string | null;
  store_code: string | null;
};

type LegacyBranch = {
  id: string;
  merchant_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean | null;
  created_at: Date | null;
  login_key: string | null;
  daily_redemption_limit: number;
  theme_color: string | null;
  reset_interval: number | null;
  enable_confetti: boolean | null;
  logo_url: string | null;
  enable_sound: boolean | null;
  point_collection_effect: string | null;
  redemption_effect: string | null;
  reminder_interval: number | null;
  screensaver_timeout: number | null;
  screensaver_url: string | null;
};

type LegacyCustomer = {
  id: string;
  merchant_id: string;
  phone: string;
  points: number;
  created_at: Date | null;
};

type LegacyOption = {
  id: string;
  merchant_id: string;
  branch_id: string | null;
  type: string;
  label: string;
  value: number;
  is_active: boolean | null;
  display_order: number | null;
  created_at: Date | null;
};

type LegacyTransaction = {
  id: string;
  merchant_id: string;
  customer_id: string;
  type: string;
  amount: number;
  created_at: Date | null;
  branch_id: string | null;
};

type MigrationReport = {
  profiles: number;
  merchants: number;
  branches: number;
  customers: number;
  loyaltyOptions: number;
  transactions: number;
  terminalCredentials: number;
  skippedLineBindings: number;
  skippedBindCodes: number;
  imageUrlsForReupload: number;
  legacyAdminProfilesSkipped: number;
  merchantAccountsImportedActive: number;
  merchantAccountsImportedInactive: number;
  merchantAccountsWithoutEmail: number;
  customersWithoutTransactions: number;
  customersWithPositiveBalanceWithoutTransactions: number;
  warnings: string[];
};

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
const apply = process.argv.includes("--apply");

if (!sourceUrl) {
  console.error("SOURCE_DATABASE_URL is required. The migration never guesses a source database.");
  process.exit(1);
}
if (!targetUrl) {
  console.error("TARGET_DATABASE_URL or DATABASE_URL is required.");
  process.exit(1);
}

const source = new Pool({ connectionString: sourceUrl, max: 4 });
const target = new Pool({ connectionString: targetUrl, max: 4 });

function trimOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePhone(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function mapStatus(value: string | null): "active" | "inactive" | "suspended" {
  if (value === "suspended") return "suspended";
  if (value === "inactive") return "inactive";
  return "active";
}

function mapTransactionType(value: string): "add" | "redeem" | "manual_redeem" {
  if (value === "add" || value === "redeem" || value === "manual_redeem") return value;
  throw new Error(`Unsupported legacy transaction type: ${value}`);
}

function hashTerminalKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeStoreCode(value: string | null, merchantId: string): string {
  const code = trimOrNull(value)?.slice(0, 4);
  return code || `L${merchantId.replace(/-/g, "").slice(0, 3).toUpperCase()}`;
}

async function loadLegacyData() {
  const [profiles, merchants, branches, customers, loyaltyOptions, transactions, bindCodes, lineBindings] = await Promise.all([
    source.query<LegacyProfile>("select id, role, created_at from public.profiles order by created_at nulls last, id"),
    source.query<LegacyMerchant>("select id, store_name, settings, created_at, contact_person, contact_phone, contact_address, tax_id, email, recovery_password, status, store_code from public.merchants order by created_at nulls last, id"),
    source.query<LegacyBranch>("select id, merchant_id, name, address, phone, is_active, created_at, login_key, daily_redemption_limit, theme_color, reset_interval, enable_confetti, logo_url, enable_sound, point_collection_effect, redemption_effect, reminder_interval, screensaver_timeout, screensaver_url from public.branches order by created_at nulls last, id"),
    source.query<LegacyCustomer>("select id, merchant_id, phone, points, created_at from public.customers order by created_at nulls last, id"),
    source.query<LegacyOption>("select id, merchant_id, branch_id, type, label, value, is_active, display_order, created_at from public.loyalty_options order by created_at nulls last, id"),
    source.query<LegacyTransaction>("select id, merchant_id, customer_id, type, amount, created_at, branch_id from public.transactions order by customer_id, created_at nulls last, id"),
    source.query<{ count: string }>("select count(*)::text as count from public.merchant_bind_codes"),
    source.query<{ count: string }>("select count(*)::text as count from public.merchant_line_bindings"),
  ]);

  return {
    profiles: profiles.rows,
    merchants: merchants.rows,
    branches: branches.rows,
    customers: customers.rows,
    loyaltyOptions: loyaltyOptions.rows,
    transactions: transactions.rows,
    bindCodeCount: Number(bindCodes.rows[0]?.count ?? 0),
    lineBindingCount: Number(lineBindings.rows[0]?.count ?? 0),
  };
}

function validateData(data: Awaited<ReturnType<typeof loadLegacyData>>): MigrationReport {
  const warnings: string[] = [];
  const merchantIds = new Set(data.merchants.map((merchant) => merchant.id));
  const branchIds = new Set(data.branches.map((branch) => branch.id));
  const customerIds = new Set(data.customers.map((customer) => customer.id));
  const profileIds = new Set(data.profiles.map((profile) => profile.id));
  const transactionCustomerIds = new Set(data.transactions.map((transaction) => transaction.customer_id));

  const emailSet = new Set<string>();
  let legacyAdminProfilesSkipped = 0;
  let merchantAccountsImportedActive = 0;
  let merchantAccountsImportedInactive = 0;
  let merchantAccountsWithoutEmail = 0;
  for (const profile of data.profiles) {
    if (profile.role === "admin") {
      // The public-only backup excludes Supabase Auth credentials.
      // Keep the existing V2 administrator account untouched.
      legacyAdminProfilesSkipped += 1;
      continue;
    }
    if (profile.role !== "merchant") continue;

    const merchant = data.merchants.find((item) => item.id === profile.id);
    const email = trimOrNull(merchant?.email ?? null)?.toLowerCase();
    if (!email) {
      merchantAccountsWithoutEmail += 1;
      continue;
    }
    let uniqueEmail = email;
    let suffix = 1;
    while (emailSet.has(uniqueEmail)) {
      uniqueEmail = email.replace("@", `+${suffix}@`);
      suffix += 1;
    }
    if (uniqueEmail !== email) warnings.push("Duplicate merchant account emails were disambiguated during import.");
    emailSet.add(uniqueEmail);
    if (trimOrNull(merchant?.recovery_password ?? null)) merchantAccountsImportedActive += 1;
    else merchantAccountsImportedInactive += 1;
  }

  for (const merchant of data.merchants) {
    if (!profileIds.has(merchant.id)) warnings.push("A merchant record has no matching profile; its account membership will be skipped.");
    if (!trimOrNull(merchant.store_code)) warnings.push(`Merchant ${merchant.id} has no store_code; a generated code will be used.`);
  }
  for (const branch of data.branches) {
    if (!merchantIds.has(branch.merchant_id)) throw new Error(`Branch ${branch.id} references a missing merchant.`);
    if (branch.logo_url || branch.screensaver_url) warnings.push("At least one branch has image URLs that require re-upload.");
  }
  for (const customer of data.customers) {
    if (!merchantIds.has(customer.merchant_id)) throw new Error(`Customer ${customer.id} references a missing merchant.`);
  }
  for (const option of data.loyaltyOptions) {
    if (!merchantIds.has(option.merchant_id)) throw new Error(`Loyalty option ${option.id} references a missing merchant.`);
    if (!option.branch_id || !branchIds.has(option.branch_id)) throw new Error(`Loyalty option ${option.id} has no valid branch_id.`);
    if (option.type !== "add" && option.type !== "redeem") throw new Error(`Loyalty option ${option.id} has unsupported type ${option.type}.`);
    if (option.value <= 0) throw new Error(`Loyalty option ${option.id} has a non-positive value.`);
  }

  const deltas = new Map<string, number>();
  for (const transaction of data.transactions) {
    if (!merchantIds.has(transaction.merchant_id)) throw new Error(`Transaction ${transaction.id} references a missing merchant.`);
    if (!customerIds.has(transaction.customer_id)) throw new Error(`Transaction ${transaction.id} references a missing customer.`);
    if (transaction.branch_id && !branchIds.has(transaction.branch_id)) throw new Error(`Transaction ${transaction.id} references a missing branch.`);
    const type = mapTransactionType(transaction.type);
    const delta = type === "add" ? transaction.amount : -transaction.amount;
    deltas.set(transaction.customer_id, (deltas.get(transaction.customer_id) ?? 0) + delta);
  }

  for (const customer of data.customers) {
    const startingBalance = customer.points - (deltas.get(customer.id) ?? 0);
    if (startingBalance < 0) warnings.push(`Customer ${customer.id} starts below zero when reconstructing transaction history; import will stop.`);
  }

  const customersWithoutTransactions = data.customers.filter((customer) => !transactionCustomerIds.has(customer.id));
  if (customersWithoutTransactions.some((customer) => customer.points > 0)) {
    warnings.push("Some customers have a current points snapshot but no legacy transactions; the snapshot is preserved without synthetic ledger rows.");
  }

  return {
    profiles: data.profiles.length,
    merchants: data.merchants.length,
    branches: data.branches.length,
    customers: data.customers.length,
    loyaltyOptions: data.loyaltyOptions.length,
    transactions: data.transactions.length,
    terminalCredentials: data.branches.filter((branch) => Boolean(trimOrNull(branch.login_key))).length,
    skippedLineBindings: data.lineBindingCount,
    skippedBindCodes: data.bindCodeCount,
    imageUrlsForReupload: data.branches.filter((branch) => Boolean(branch.logo_url || branch.screensaver_url)).length,
    legacyAdminProfilesSkipped,
    merchantAccountsImportedActive,
    merchantAccountsImportedInactive,
    merchantAccountsWithoutEmail,
    customersWithoutTransactions: customersWithoutTransactions.length,
    customersWithPositiveBalanceWithoutTransactions: customersWithoutTransactions.filter((customer) => customer.points > 0).length,
    warnings,
  };
}

async function importData(data: Awaited<ReturnType<typeof loadLegacyData>>): Promise<void> {
  const client = await target.connect();
  try {
    await client.query("begin");

    const profileById = new Map(data.profiles.map((profile) => [profile.id, profile]));
    const merchantById = new Map(data.merchants.map((merchant) => [merchant.id, merchant]));
    const usedEmails = new Set<string>();
    for (const profile of data.profiles) {
      if (profile.role !== "merchant") continue;
      const merchant = merchantById.get(profile.id);
      const baseEmail = trimOrNull(merchant?.email ?? null)?.toLowerCase();
      if (!merchant || !baseEmail) continue;
      let email = baseEmail;
      let suffix = 1;
      while (usedEmails.has(email)) {
        email = baseEmail.replace("@", `+${suffix}@`);
        suffix += 1;
      }
      usedEmails.add(email);
      const legacyPassword = trimOrNull(merchant.recovery_password);
      const passwordHash = await hashPassword(legacyPassword ?? randomBytes(32).toString("base64url"));
      await client.query(
        `insert into accounts (id, email, password_hash, role, status, created_at)
         values ($1, $2, $3, 'merchant', $4, coalesce($5, now()))
         on conflict (id) do update
         set email = excluded.email,
             role = excluded.role,
             password_hash = case when $6 then excluded.password_hash else accounts.password_hash end,
             status = case when $6 then excluded.status else accounts.status end`,
        [profile.id, email, passwordHash, legacyPassword ? "active" : "inactive", profile.created_at, Boolean(legacyPassword)],
      );
    }

    for (const merchant of data.merchants) {
      await client.query(
        `insert into merchants (id, store_name, store_code, contact_person, contact_phone, contact_address, tax_id, status, settings, legacy_source_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $11, coalesce($10, now()))
         on conflict (id) do update set store_name = excluded.store_name, store_code = excluded.store_code, status = excluded.status, settings = excluded.settings`,
        [merchant.id, merchant.store_name, normalizeStoreCode(merchant.store_code, merchant.id), merchant.contact_person, merchant.contact_phone, merchant.contact_address, merchant.tax_id, mapStatus(merchant.status), merchant.settings ?? {}, merchant.created_at, merchant.id],
      );

      if (profileById.get(merchant.id)?.role === "merchant") {
        await client.query(
          `insert into merchant_members (account_id, merchant_id, membership_role)
           values ($1, $2, 'owner')
           on conflict (account_id, merchant_id) do update set membership_role = excluded.membership_role`,
          [merchant.id, merchant.id],
        );
      }
    }

    for (const branch of data.branches) {
      await client.query(
        `insert into branches (id, merchant_id, name, address, phone, is_active, timezone, legacy_source_id, created_at)
         values ($1, $2, $3, $4, $5, coalesce($6, true), 'Asia/Taipei', $8, coalesce($7, now()))
         on conflict (id) do update set name = excluded.name, address = excluded.address, phone = excluded.phone, is_active = excluded.is_active`,
        [branch.id, branch.merchant_id, branch.name, branch.address, branch.phone, branch.is_active, branch.created_at, branch.id],
      );
      await client.query(
        `insert into branch_settings (branch_id, daily_redemption_limit, theme_color, reset_interval, reminder_interval, enable_confetti, enable_sound, point_collection_effect, redemption_effect, screensaver_timeout)
         values ($1, $2, coalesce($3, 'teal'), coalesce($4, 10), coalesce($5, 10), coalesce($6, true), coalesce($7, true), coalesce($8, 'shower'), coalesce($9, 'confetti'), greatest(coalesce($10, 0), 0))
         on conflict (branch_id) do update set daily_redemption_limit = excluded.daily_redemption_limit, theme_color = excluded.theme_color, reset_interval = excluded.reset_interval, reminder_interval = excluded.reminder_interval, enable_confetti = excluded.enable_confetti, enable_sound = excluded.enable_sound, point_collection_effect = excluded.point_collection_effect, redemption_effect = excluded.redemption_effect, screensaver_timeout = excluded.screensaver_timeout`,
        [branch.id, Math.max(0, Math.min(branch.daily_redemption_limit ?? 2, 10)), branch.theme_color, branch.reset_interval, branch.reminder_interval, branch.enable_confetti, branch.enable_sound, branch.point_collection_effect, branch.redemption_effect, branch.screensaver_timeout],
      );

      const loginKey = trimOrNull(branch.login_key);
      if (loginKey) {
        await client.query("update terminal_credentials set is_active = false, revoked_at = coalesce(revoked_at, now()) where branch_id = $1 and is_active = true", [branch.id]);
        await client.query(
          `insert into terminal_credentials (branch_id, key_hash, key_hint, is_active, created_at)
           values ($1, $2, $3, true, coalesce($4, now()))
           on conflict (key_hash) do update set branch_id = excluded.branch_id, key_hint = excluded.key_hint, is_active = true, revoked_at = null`,
          [branch.id, hashTerminalKey(loginKey.toUpperCase()), `••••${loginKey.slice(-2).toUpperCase()}`, branch.created_at],
        );
      }
    }

    for (const customer of data.customers) {
      const phone = normalizePhone(customer.phone);
      await client.query(
        `insert into customers (id, merchant_id, phone_normalized, phone_display, points_balance, legacy_source_id, created_at)
         values ($1, $2, $3, $4, greatest($5, 0), $7, coalesce($6, now()))
         on conflict (id) do update set phone_normalized = excluded.phone_normalized, phone_display = excluded.phone_display, points_balance = excluded.points_balance`,
        [customer.id, customer.merchant_id, phone, customer.phone, customer.points, customer.created_at, customer.id],
      );
    }

    for (const option of data.loyaltyOptions) {
      await client.query(
        `insert into loyalty_options (id, merchant_id, branch_id, type, label, value_points, is_active, display_order, created_at)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, true), coalesce($8, 0), coalesce($9, now()))
         on conflict (id) do update set label = excluded.label, value_points = excluded.value_points, is_active = excluded.is_active, display_order = excluded.display_order`,
        [option.id, option.merchant_id, option.branch_id, option.type, option.label, option.value, option.is_active, option.display_order, option.created_at],
      );
    }

    const deltas = new Map<string, number>();
    for (const transaction of data.transactions) {
      const type = mapTransactionType(transaction.type);
      const delta = type === "add" ? transaction.amount : -transaction.amount;
      deltas.set(transaction.customer_id, (deltas.get(transaction.customer_id) ?? 0) + delta);
    }
    const runningBalances = new Map<string, number>();
    for (const customer of data.customers) runningBalances.set(customer.id, customer.points - (deltas.get(customer.id) ?? 0));

    for (const transaction of data.transactions) {
      const type = mapTransactionType(transaction.type);
      const delta = type === "add" ? transaction.amount : -transaction.amount;
      const nextBalance = (runningBalances.get(transaction.customer_id) ?? 0) + delta;
      if (nextBalance < 0) throw new Error(`Cannot import transaction ${transaction.id}: reconstructed balance is negative.`);
      runningBalances.set(transaction.customer_id, nextBalance);
      await client.query(
        `insert into point_transactions (id, merchant_id, branch_id, customer_id, type, amount, delta, balance_after, actor_type, idempotency_key, metadata, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'import', $9, $10, coalesce($11, now()))
         on conflict (id) do update set type = excluded.type, amount = excluded.amount, delta = excluded.delta, balance_after = excluded.balance_after, metadata = excluded.metadata`,
        [transaction.id, transaction.merchant_id, transaction.branch_id, transaction.customer_id, type, transaction.amount, delta, nextBalance, `legacy:${transaction.id}`, { source: "LoyaltyLoop", legacy_id: transaction.id }, transaction.created_at],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    const data = await loadLegacyData();
    const report = validateData(data);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", report }, null, 2));
    if (report.warnings.length > 0) console.warn("Migration warnings were reported above; review them before deployment.");
    if (!apply) return;
    await importData(data);
    console.log("Migration committed to the configured local V2 target.");
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error("Legacy migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
