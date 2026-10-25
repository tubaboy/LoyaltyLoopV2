import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const mediaRoot = path.resolve(process.env.MEDIA_SYNC_PATH ?? "/var/lib/loyaltyloop/media");
const stateRoot = path.resolve(process.env.MEDIA_SYNC_STATE_PATH ?? "/var/lib/loyaltyloop/media-sync-state");
const stateFile = path.join(stateRoot, "missing-assets.json");
const token = process.env.MEDIA_SYNC_TOKEN ?? "";
const bindAddress = process.env.MEDIA_SYNC_BIND_ADDRESS ?? "127.0.0.1";
const port = Number(process.env.MEDIA_SYNC_PORT ?? 18765);
const deleteGraceMs = Math.max(86_400_000, Number(process.env.MEDIA_SYNC_DELETE_GRACE_MS ?? 604_800_000));
const maxObjectBytes = 6 * 1024 * 1024;

if (token.length < 32) throw new Error("MEDIA_SYNC_TOKEN must contain at least 32 characters");

function authorized(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7))
    : Buffer.alloc(0);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function send(response, status, body = "") {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function resolveObjectPath(objectKey) {
  if (
    typeof objectKey !== "string" || objectKey.length < 3 || objectKey.length > 512 ||
    objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.includes("\0")
  ) return null;
  const segments = objectKey.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(objectKey)) return null;
  const resolved = path.resolve(mediaRoot, ...segments);
  return resolved.startsWith(`${mediaRoot}${path.sep}`) ? resolved : null;
}

async function readRequest(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

async function objectDigest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function listObjectKeys(directory = mediaRoot, prefix = "") {
  const keys = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const childPath = path.join(directory, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) keys.push(...await listObjectKeys(childPath, key));
    else if (entry.isFile()) keys.push(key);
  }
  return keys;
}

async function readMissingState() {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function reconcileManifest(objectKeys) {
  const active = new Set(objectKeys);
  const current = await listObjectKeys();
  const missingSince = await readMissingState();
  const now = Date.now();
  let removed = 0;

  for (const key of current) {
    if (active.has(key)) {
      delete missingSince[key];
      continue;
    }
    const firstMissingAt = Number(missingSince[key] ?? now);
    missingSince[key] = firstMissingAt;
    if (now - firstMissingAt < deleteGraceMs) continue;
    const filePath = resolveObjectPath(key);
    if (filePath) {
      await rm(filePath, { force: true });
      removed += 1;
    }
    delete missingSince[key];
  }

  const existing = new Set(current);
  for (const key of Object.keys(missingSince)) {
    if (!existing.has(key)) delete missingSince[key];
  }
  await mkdir(stateRoot, { recursive: true });
  const temporaryState = `${stateFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryState, JSON.stringify(missingSince), { mode: 0o600 });
  await rename(temporaryState, stateFile);
  return removed;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://media-sync.local");
    if (request.method === "GET" && url.pathname === "/healthz") {
      send(response, 200, "ok\n");
      return;
    }
    if (!authorized(request)) {
      send(response, 401, "unauthorized\n");
      return;
    }

    const assetMatch = url.pathname.match(/^\/v1\/assets\/(.+)$/);
    if (assetMatch && ["HEAD", "PUT"].includes(request.method ?? "")) {
      let objectKey;
      try {
        objectKey = decodeURIComponent(assetMatch[1]);
      } catch {
        send(response, 400, "invalid object key\n");
        return;
      }
      const filePath = resolveObjectPath(objectKey);
      if (!filePath) {
        send(response, 400, "invalid object key\n");
        return;
      }

      if (request.method === "HEAD") {
        try {
          const details = await stat(filePath);
          const digest = await objectDigest(filePath);
          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Length": details.size,
            "X-Content-SHA256": digest,
          });
          response.end();
        } catch (error) {
          if (error?.code === "ENOENT") send(response, 404);
          else throw error;
        }
        return;
      }

      let body;
      try {
        body = await readRequest(request, maxObjectBytes);
      } catch (error) {
        send(response, error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400);
        return;
      }
      const digest = createHash("sha256").update(body).digest("hex");
      if (request.headers["x-content-sha256"] !== digest) {
        send(response, 400, "checksum mismatch\n");
        return;
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryFile = `${filePath}.sync-${randomUUID()}.tmp`;
      await writeFile(temporaryFile, body, { mode: 0o644 });
      await rename(temporaryFile, filePath);
      send(response, 204);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/manifest") {
      let manifest;
      try {
        manifest = JSON.parse((await readRequest(request, 1024 * 1024)).toString("utf8"));
      } catch {
        send(response, 400, "invalid manifest\n");
        return;
      }
      if (
        !manifest || !Array.isArray(manifest.objectKeys) || manifest.objectKeys.length > 10_000 ||
        manifest.objectKeys.some((key) => !resolveObjectPath(key))
      ) {
        send(response, 400, "invalid manifest\n");
        return;
      }
      const removed = await reconcileManifest(manifest.objectKeys);
      console.info(`MEDIA_SYNC_MANIFEST assets=${manifest.objectKeys.length} removed=${removed}`);
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, removed }));
      return;
    }

    send(response, 404, "not found\n");
  } catch {
    if (!response.headersSent) send(response, 500, "media sync failed\n");
    else response.destroy();
  }
});

server.listen(port, bindAddress, () => {
  console.info(`MEDIA_SYNC_LISTENING bind=${bindAddress} port=${port}`);
});
