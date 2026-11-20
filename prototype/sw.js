"use strict";

const cacheName = "traverse-offline-v23";
const shell = new URL("./index.html", self.location).href;
const homePath = new URL("./", self.location).pathname;
const firebase = "https://www.gstatic.com/firebasejs/13.4.0/";
const files = [
  shell,
  ...["style.css", "config.js", "hint-cases.js?v=16", "app.js?v=23", "firebase-tutor.mjs?v=7"]
    .map((path) => new URL(path, self.location).href),
  ...["firebase-app.js", "firebase-app-check.js", "firebase-ai.js"].map((file) => firebase + file),
];
const cachedFiles = new Set(files);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(
    files.map((url) => new Request(url, { mode: "cors", cache: "reload" })),
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("traverse-offline-") && key !== cacheName)
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin
    && (url.pathname === homePath || url.pathname === new URL(shell).pathname)) {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.open(cacheName)).match(shell).then((response) => response || Response.error())));
  } else if (cachedFiles.has(request.url)) {
    event.respondWith(caches.open(cacheName).then(async (cache) =>
      (await cache.match(request)) || fetch(request)));
  }
});
