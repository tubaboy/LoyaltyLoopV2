import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function pwaServiceWorkerPlugin() {
  return {
    name: "loyaltyloop-pwa-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const bundledAssets = Object.keys(bundle)
        .filter((fileName) => /\.(?:js|css|woff2?|png|svg|webp)$/i.test(fileName))
        .map((fileName) => `/${fileName}`);
      const precacheUrls = [...new Set([
        "/index.html",
        "/offline.html",
        "/manifest.webmanifest",
        "/logo.png",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        ...bundledAssets,
      ])];
      const workerTemplate = `const CACHE_NAME = "__CACHE_NAME__";
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};
const APP_SHELL_URL = "/index.html";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames
        .filter((cacheName) => cacheName.indexOf("loyaltyloop-v2-") === 0 && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "APPLY_UPDATE") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(APP_SHELL_URL)) || (await cache.match(OFFLINE_URL));
      }),
    );
    return;
  }

  if (PRECACHE_URLS.indexOf(url.pathname) !== -1) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(request).then((cachedResponse) => cachedResponse || fetch(request))),
    );
  }
});
`;
      const versionHash = createHash("sha256").update(workerTemplate);
      [
        "./public/manifest.webmanifest",
        "./public/offline.html",
        "./public/logo.png",
        "./public/icons/icon-192.png",
        "./public/icons/icon-512.png",
      ].forEach((assetPath) => versionHash.update(readFileSync(new URL(assetPath, import.meta.url))));
      const version = versionHash.digest("hex").slice(0, 12);
      const workerSource = workerTemplate.replace("__CACHE_NAME__", `loyaltyloop-v2-${version}`);

      this.emitFile({ type: "asset", fileName: "sw.js", source: workerSource });
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaServiceWorkerPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});

