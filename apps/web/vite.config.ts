import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { frontendSecurity } from "./security/policy.ts";
import { securityHeadersPlugin } from "./security/vite-plugin.ts";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  const certificates = resolve(import.meta.dirname, "../../.local-https");
  const camera = command === "serve" && !isPreview && mode === "camera";
  if (camera && !existsSync(resolve(certificates, "server.pem")))
    throw new Error("Run python scripts/setup-local-https.py from the project root first.");
  return {
    plugins: [react(), securityHeadersPlugin(security), {
      name: "paserve-local-camera-certificate",
      configureServer(server) {
        // Only this public certificate is downloadable. Private keys stay outside
        // the app root and are denied by Vite's file-serving policy below.
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/local-camera-ca.cer" ||
              !["GET", "HEAD"].includes(request.method ?? "")) return next();
          const certificate = resolve(certificates, "phone-ca.cer");
          if (!existsSync(certificate)) return next();
          response.setHeader("Content-Type", "application/x-x509-ca-cert");
          response.setHeader("Content-Disposition", 'attachment; filename="PaServe-Local-Camera.cer"');
          response.setHeader("Cache-Control", "no-store");
          response.end(request.method === "HEAD" ? undefined : readFileSync(certificate));
        });
      },
    }],
    server: {
      headers: security.headers,
      ...(camera ? { https: {
        key: readFileSync(resolve(certificates, "server.key")),
        cert: readFileSync(resolve(certificates, "server.pem")),
      } } : {}),
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local-https/**"] },
      proxy: {
        "/api": { target: "http://127.0.0.1:3000" },
      },
    },
    preview: { headers: frontendSecurity(env, false, false).headers },
  };
});
