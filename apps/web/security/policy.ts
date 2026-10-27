type Environment = Record<string, string | undefined>;
export type HeaderMap = Record<string, string>;

function origin(
  value: string,
  name: string,
  production: boolean,
  connection = false,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an explicit URL/origin.`);
  }
  const protocols = connection
    ? ["https:", "http:", "wss:", "ws:"]
    : ["https:", "http:"];
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  // URL canonicalizes IPv4-mapped IPv6 to hex (127.0.0.1 -> ::ffff:7f00:1).
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    ["[::1]", "[::]", "0.0.0.0"].includes(hostname) ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/u.test(hostname);
  if (
    !protocols.includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.[\]:-]+$/iu.test(url.hostname) ||
    (production && local) ||
    ((production || !local) &&
      (url.protocol === "http:" || url.protocol === "ws:"))
  ) {
    throw new Error(
      `${name} must use a safe HTTPS origin. Loopback endpoints are only allowed in local builds/development; configure the real deployment endpoint for a release build.`,
    );
  }
  return url.origin;
}
function origins(
  value: string | undefined,
  name: string,
  production: boolean,
  connection = false,
): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => {
    const raw = entry.trim();
    const result = origin(raw, name, production, connection);
    if (new URL(raw).pathname !== "/")
      throw new Error(`${name} accepts origins without paths.`);
    return result;
  });
}
export function frontendSecurity(
  env: Environment,
  development = false,
  production = !development,
) {
  const api = env.VITE_API_URL?.trim();
  // Relative API paths intentionally use the document origin; protocol-relative URLs are rejected.
  const apiOrigins =
    !api || (/^\/(?!\/)/u.test(api) && !/[\\\r\n]/u.test(api))
      ? []
      : [origin(api, "VITE_API_URL", production)];
  const supabase = env.VITE_SUPABASE_URL?.trim();
  const storage = supabase
    ? [origin(supabase, "VITE_SUPABASE_URL", production)]
    : [];
  const connections = [
    ...apiOrigins,
    ...storage,
    ...storage.map((value) => value.replace(/^http/u, "ws")),
    ...origins(
      env.VITE_CSP_CONNECT_ORIGINS,
      "VITE_CSP_CONNECT_ORIGINS",
      production,
      true,
    ),
  ];
  // CSP host-source grammar does not support bracketed IPv6 literals.
  // Use localhost (which can resolve to IPv6) or IPv4 for development HMR.
  if (development)
    connections.push("ws://localhost:*", "ws://127.0.0.1:*");
  const directives: Record<string, string[]> = {
    "default-src": ["'none'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    // Local phone simulators embed this app in a same-origin iframe. Keep
    // framing disabled in built/preview/deployed apps, regardless of viewport.
    "frame-src": development ? ["'self'"] : ["'none'"],
    "frame-ancestors": development ? ["'self'"] : ["'none'"],
    "form-action": ["'self'"],
    "script-src": development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "script-src-attr": ["'none'"],
    // React uses style attributes for shop branding/charts. Restrict style elements separately.
    "style-src": ["'self'", "'unsafe-inline'"],
    "style-src-elem": development ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "style-src-attr": ["'unsafe-inline'"],
    "font-src": ["'self'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...storage,
      ...origins(
        env.VITE_CSP_IMAGE_ORIGINS,
        "VITE_CSP_IMAGE_ORIGINS",
        production,
      ),
    ],
    "connect-src": ["'self'", ...connections],
    "media-src": ["'self'", "blob:"],
    // Vite's development client uses a blob worker for its connection timer.
    "worker-src": development ? ["blob:"] : ["'none'"],
    "manifest-src": ["'self'"],
  };
  // Lazy authentication challenge only; no inline-script or wildcard allowance.
  if (env.VITE_TURNSTILE_SITE_KEY?.trim()) {
    if (production && /^[123]x0{10}/u.test(env.VITE_TURNSTILE_SITE_KEY.trim())) throw new Error("Turnstile testing keys are not allowed in release builds.");
    directives["script-src"].push("https://challenges.cloudflare.com");
    directives["frame-src"] = [
      ...(development ? ["'self'"] : []), "https://challenges.cloudflare.com",
    ];
  }
  const serialize = (meta = false) =>
    Object.entries(directives)
      .filter(([name]) => !meta || name !== "frame-ancestors")
      .map(([name, sources]) => `${name} ${[...new Set(sources)].join(" ")}`)
      .join("; ");
  const reportOnly = env.CSP_REPORT_ONLY === "true";
  if (env.CSP_REPORT_ONLY && !["true", "false"].includes(env.CSP_REPORT_ONLY))
    throw new Error("CSP_REPORT_ONLY must be true or false.");
  const headers: HeaderMap = {
    [reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy"]: serialize(),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": development ? "SAMEORIGIN" : "DENY",
    "X-XSS-Protection": "0",
    "X-Download-Options": "noopen",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-DNS-Prefetch-Control": "off",
    "Permissions-Policy":
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  };
  const deploymentHeaders: HeaderMap = {
    ...headers,
    "Strict-Transport-Security": "max-age=31536000",
  };
  return {
    headers,
    deploymentHeaders,
    metaPolicy: reportOnly ? null : serialize(true),
  };
}
export function staticHostHeaders(headers: HeaderMap): string {
  return `/*\n${Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join("\n")}\n`;
}
export function nginxHeaders(headers: HeaderMap): string {
  return (
    "# Include in the HTTPS frontend server/location, including SPA fallbacks and errors.\n" +
    Object.entries(headers)
      .map(
        ([name, value]) =>
          `add_header ${name} "${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}" always;`,
      )
      .join("\n") +
    "\n"
  );
}
