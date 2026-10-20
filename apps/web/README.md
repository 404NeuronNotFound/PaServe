# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```


## PaServe security headers and production hosting

Build with `pnpm --filter web build`. The output includes an enforced HTML meta
CSP fallback, `_headers` for compatible static hosts, and
`deployment/security-headers.nginx.conf` for inclusion in the HTTPS frontend server.
The host must apply the response headers; deploying files alone does not configure
Nginx or hosts that ignore `_headers`. The meta fallback cannot prevent framing.

Set `VITE_API_URL` and `VITE_SUPABASE_URL` to the real API/storage endpoints.
Optional `VITE_CSP_IMAGE_ORIGINS` / `VITE_CSP_CONNECT_ORIGINS` accept comma-separated
explicit origins, not wildcards or paths. Rebuild when changing them. Release
endpoints require HTTPS/WSS and reject loopback addresses, including HTTPS localhost.
Before deployment, put the real API URL in `VITE_API_URL`; no deployment target is
provided by this repository. A relative API path requires a working same-origin
reverse proxy. Use `pnpm --filter web build:local` for localhost testing only;
this keeps the strict script policy but its output must not be deployed.
Dev HMR permissions stay out of builds.
For a staged rollout, `CSP_REPORT_ONLY=true` emits a report-only header and no
enforced meta CSP; default `false` enforces it. No external reporting service is used.

Run `pnpm --filter web test:security-headers` after building to verify HTTP headers,
SPA fallbacks/errors and release artifacts. Dev/preview omit HSTS; generated HTTPS
host configuration includes one-year HSTS without subdomain/preload opt-in.
See [secure headers and CSP](../../docs/security.md#phase-24-secure-headers-and-csp-2026-10-19)
for the exact policy, style/camera/media exceptions and browser/deployment checks.

After a release build, run `pnpm --filter web test:security-release` to also reject
insecure/loopback CSP network origins and report-only CSP. Passing local checks
does not verify deployment header application; scan the actual HTTPS host when available.
