import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";

const ACCOUNT_COOKIE = "loyaltyloop_v2_session";
const TERMINAL_COOKIE = "loyaltyloop_v2_terminal_session";
const ACCOUNT_SESSION_TTL_SECONDS = 60 * 60 * 12;
const TERMINAL_SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AccountRole = "admin" | "merchant";

export interface AccountAuthContext {
  accountId: string;
  email: string;
  role: AccountRole;
  merchantIds: string[];
  sessionId: string;
}

export interface TerminalAuthContext {
  sessionId: string;
  branchId: string;
  merchantId: string;
  branchName: string;
  storeName: string;
  isActive: boolean;
  dailyRedemptionLimit: number;
  themeColor: string;
  resetInterval: number;
  reminderInterval: number;
  enableConfetti: boolean;
  enableSound: boolean;
  pointCollectionEffect: string;
  redemptionEffect: string;
  screensaverTimeout: number;
  logoAssetId: string | null;
  screensaverAssetId: string | null;
}

export type AccountRequest = Request & {
  auth?: AccountAuthContext;
};

export type TerminalRequest = Request & {
  terminal?: TerminalAuthContext;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = request.headers.cookie;

  if (!header) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies.set(key, decodeURIComponent(value));
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; httpOnly?: boolean } = {},
): string {
  const secure = process.env.COOKIE_SECURE === "true";
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
  ];

  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) attributes.push("HttpOnly");
  if (secure) attributes.push("Secure");

  return attributes.join("; ");
}

function setCookie(response: Response, name: string, value: string, maxAge: number) {
  response.append("Set-Cookie", serializeCookie(name, value, { maxAge }));
}

function clearCookie(response: Response, name: string) {
  response.append("Set-Cookie", serializeCookie(name, "", { maxAge: 0 }));
}

export function setAccountCookie(response: Response, token: string): void {
  setCookie(response, ACCOUNT_COOKIE, token, ACCOUNT_SESSION_TTL_SECONDS);
}

export function clearAccountCookie(response: Response): void {
  clearCookie(response, ACCOUNT_COOKIE);
}

export function setTerminalCookie(response: Response, token: string): void {
  setCookie(response, TERMINAL_COOKIE, token, TERMINAL_SESSION_TTL_SECONDS);
}

export function clearTerminalCookie(response: Response): void {
  clearCookie(response, TERMINAL_COOKIE);
}

export async function createAccountSession(
  pool: pg.Pool,
  accountId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await pool.query(
    `insert into sessions (account_id, token_hash, expires_at)
     values ($1, $2, now() + interval '12 hours')`,
    [accountId, hashToken(token)],
  );

  return token;
}

export async function createTerminalSession(
  pool: pg.Pool,
  branchId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await pool.query(
    `insert into terminal_sessions (branch_id, token_hash, expires_at)
     values ($1, $2, now() + interval '8 hours')`,
    [branchId, hashToken(token)],
  );

  return token;
}

export async function revokeAccountSession(
  pool: pg.Pool,
  request: Request,
): Promise<void> {
  const token = parseCookies(request).get(ACCOUNT_COOKIE);
  if (!token) return;

  await pool.query(
    "update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [hashToken(token)],
  );
}

export async function revokeTerminalSession(
  pool: pg.Pool,
  request: Request,
): Promise<void> {
  const token = parseCookies(request).get(TERMINAL_COOKIE);
  if (!token) return;

  await pool.query(
    "update terminal_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [hashToken(token)],
  );
}

export async function getAccountContext(
  pool: pg.Pool,
  request: Request,
): Promise<AccountAuthContext | null> {
  const token = parseCookies(request).get(ACCOUNT_COOKIE);
  if (!token) return null;

  const result = await pool.query<{
    session_id: string;
    account_id: string;
    email: string;
    role: AccountRole;
    merchant_ids: string[] | null;
  }>(
    `select
       s.id as session_id,
       a.id as account_id,
       a.email,
       a.role,
       coalesce(array_agg(mm.merchant_id) filter (where mm.merchant_id is not null), '{}') as merchant_ids
     from sessions s
     join accounts a on a.id = s.account_id
     left join merchant_members mm on mm.account_id = a.id
     where s.token_hash = $1
       and s.revoked_at is null
       and s.expires_at > now()
       and a.status = 'active'
     group by s.id, a.id, a.email, a.role`,
    [hashToken(token)],
  );

  const account = result.rows[0];
  if (!account) return null;

  return {
    accountId: account.account_id,
    email: account.email,
    role: account.role,
    merchantIds: account.merchant_ids ?? [],
    sessionId: account.session_id,
  };
}

export async function getTerminalContext(
  pool: pg.Pool,
  request: Request,
): Promise<TerminalAuthContext | null> {
  const token = parseCookies(request).get(TERMINAL_COOKIE);
  if (!token) return null;

  return getTerminalContextByToken(pool, token);
}

export async function getTerminalContextByToken(
  pool: pg.Pool,
  token: string,
): Promise<TerminalAuthContext | null> {

  const result = await pool.query<TerminalAuthContext>(
    `select
       ts.id as "sessionId",
       b.id as "branchId",
       b.merchant_id as "merchantId",
       b.name as "branchName",
       m.store_name as "storeName",
       b.is_active as "isActive",
       coalesce(bs.daily_redemption_limit, 2)::int as "dailyRedemptionLimit",
       coalesce(bs.theme_color, 'teal') as "themeColor",
       coalesce(bs.reset_interval, 10)::int as "resetInterval",
       coalesce(bs.reminder_interval, 10)::int as "reminderInterval",
       coalesce(bs.enable_confetti, true) as "enableConfetti",
       coalesce(bs.enable_sound, true) as "enableSound",
       coalesce(bs.point_collection_effect, 'shower') as "pointCollectionEffect",
       coalesce(bs.redemption_effect, 'confetti') as "redemptionEffect",
       coalesce(bs.screensaver_timeout, 0)::int as "screensaverTimeout",
       bs.logo_asset_id as "logoAssetId",
       bs.screensaver_asset_id as "screensaverAssetId"
     from terminal_sessions ts
     join branches b on b.id = ts.branch_id
     join merchants m on m.id = b.merchant_id
     left join branch_settings bs on bs.branch_id = b.id
     where ts.token_hash = $1
       and ts.revoked_at is null
       and ts.expires_at > now()`,
    [hashToken(token)],
  );

  return result.rows[0] ?? null;
}

export const requireAccount: RequestHandler = async (
  request,
  response,
  next: NextFunction,
) => {
  try {
    const context = await getAccountContext((request as AccountRequest).app.locals.pool, request);
    if (!context) {
      response.status(401).json({ error: "未登入或登入已過期" });
      return;
    }

    (request as AccountRequest).auth = context;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireTerminal: RequestHandler = async (
  request,
  response,
  next: NextFunction,
) => {
  try {
    const context = await getTerminalContext(
      (request as TerminalRequest).app.locals.pool,
      request,
    );
    if (!context) {
      response.status(401).json({ error: "終端尚未登入或工作階段已過期" });
      return;
    }

    if (!context.isActive) {
      response.status(403).json({ error: "此分店目前暫停營運" });
      return;
    }

    (request as TerminalRequest).terminal = context;
    next();
  } catch (error) {
    next(error);
  }
};
