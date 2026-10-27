import { describe, expect, it } from "vitest";
import {
  frontendSecurity,
  nginxHeaders,
  staticHostHeaders,
} from "../../security/policy.ts";

const env = {
  VITE_API_URL: "https://api.example.test/api/v1",
  VITE_SUPABASE_URL: "https://project.supabase.co",
};
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((value) => {
      const [name, ...sources] = value.split(" ");
      return [name, sources];
    }),
  );
}
describe("frontend deployment security policy", () => {
  it("permits only the configured challenge origin for scripts and frames without weakening other directives", () => {
    const csp = directives(frontendSecurity({ ...env, VITE_TURNSTILE_SITE_KEY: "real-public-site-key" }).headers["Content-Security-Policy"]);
    expect(csp["script-src"]).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(csp["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["script-src-attr"]).toEqual(["'none'"]);
    expect(() => frontendSecurity({ ...env, VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" })).toThrow(/testing keys/);
  });
  it("allows only same-origin scripts and configured network/media origins in production", () => {
    const security = frontendSecurity(env);
    const csp = directives(security.headers["Content-Security-Policy"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["script-src-attr"]).toEqual(["'none'"]);
    expect(csp["style-src-elem"]).toEqual(["'self'"]);
    expect(csp["style-src-attr"]).toEqual(["'unsafe-inline'"]);
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://api.example.test",
      "https://project.supabase.co",
      "wss://project.supabase.co",
    ]);
    expect(csp["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://project.supabase.co",
    ]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["media-src"]).toContain("blob:");
    expect(security.headers["Permissions-Policy"]).toContain("camera=(self)");
    expect(security.headers["Strict-Transport-Security"]).toBeUndefined();
    expect(security.deploymentHeaders["Strict-Transport-Security"]).toBe(
      "max-age=31536000",
    );
  });
  it("keeps development HMR allowances out of release builds", () => {
    const dev = directives(
      frontendSecurity({}, true).headers["Content-Security-Policy"],
    );
    const prod = directives(
      frontendSecurity({}).headers["Content-Security-Policy"],
    );
    expect(dev["script-src"]).toContain("'unsafe-inline'");
    expect(dev["connect-src"]).toContain("ws://localhost:*");
    expect(dev["connect-src"]).toContain("ws://127.0.0.1:*");
    expect(dev["connect-src"]).not.toContain("ws://[::1]:*");
    expect(dev["connect-src"]).not.toContain("ws:");
    expect(dev["worker-src"]).toEqual(["blob:"]);
    expect(prod["worker-src"]).toEqual(["'none'"]);
    expect(frontendSecurity({}, true).metaPolicy).not.toContain("ws://[::1]");
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
    expect(prod["connect-src"]).not.toContain("ws://localhost:*");
    expect(JSON.stringify(prod)).not.toContain("unsafe-eval");
  });
  it("allows same-origin simulator frames only on the development server", () => {
    const development = frontendSecurity({}, true);
    const dev = directives(development.headers["Content-Security-Policy"]);
    expect(dev["frame-src"]).toEqual(["'self'"]);
    expect(dev["frame-ancestors"]).toEqual(["'self'"]);
    expect(development.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(directives(development.metaPolicy!)["frame-src"]).toEqual(["'self'"]);
    for (const security of [frontendSecurity({}), frontendSecurity({}, false, false)]) {
      const policy = directives(security.headers["Content-Security-Policy"]);
      expect(policy["frame-src"]).toEqual(["'none'"]);
      expect(policy["frame-ancestors"]).toEqual(["'none'"]);
      expect(policy["worker-src"]).toEqual(["'none'"]);
      expect(security.headers["X-Frame-Options"]).toBe("DENY");
      expect(security.deploymentHeaders["X-Frame-Options"]).toBe("DENY");
    }
  });
  it.each(["", "/api/v1"])(
    "supports same-origin API configuration: %s",
    (VITE_API_URL) => {
      expect(() => frontendSecurity({ VITE_API_URL })).not.toThrow();
    },
  );
  it.each([
    "http://localhost:3000/api/v1",
    "http://127.0.0.1:3000/api/v1",
    "http://[::1]:3000/api/v1",
    "https://localhost/api/v1",
    "https://127.0.0.1/api/v1",
    "https://localhost./api/v1",
    "https://api.localhost/api/v1",
    "https://[::ffff:127.0.0.1]/api/v1",
    "https://[::ffff:7f00:1]/api/v1",
    "https://0.0.0.0/api/v1",
    "https://[::]/api/v1",
    "http://2130706433/api/v1",
  ])(
    "rejects loopback release endpoints but supports local builds: %s",
    (VITE_API_URL) => {
      expect(() => frontendSecurity({ VITE_API_URL })).toThrow(/Loopback/);
      expect(() =>
        frontendSecurity({ VITE_API_URL }, false, false),
      ).not.toThrow();
      expect(() => frontendSecurity({ VITE_API_URL }, true)).not.toThrow();
    },
  );
  it.each([
    { VITE_SUPABASE_URL: "http://localhost:54321" },
    { VITE_CSP_IMAGE_ORIGINS: "https://localhost" },
    { VITE_CSP_CONNECT_ORIGINS: "wss://127.0.0.1" },
  ])(
    "rejects loopback storage and extra origins in releases: %j",
    (configuration) => {
      expect(() => frontendSecurity(configuration)).toThrow(/Loopback/);
      expect(() => frontendSecurity(configuration, false, false)).not.toThrow();
    },
  );
  it.each([
    "https://user:password@api.test",
    "//api.test",
    "https://api.test?q=x",
    "https://api.test#fragment",
    "https://api.test;script-src",
    "https://api.test\r\nX-Test: bad",
    "javascript:alert(1)",
    "http://api.example.test",
    "http://127.evil.test",
  ])("rejects unsafe production API configuration: %s", (VITE_API_URL) => {
    expect(() => frontendSecurity({ VITE_API_URL })).toThrow();
  });
  it.each([
    "*",
    "https:",
    "https://media.test/path",
    "https://media.test,",
    "https://user:secret@media.test",
    "https://media.test;script-src",
  ])("rejects unsafe extra origin entries: %s", (VITE_CSP_IMAGE_ORIGINS) => {
    expect(() => frontendSecurity({ VITE_CSP_IMAGE_ORIGINS })).toThrow();
  });
  it("supports explicit CDN/connection origins without granting them script permission", () => {
    const csp = directives(
      frontendSecurity({
        ...env,
        VITE_CSP_IMAGE_ORIGINS: "https://cdn.example.test",
        VITE_CSP_CONNECT_ORIGINS: "wss://realtime.example.test",
      }).headers["Content-Security-Policy"],
    );
    expect(csp["img-src"]).toContain("https://cdn.example.test");
    expect(csp["connect-src"]).toContain("wss://realtime.example.test");
    expect(csp["script-src"]).toEqual(["'self'"]);
  });
  it("uses header framing protection and omits unsupported directives from the meta fallback", () => {
    const security = frontendSecurity(env);
    expect(security.metaPolicy).toContain("script-src 'self'");
    expect(security.metaPolicy).not.toContain("frame-ancestors");
    expect(security.headers["X-Frame-Options"]).toBe("DENY");
    const staticHeaders = staticHostHeaders(security.deploymentHeaders);
    expect(staticHeaders).toContain("/*\n  Content-Security-Policy:");
    expect(staticHeaders).toContain("frame-ancestors 'none'");
    expect(nginxHeaders(security.deploymentHeaders)).toContain(
      'add_header X-Frame-Options "DENY" always;',
    );
  });
  it("can stage a report-only rollout without accidentally enforcing a meta policy", () => {
    const security = frontendSecurity({ ...env, CSP_REPORT_ONLY: "true" });
    expect(security.headers["Content-Security-Policy"]).toBeUndefined();
    expect(
      security.headers["Content-Security-Policy-Report-Only"],
    ).toBeTruthy();
    expect(security.metaPolicy).toBeNull();
    expect(() => frontendSecurity({ CSP_REPORT_ONLY: "yes" })).toThrow();
  });
});
