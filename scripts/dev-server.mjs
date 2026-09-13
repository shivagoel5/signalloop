// Local preview: serves docs/ and sends /api/* requests to the same handler the Vercel functions use.
// Pages are served without their .html extension (/how-it-works), matching cleanUrls on Vercel.
// Without Upstash credentials, run history is kept in memory for as long as this process runs.

import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "../lib/api.mjs";

const root = new URL("../docs/", import.meta.url);
const port = Number(process.env.PORT) || 8888;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const response = await handler(new Request(url, {
      method: req.method,
      headers: { "Content-Type": req.headers["content-type"] ?? "application/json" },
      body,
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }

  const path = url.pathname === "/" ? "/index.html" : url.pathname.replace(/\/$/, "");
  const candidates = /\.[a-z0-9]+$/i.test(path) ? [path] : [`${path}.html`, `${path}/index.html`];
  for (const candidate of candidates) {
    const file = new URL(`.${candidate}`, root);
    if (!file.href.startsWith(root.href)) break;
    try {
      const data = await readFile(file);
      const ext = file.pathname.slice(file.pathname.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
      res.end(data);
      return;
    } catch {}
  }
  res.writeHead(404).end("Not found");
}).listen(port, () => console.log(`SignalLoop preview: http://localhost:${port}/#try`));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
