import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { frontendSecurity, staticHostHeaders, nginxHeaders } from "./policy.ts";

export function securityHeadersPlugin(
  security: ReturnType<typeof frontendSecurity>,
): Plugin {
  const headers = (
    _request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    for (const [name, value] of Object.entries(security.headers))
      response.setHeader(name, value);
    next();
  };
  return {
    name: "paserve-security-headers",
    configureServer: (server) => {
      server.middlewares.use(headers);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(headers);
    },
    transformIndexHtml: {
      order: "post",
      handler: () =>
        security.metaPolicy
          ? [
              {
                tag: "meta",
                attrs: {
                  "http-equiv": "Content-Security-Policy",
                  content: security.metaPolicy,
                },
                injectTo: "head-prepend",
              },
            ]
          : [],
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: staticHostHeaders(security.deploymentHeaders),
      });
      this.emitFile({
        type: "asset",
        fileName: "deployment/security-headers.nginx.conf",
        source: nginxHeaders(security.deploymentHeaders),
      });
    },
  };
}
