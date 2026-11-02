import { describe, expect, it } from "vitest";
import { validatePublicEnvironment } from "../../security/public-environment";

const jwt = (role: string) =>
  [
    "eyJhbGciOiJIUzI1NiJ9",
    btoa(JSON.stringify({ role })),
    "fixture-signature",
  ].join(".");
describe("public frontend credential boundary", () => {
  it("permits public Supabase anon/publishable keys and public client identifiers", () => {
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_ANON_KEY: jwt("anon"),
        VITE_GOOGLE_CLIENT_ID: "public-client",
        VITE_TURNSTILE_SITE_KEY: "public-site-key",
      }),
    ).not.toThrow();
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture",
      }),
    ).not.toThrow();
  });
  it("rejects privileged Supabase and user tokens under the public anon setting", () => {
    for (const role of ["service_role", "authenticated"])
      expect(() =>
        validatePublicEnvironment({ VITE_SUPABASE_ANON_KEY: jwt(role) }),
      ).toThrow("public anon");
  });
  it("blocks new frontend credential names and never includes values in errors", () => {
    const credential = "runtime-only-sensitive-fixture-value";
    try {
      validatePublicEnvironment({ VITE_BREVO_API_KEY: credential });
      throw new Error("expected rejection");
    } catch (error) {
      expect(String(error)).toContain("not approved");
      expect(String(error)).not.toContain(credential);
    }
  });
  it("blocks private credentials even if copied into an approved public field", () => {
    const credential = "runtime-only-sensitive-fixture-value";
    expect(() =>
      validatePublicEnvironment({
        BREVO_API_KEY: credential,
        VITE_SUPABASE_ANON_KEY: credential,
      }),
    ).toThrow("private credential");
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_ANON_KEY: ["sb", "secret", "fixture"].join("_"),
      }),
    ).toThrow("private credential");
  });
});
