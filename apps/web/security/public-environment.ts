export const publicEnvironmentNames = [
  "VITE_API_URL",
  "VITE_PUBLIC_APP_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_TURNSTILE_SITE_KEY",
  "VITE_CSP_IMAGE_ORIGINS",
  "VITE_CSP_CONNECT_ORIGINS",
  "VITE_GOOGLE_CLIENT_ID",
] as const;
const publicNames = new Set<string>(publicEnvironmentNames);

/** Only application names above are exported by Vite. Platform metadata stays build-only. */
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
    const platformBuildMetadata =
      name.startsWith("VITE_VERCEL_") &&
      !/SECRET|PASSWORD|DATABASE_URL|SERVICE_ROLE|PRIVATE_KEY|API_KEY|TOKEN/u.test(
        name,
      );
    if (!publicNames.has(name) && !platformBuildMetadata)
      throw new Error(
        `${name} is not approved public configuration. Only approved application settings may be exposed to the browser.`,
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
