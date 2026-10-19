import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
const hostHeaders = await readFile(
  new URL("../dist/_headers", import.meta.url),
  "utf8",
);
const nginx = await readFile(
  new URL("../dist/deployment/security-headers.nginx.conf", import.meta.url),
  "utf8",
);
const reportOnly = hostHeaders.includes("Content-Security-Policy-Report-Only:");
const name = reportOnly
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";
const deploymentPolicy = hostHeaders
  .split("\n")
  .find((line) => line.trimStart().startsWith(name + ": "))
  .trim()
  .slice(name.length + 2);
assert.ok(deploymentPolicy.includes("script-src 'self'"));
assert.ok(!deploymentPolicy.includes("script-src 'self' 'unsafe-inline'"));
assert.ok(!deploymentPolicy.includes("unsafe-eval"));
assert.ok(!deploymentPolicy.includes("ws://localhost:*"));
assert.ok(deploymentPolicy.includes("frame-ancestors 'none'"));
assert.ok(hostHeaders.includes("Strict-Transport-Security: max-age=31536000"));
assert.ok(nginx.includes('add_header X-Frame-Options "DENY" always;'));
if (process.argv.includes("--release")) {
  assert.equal(
    reportOnly,
    false,
    "Release acceptance requires an enforced CSP",
  );
  for (const token of deploymentPolicy.split(/[;\s]+/u)) {
    if (!/^\w+:\/\//u.test(token)) continue;
    const url = new URL(token);
    assert.ok(
      ["https:", "wss:"].includes(url.protocol),
      "Release CSP must not contain insecure network origins",
    );
    assert.ok(
      !["localhost", "[::1]", "[::]", "0.0.0.0"].includes(
        url.hostname.replace(/\.$/u, ""),
      ) &&
        !url.hostname.replace(/\.$/u, "").endsWith(".localhost") &&
        !/^127\./u.test(url.hostname) &&
        !/^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/u.test(url.hostname),
      "Release CSP must not contain loopback endpoints",
    );
  }
}
const meta = html.match(
  /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/u,
);
if (reportOnly) assert.equal(meta, null);
else {
  assert.ok(meta, "Built HTML must retain an enforced meta CSP fallback");
  assert.ok(!meta[1].includes("frame-ancestors"));
  const scriptPosition = html.indexOf("<script");
  assert.ok(html.indexOf(meta[0]) < scriptPosition);
}
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length);
for (const [, attributes, body] of scripts) {
  assert.ok(
    /src="\/assets\//u.test(attributes),
    "Release scripts must be external same-origin assets",
  );
  assert.equal(body.trim(), "");
}
const scriptPath = scripts[0][1].match(/src="([^"]+)"/u)[1];
function address(server) {
  const value = server.httpServer.address();
  assert.ok(value && typeof value !== "string");
  return `http://127.0.0.1:${value.port}`;
}
function common(response) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(
    response.headers.get("permissions-policy").includes("camera=(self)"),
  );
  assert.equal(
    response.headers.get("strict-transport-security"),
    null,
    "Local HTTP preview/dev must not persist HSTS",
  );
}
const site = await preview({
  root,
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
try {
  const base = address(site);
  for (const path of [
    "/",
    "/cashier",
    "/menu/fixture/orders/fixture",
    scriptPath,
    "/missing-security-check.js",
  ]) {
    const response = await fetch(base + path, {
      headers: {
        Accept: path.includes("missing-security-check")
          ? "application/javascript"
          : "*/*",
      },
    });
    common(response);
    assert.equal(response.headers.get(name), deploymentPolicy);
    if (!path.includes("missing-security-check"))
      assert.equal(response.status, 200);
    else assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
} finally {
  await site.close();
}
const dev = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
try {
  await dev.listen();
  const response = await fetch(address(dev));
  common(response);
  assert.ok(
    response.headers.get(name).includes("script-src 'self' 'unsafe-inline'"),
  );
  assert.ok(response.headers.get(name).includes("ws://localhost:*"));
  await response.arrayBuffer();
} finally {
  await dev.close();
}
console.log(
  "Frontend security checks passed: release HTML/assets, host artifacts, preview SPA routes and 404s, local HTTP and development HMR policy. Browser CSP enforcement remains a separate check.",
);
