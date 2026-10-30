import type { NextConfig } from "next";

// Cache Components left off: every page here is per-user, per-org live data.
const nextConfig: NextConfig = {
  output: "standalone", // small self-contained server for the Docker image
  // Lets a production build run beside `pnpm dev` without sharing .next (which breaks the dev server).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["bwip-js"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera is used by the label scanner; nothing else is needed.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Uploads: CSV import up to 5 MB, asset files up to 10 MB each (lib/files.ts), plus multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
