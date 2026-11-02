import { describe, expect, it } from "vitest";
import { validatePublicEnvironment } from "../../security/public-environment";

const jwt = (role: string) =>
  [
    "eyJhbGciOiJIUzI1NiJ9",
    btoa(JSON.stringify({ role })),
    "fixture-signature",
  ].join(".");
describe("public frontend credential boundary", () => {
  it("accepts Vercel's automatic public deployment metadata", () => {
    expect(() =>
      validatePublicEnvironment({
        VITE_VERCEL_ENV: "production",
        VITE_VERCEL_TARGET_ENV: "production",
        VITE_VERCEL_URL: "app.example.test",
        VITE_VERCEL_BRANCH_URL: "app-production.example.test",
        VITE_VERCEL_PROJECT_PRODUCTION_URL: "app.example.test",
        VITE_VERCEL_HASH_SALT: "public-platform-hash-salt",
        VITE_VERCEL_GIT_PROVIDER: "github",
        VITE_VERCEL_GIT_REPO_SLUG: "PaServe",
        VITE_VERCEL_GIT_REPO_OWNER: "404NeuronNotFound",
        VITE_VERCEL_GIT_REPO_ID: "123456789",
        VITE_VERCEL_GIT_COMMIT_REF: "production",
        VITE_VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        VITE_VERCEL_GIT_COMMIT_MESSAGE: "Deploy frontend",
        VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN: "fixture-developer",
        VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME: "Fixture Developer",
        VITE_VERCEL_GIT_PULL_REQUEST_ID: "42",
      }),
    ).not.toThrow();
  });

  it.each([
    "VITE_VERCEL_API_KEY",
    "VITE_VERCEL_SECRET",
    "VITE_VERCEL_OIDC_TOKEN",
  ])("still rejects unapproved platform-prefixed credentials: %s", (name) => {
    expect(() =>
      validatePublicEnvironment({
        [name]: "runtime-only-sensitive-fixture-value",
      }),
    ).toThrow("not approved");
  });

  it("continues checking approved metadata values for copied private credentials", () => {
    const credential = "runtime-only-sensitive-fixture-value";
    expect(() =>
      validatePublicEnvironment({
        BREVO_API_KEY: credential,
        VITE_VERCEL_GIT_COMMIT_MESSAGE: credential,
      }),
    ).toThrow("private credential");
    expect(() =>
      validatePublicEnvironment({
        VITE_VERCEL_GIT_COMMIT_MESSAGE: ["sb", "secret", "fixture"].join("_"),
      }),
    ).toThrow("private credential");
  });
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
