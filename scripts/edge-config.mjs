import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const template = new URL(
  "../deployment/edge/nginx.conf.template",
  import.meta.url,
);
function safePath(value, name) {
  if (typeof value !== "string" || !value || /[\r\n\0"'{};$]/u.test(value))
    throw new Error(`${name} must be a safe explicit filesystem path`);
  return value.replace(/\\/gu, "/");
}
function hostname(value) {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    !value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))
  )
    throw new Error(
      "hostname must be an explicit DNS hostname or IPv4 address",
    );
  return value.toLowerCase();
}
function port(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535)
    throw new Error("port must be between 1 and 65535");
  return result;
}
export async function renderEdgeConfig(options) {
  const local = options.localCheck === true;
  const host = hostname(options.hostname);
  const workerUser = options.workerUser ?? "nginx";
  if (workerUser === "root" || !/^[a-z_][a-z0-9_-]*$/u.test(workerUser))
    throw new Error("workerUser must be an explicit Unix account name");
  const listenPort = port(options.port ?? (local ? 8080 : 443));
  const prefix = safePath(options.prefix, "prefix");
  const upstream = options.upstream ?? "127.0.0.1:3000";
  if (
    !/^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|\[[0-9a-f:]+\]):[0-9]+$/iu.test(upstream)
  )
    throw new Error("upstream must be host:port with no URL/path/credentials");
  port(upstream.slice(upstream.lastIndexOf(":") + 1));
  if (local && !["127.0.0.1", "localhost"].includes(host))
    throw new Error("Local HTTP checks must use a loopback hostname");
  if (!local && ["localhost", "127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error("Deployment requires a real hostname and HTTPS");
  const tls = local
    ? ""
    : `        ssl_certificate "${safePath(options.certificate, "certificate")}";\n        ssl_certificate_key "${safePath(options.certificateKey, "certificate key")}";\n        ssl_protocols TLSv1.2 TLSv1.3;\n        ssl_session_cache shared:paserve_tls:1m;\n        ssl_session_tickets off;`;
  const origins = options.frontendOrigins ?? [
    `${local ? "http" : "https"}://${host}${local ? `:${listenPort}` : ""}`,
  ];
  if (!Array.isArray(origins) || !origins.length)
    throw new Error("At least one explicit frontend origin is required");
  const corsOrigins = [
    ...new Set(
      origins.map((entry) => {
        const url = new URL(entry);
        if (
          !["https:", ...(local ? ["http:"] : [])].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/" ||
          entry !== url.origin ||
          !/^[a-z0-9.:-]+$/iu.test(url.host)
        )
          throw new Error(
            "frontendOrigins must be exact HTTPS origins without paths or wildcards",
          );
        return url.origin;
      }),
    ),
  ];
  const hsts = local
    ? ""
    : '        add_header Strict-Transport-Security "max-age=31536000" always;';
  const errorHeaders = [
    '        add_header Cache-Control "no-store" always;',
    '        add_header X-Content-Type-Options "nosniff" always;',
    "        add_header X-Request-ID $request_id always;",
    "        add_header Access-Control-Allow-Origin $paserve_cors_origin always;",
    "        add_header Access-Control-Allow-Credentials $paserve_cors_credentials always;",
    '        add_header Access-Control-Expose-Headers "Retry-After, X-Request-ID" always;',
    '        add_header Vary "Origin" always;',
    hsts,
  ]
    .filter(Boolean)
    .join("\n");
  // Parser errors (400/408/414) can precede a parsed URI. A named error location
  // would turn those into 500, so retain NGINX's generic built-in parser errors.
  const statuses = {
    403: "EDGE_REQUEST_BLOCKED",
    404: "EDGE_ROUTE_NOT_FOUND",
    405: "EDGE_METHOD_NOT_ALLOWED",
    413: "EDGE_REQUEST_TOO_LARGE",
    415: "EDGE_CONTENT_TYPE_NOT_ALLOWED",
    421: "EDGE_HOST_NOT_ALLOWED",
    429: "EDGE_RATE_LIMIT_EXCEEDED",
    502: "EDGE_ORIGIN_UNAVAILABLE",
    503: "EDGE_ORIGIN_UNAVAILABLE",
    504: "EDGE_ORIGIN_TIMEOUT",
  };
  const errors = Object.entries(statuses)
    .map(
      ([status, code]) =>
        `        error_page ${status} = @paserve_error_${status};\n        location @paserve_error_${status} {\n${errorHeaders}\n${status === "429" ? '        add_header Retry-After "60" always;\n' : ""}        return ${status} '{"statusCode":${status},"code":"${code}","message":"${status === "429" ? "Too many requests. Please wait before trying again." : "The request could not be processed."}"}';\n        }`,
    )
    .join("\n");
  const fields = {
    WORKERS: local ? "1" : "auto",
    WORKER_USER: local ? "" : `user ${workerUser};`,
    PREFIX: prefix,
    HOST: host,
    PORT: listenPort,
    LISTEN: `${local ? "127.0.0.1:" : ""}${listenPort}`,
    SSL_LISTEN: local ? "" : " ssl",
    TLS: tls,
    UPSTREAM: upstream,
    CORS_ORIGINS: corsOrigins
      .map((entry) => `        "${entry}" "${entry}";`)
      .join("\n"),
    SERVER_HEADERS: [
      hsts,
      '        add_header Cache-Control "no-store" always;',
      "        add_header X-Request-ID $request_id always;",
    ]
      .filter(Boolean)
      .join("\n"),
    ERRORS: errors,
  };
  return (await readFile(template, "utf8")).replace(
    /@@([A-Z_]+)@@/gu,
    (_match, name) => {
      if (!Object.hasOwn(fields, name))
        throw new Error(`Unknown template field ${name}`);
      return String(fields[name]);
    },
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const options = { frontendOrigins: [] };
  const names = {
    "--hostname": "hostname",
    "--upstream": "upstream",
    "--prefix": "prefix",
    "--worker-user": "workerUser",
    "--certificate": "certificate",
    "--certificate-key": "certificateKey",
    "--port": "port",
    "--output": "output",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local-check") {
      options.localCheck = true;
      continue;
    }
    if (args[i] === "--frontend-origin") {
      options.frontendOrigins.push(args[++i]);
      continue;
    }
    if (!Object.hasOwn(names, args[i]) || args[i + 1] === undefined)
      throw new Error(`Unknown or incomplete option ${args[i]}`);
    options[names[args[i]]] = args[++i];
  }
  if (!options.frontendOrigins.length) delete options.frontendOrigins;
  if (!options.output) throw new Error("--output is required");
  const config = await renderEdgeConfig(options);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, config);
  console.log(
    `Edge configuration written to ${output}. Run nginx -t before activating it.`,
  );
}
