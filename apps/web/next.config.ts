import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Node.js 24 prefers the module-sync export from @swc/helpers. Next's file tracer currently
  // records only the CommonJS helper, so the standalone server otherwise fails before listening.
  outputFileTracingIncludes: {
    "/*": ["node_modules/@swc/helpers/esm/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
