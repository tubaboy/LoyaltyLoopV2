import { createHash } from "node:crypto";
import type pg from "pg";
import { getObject } from "./storage.js";

const endpoint = process.env.MEDIA_SYNC_URL?.replace(/\/$/, "");
const token = process.env.MEDIA_SYNC_TOKEN;
const intervalMs = 60_000;
let syncRunning = false;
let syncRequestedAgain = false;

async function objectBuffer(objectKey: string): Promise<Buffer> {
  const stored = await getObject(objectKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stored.body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function syncAssets(pool: pg.Pool): Promise<void> {
  if (!endpoint || !token) return;

  const result = await pool.query<{ object_key: string }>(
    "select object_key from media_assets order by object_key",
  );
  const keys = result.rows.map((row) => row.object_key);
  let uploaded = 0;

  for (const objectKey of keys) {
    const body = await objectBuffer(objectKey);
    const digest = createHash("sha256").update(body).digest("hex");
    const encodedKey = encodeURIComponent(objectKey);
    const headers = { Authorization: `Bearer ${token}` };
    const remote = await fetch(`${endpoint}/v1/assets/${encodedKey}`, {
      method: "HEAD",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!remote.ok && remote.status !== 404) {
      throw new Error(`standby media check returned HTTP ${remote.status}`);
    }

    if (remote.status === 404 || remote.headers.get("x-content-sha256") !== digest) {
      const response = await fetch(`${endpoint}/v1/assets/${encodedKey}`, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "X-Content-SHA256": digest,
        },
          body: new Uint8Array(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`standby media upload returned HTTP ${response.status}`);
      }
      uploaded += 1;
    }
  }

  const manifest = await fetch(`${endpoint}/v1/manifest`, {
    method: "POST",
    headers: {
      ...{ Authorization: `Bearer ${token}` },
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ objectKeys: keys }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!manifest.ok) {
    throw new Error(`standby media manifest returned HTTP ${manifest.status}`);
  }

  console.info(`MEDIA_SYNC_OK assets=${keys.length} uploaded=${uploaded}`);
}

async function runSync(pool: pg.Pool): Promise<void> {
  if (!endpoint && !token) return;
  if (!endpoint || !token) {
    console.error("MEDIA_SYNC_CONFIG_INCOMPLETE");
    return;
  }
  if (syncRunning) {
    syncRequestedAgain = true;
    return;
  }

  syncRunning = true;
  try {
    do {
      syncRequestedAgain = false;
      await syncAssets(pool);
    } while (syncRequestedAgain);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`MEDIA_SYNC_FAILED ${message}`);
  } finally {
    syncRunning = false;
  }
}

export function startMediaSync(pool: pg.Pool): void {
  if (!endpoint && !token) return;
  setTimeout(() => void runSync(pool), 3_000).unref();
  setInterval(() => void runSync(pool), intervalMs).unref();
}

export function requestMediaSync(pool: pg.Pool): void {
  if (!endpoint && !token) return;
  if (syncRunning) {
    syncRequestedAgain = true;
    return;
  }
  // The API's periodic full reconciliation retries failures without holding up uploads.
  setTimeout(() => void runSync(pool), 1_000).unref();
}
