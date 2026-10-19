import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { frontendSecurity } from "./security/policy.ts";
import { securityHeadersPlugin } from "./security/vite-plugin.ts";

export default defineConfig(({ mode, command, isPreview }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ["VITE_", "CSP_"]),
    ...process.env,
  };
  const security = frontendSecurity(
    env,
    command === "serve" && !isPreview,
    command === "build" && mode !== "local-build",
  );
  return {
    plugins: [react(), securityHeadersPlugin(security)],
    server: { headers: security.headers },
    preview: { headers: frontendSecurity(env, false, false).headers },
  };
});
