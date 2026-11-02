const publicNames = new Set([
  "VITE_API_URL",
  "VITE_PUBLIC_APP_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_TURNSTILE_SITE_KEY",
  "VITE_CSP_IMAGE_ORIGINS",
  "VITE_CSP_CONNECT_ORIGINS",
  "VITE_GOOGLE_CLIENT_ID",
  // Documented, public Vercel framework metadata. Keep this explicit: a
  // VITE_VERCEL_* prefix must never become a wildcard exemption for credentials.
  "VITE_VERCEL_ENV",
  "VITE_VERCEL_TARGET_ENV",
  "VITE_VERCEL_URL",
  "VITE_VERCEL_BRANCH_URL",
  "VITE_VERCEL_PROJECT_PRODUCTION_URL",
  "VITE_VERCEL_HASH_SALT",
  "VITE_VERCEL_GIT_PROVIDER",
  "VITE_VERCEL_GIT_REPO_SLUG",
  "VITE_VERCEL_GIT_REPO_OWNER",
  "VITE_VERCEL_GIT_REPO_ID",
  "VITE_VERCEL_GIT_COMMIT_REF",
  "VITE_VERCEL_GIT_COMMIT_SHA",
  "VITE_VERCEL_GIT_COMMIT_MESSAGE",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VITE_VERCEL_GIT_PULL_REQUEST_ID",
]);

/** Vite embeds VITE_ values in browser bundles; private credentials cannot be hidden there. */
export function validatePublicEnvironment(
  env: Record<string, string | undefined>,
) {
  const privateValues = Object.entries(env)
    .filter(
      ([name, value]) =>
        !name.startsWith("VITE_") &&
        /SECRET|PASSWORD|DATABASE_URL|SERVICE_ROLE|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/u.test(
          name,
        ) &&
        value &&
        value.length >= 12,
    )
    .map(([, value]) => value!);
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || !value?.trim()) continue;
    if (!publicNames.has(name))
      throw new Error(
        `${name} is not approved public configuration. VITE_ values are visible in the browser.`,
      );
    if (
      /sb_secret_|xkeysib-|xsmtpsib-|-----BEGIN .*PRIVATE KEY|sk_live_|sk[_-]proj-|sk-svcacct-|gh[pousr]_|github_pat_/u.test(
        value,
      ) ||
      privateValues.some((secret) => value.includes(secret))
    )
      throw new Error(
        `${name} contains private credential material. Keep it in the API environment only.`,
      );
    if (name === "VITE_SUPABASE_ANON_KEY" && value.startsWith("eyJ")) {
      let role: unknown;
      try {
        role = (
          JSON.parse(
            atob(value.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/")),
          ) as { role?: unknown }
        ).role;
      } catch {
        throw new Error(
          "VITE_SUPABASE_ANON_KEY is not a valid public Supabase key.",
        );
      }
      if (role !== "anon")
        throw new Error(
          "VITE_SUPABASE_ANON_KEY must use the public anon key, never a privileged or user token.",
        );
    }
  }
}
