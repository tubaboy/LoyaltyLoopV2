import type { Request } from "express";

export function requestBodyString(
  request: Request,
  key: string,
): string | undefined {
  const value = (request.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value.trim() : undefined;
}

export function requestBodyPositiveInteger(
  request: Request,
  key: string,
  fallback?: number,
): number | undefined {
  const value = (request.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined && fallback !== undefined) return fallback;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function requestBodyInteger(
  request: Request,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const value = (request.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null || value === "") return undefined;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (options.min !== undefined && parsed < options.min) return undefined;
  if (options.max !== undefined && parsed > options.max) return undefined;
  return parsed;
}

export function requestBodyBoolean(
  request: Request,
  key: string,
): boolean | undefined {
  const value = (request.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function queryString(request: Request, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === "string" ? value.trim() : undefined;
}

export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "");
}

export function clampLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}
