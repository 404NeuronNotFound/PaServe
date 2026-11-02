# PaServe API edge filtering

Status: **implemented and tested locally; hosting activation pending**. Hosting is
not selected. These files supply a portable NGINX Open Source API reverse proxy,
not an active CDN account or a full managed WAF/OWASP CRS installation. No live
firewall, DNS, certificate, hosting service or database was changed.

The edge rejects requests before opening upstream processing. NestJS remains
responsible for authentication, membership, tenant isolation, exact validation,
Turnstile verification and idempotency. API responses from NestJS, including
401/403/429/503, cookies and retry guidance, pass through unchanged.

## Configuration

`nginx.conf.template` is the source policy. `scripts/edge-config.mjs` renders a
standalone configuration with validated hostnames, paths, origins and upstream.
It uses only stock HTTP/proxy/rate/connection/SSL modules. Use an appropriately
patched Linux NGINX build in deployment. The Windows binary is for functional
checks only; these tests do not establish Linux production capacity.

From the repository root, generate a reviewable deployment example:

```sh
pnpm edge:render --hostname api.example.test --upstream 127.0.0.1:3000 --prefix /var/lib/paserve-edge --worker-user nginx --certificate /etc/paserve/fullchain.pem --certificate-key /etc/paserve/key.pem --frontend-origin https://app.example.test --output artifacts/edge/nginx.example.conf
```

The example hostname and certificate paths are placeholders. Repeat
`--frontend-origin` for each explicitly allowed frontend origin; keep this list
consistent with API `FRONTEND_ORIGINS`. If omitted, only the API's own HTTPS origin
is allowed. No wildcard, reflection of arbitrary origins or credentialed broad
CORS is enabled. CORS headers on locally generated edge errors let the allowed
frontend read 429/retry guidance. NestJS still supplies CORS on forwarded requests.

Public configuration always uses TLS; it refuses missing TLS paths. A separate
`--local-check` mode binds plaintext HTTP to loopback only. `--port` defaults to
443 in deployment and 8080 for local checks. Unix workers default to the `nginx`
account; specify the actual account (for example, `www-data`) with `--worker-user`.
The private prefix must have `logs`, `body`, `proxy`, and `temp` directories, owned
appropriately for that worker. The TLS key must remain readable only by the
master/service account. Provision certificates and directories on the chosen host;
the renderer does not create system accounts, install certificates or reload NGINX.

This is an **API-only virtual host**; requests outside `/api/v1` are not forwarded.
It does not serve the frontend or ACME challenge files. For same-origin hosting,
review and merge the maps and API locations into the existing HTTPS frontend
virtual host, preserving its SPA routing, asset policy, CSP and security headers.
Do not replace an existing frontend host with this API-only configuration.

## Policy and compatibility

| Control | Starting policy |
| --- | --- |
| Host | Only the rendered hostname and its configured port |
| Methods | GET, HEAD, OPTIONS, POST, PATCH, DELETE; public auth actions accept POST/OPTIONS; streams accept GET/OPTIONS |
| Scanner paths | Hidden environment/VCS paths; root/API-root WordPress, XML-RPC, phpMyAdmin and PHPUnit probes |
| Encoded paths | Check NGINX-normalized URI; reject residual percent encoding; query-string percent encodings remain valid |
| Body types | JSON writes and empty-body actions; multipart POST only on image/logo/banner routes |
| Request body | Auth 16 KiB; other API JSON 1 MiB; uploads 6 MiB including multipart framing; stream requests 1 KiB |
| Upload compatibility | Allows the existing 5 MiB file maximum plus multipart overhead; NestJS still checks file bytes, format and authorization |
| Header/URI bounds | 1 KiB initial header buffer; four 8 KiB large buffers; NGINX parser rejects oversized fields/URI |
| Input timeouts | Headers 10 s; body-read inactivity 10 s; idle keepalive 15 s |
| Proxy timeouts | Connect 3 s; send inactivity 15 s; read inactivity 75 s |
| Response handling | No proxy cache or buffering; no automatic upstream retries; existing SSE heartbeats remain immediate |

There is no body/query keyword blacklist, user-agent ban, country ban or IP
reputation claim. Legitimate names, apostrophes, searches, percent signs in query
values, customer notes and order idempotency bodies are preserved. A menu shop
named `wp-admin` is not mistaken for a root WordPress scanner path. An edge filter
does not replace schema validation or parameterized database access.

The body is fully buffered at the edge before upstream processing. Both declared
and chunked oversized bodies are rejected, and private temporary storage must be
bounded/provisioned. Body/send/read timeout values are **inactivity timers**, not
absolute request deadlines. Header timeout applies to complete header reading.
These semantics follow the [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

### Rate and connection budgets

Limits use the socket client IP, with shared-memory state across workers of one
NGINX instance. Empty keys exclude unrelated workflows from each specialized
budget. The leaky-bucket burst settings are **not** exact rolling-minute limits;
NestJS retains its stricter rolling windows and normalized-account limits.

| Scope | Rate | Additional immediate burst allowance |
| --- | --- | --- |
| All API requests per IP | 50/second | 100 |
| Login POST per IP | 12/minute | 10 |
| Registration POST per IP | 6/minute | 5 |
| Refresh POST per IP | 40/minute | 20 |
| Combined public authentication POST across IPs | 120/minute | 20 |
| Image upload POST per IP | 40/minute | 10 |

Requests are not delayed in an edge queue. Excess rate/connection requests receive
HTTP 429 JSON `EDGE_RATE_LIMIT_EXCEEDED`, no-store and a conservative
`Retry-After: 60`. Authentication has four concurrent requests per IP and sixteen
total; uploads have their own four-per-IP and sixteen-total budgets. Both retain
the general 200 active requests per IP limit. The separate budgets keep a saturated
authentication route from consuming the edge's allowance for menu traffic.
See [NGINX request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
and [connection limiting](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html).

Native parser errors (400/408/414) intentionally retain generic NGINX responses.
They may occur before a URI exists; redirecting them into a named JSON location
would produce a 500. Local policy rejections (403/404/405/413/415/421) and origin
connection/timeouts (502/503/504) use generic JSON. Upstream challenge/session
responses are not intercepted or rewritten. No edge HTML CAPTCHA is placed in
JSON API, refresh or SSE responses.

These are conservative starting policies, **not measured capacity targets**.
Shared shop Wi-Fi/NAT, mobile reconnects, simultaneous shop opening and large
tenant workloads need staging measurement before tuning. Separate edge replicas
have separate memory budgets; scaling them requires coordinated edge/CDN limits.
There is no claim of L3/L4 DDoS mitigation or fairness under a distributed flood.

## Origin and client-IP trust: required before activation

1. Make the API origin private. With NGINX on the same host, set
   `API_BIND_ADDRESS=127.0.0.1` and an internal `PORT`. The optional bind setting is
   supported by `apps/api/src/main.ts`; leaving it unset retains existing hosting
   behavior and **does not** lock down the origin.
2. In containers, bind the API on the private network as required, do not publish
   its port to the Internet, and permit ingress only from the proxy/service network.
   Restrict public firewall/security-group ingress to the actual edge listener.
   A public API URL bypasses all of these edge rules.
3. Set `TRUSTED_PROXY_CIDRS` to the actual immediate NGINX peer addresses seen by
   NestJS (loopback or the tightly scoped private proxy addresses). Never trust
   all networks or use client-provided IP/shop headers as identity.
4. The edge replaces X-Forwarded-For, X-Real-IP, X-Forwarded-Proto and X-Request-ID;
   it strips Forwarded, CF-Connecting-IP, True-Client-IP, forwarded-host and rewrite
   hints. It does not append an attacker-supplied forwarding chain. Cookies,
   authorization, API paths/queries and request bodies remain intact.
5. If a CDN/load balancer is later placed before NGINX, review real-IP restoration
   separately using only that provider's actual trusted peer CIDRs, and firewall
   the origin against direct access. Do not just trust CF-Connecting-IP or a
   forwarded header. Otherwise all clients can share one CDN IP bucket or forge
   their identity. No provider-specific trust list is installed by this phase.

## Logging and operation

Access logs sample approximately 1/256 requests using NGINX-generated random
request IDs, not client input. Structured fields are time, request ID, bounded
route class, status/upstream status, duration, bytes and limit result. No raw
IP, URI, query string, body, cookie, email, token or user agent is in this format.
Critical operational errors retain NGINX's native error log; protect that log as
sensitive because native diagnostics can include request metadata. Routine
rate-limit/request-parser messages are below the configured critical severity.

On the chosen host, configure log rotation, bounded retention and a disk/container
quota for both logs and body/proxy temporary storage. Sampling and log buffering
reduce traffic; they are not hard storage quotas. Never enable debug request logs
on production auth/receipt endpoints. Feed aggregated rejected/forwarded counts,
429 rate, edge CPU/memory, temp-disk usage, origin errors and latency into the
hosting platform's monitoring. A sampled log is not an exact rejection counter.

Before loading a generated config, provision its private directories, install the
correct certificates/hostnames, and run `nginx -t -p <prefix>/ -c <absolute-config>`.
Reload only the intended instance after validation. Keep the previous validated
config for rollback; validate it before reloading on rollback. Never respond to
edge trouble by exposing the NestJS origin publicly or disabling its protections.

## Local verification

```sh
pnpm test:edge:config
pnpm test:edge
```

The first command needs only Node and is included in the main `pnpm test` chain.
The second requires an actual NGINX binary and fails explicitly if it is missing;
there is no silent skip or simulated edge implementation. Set `NGINX_BIN` to the
executable, or use `nginx` from PATH on Linux. Windows defaults to the official
test binary at `.local-tools/nginx-1.31.8/nginx.exe` (ignored by Git). Obtain it
from the [official NGINX downloads](https://nginx.org/en/download.html); do not
install Windows NGINX as the production capacity target.

Verification on October 27, 2026 used the official Windows 1.31.8 archive over
HTTPS, SHA-256 `fbb1501009be34655cc238d460714cf20391b639013f4c73859813d7938783fd`.
This records the downloaded artifact; it is not an independent signature check.
All 13 config/native-proxy tests and 14 NestJS trusted-proxy tests passed, plus API
build/lint. The tests start only loopback listeners, validate the real config with
`nginx -t`, and count requests as soon as the disposable upstream receives headers.
Blocked scanner/method/host/header/URI/body requests produce **zero upstream
requests**, including chunked oversized bodies. Tests also cover valid 5 MiB
multipart requests, immediate SSE delivery, unmodified auth/order data, preserved
application errors, auth concurrency, floods with forged IP headers and bounded
CORS on edge errors. All test NGINX instances stop and their checked workspace
prefixes are removed; no actual NestJS server or database is contacted.

## Deployment acceptance and full WAF decision

The renderer also accepts repeated `--api-upstream host:port` with one explicit
`--auth-upstream host:port`. Business routes use least connections; all auth
routes stay on that designated API while their risk/replay controls are local.
See [horizontal scaling readiness](../../docs/horizontal-scaling-readiness.md)
for the supported topology, process/DB budgets and the auth availability limit.

Keep status **activation pending** until hosting is selected and the actual Linux
edge passes syntax, TLS, host/CORS, normal journey, shared-NAT, upload and SSE
checks. Verify rejected traffic does not appear in origin request/DB metrics and
verify direct origin access is denied. Install monitoring, rotation, quotas and
rollback handling, then repeat flood tests only against designated staging.

If full payload-signature protection is required, choose a managed WAF or a
maintained ModSecurity/OWASP CRS deployment supported by the chosen platform.
Stage rules in observation mode where available, review real false positives for
JSON checkout, product modifiers, customer notes, uploads and SSE, and enforce
scoped protections after verification. This configuration supplies coarse edge
filtering/rate controls; it does not claim managed SQLi/XSS rules, bot reputation,
provider rule IDs, production filtering or a completed external penetration test.
