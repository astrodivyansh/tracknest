import type { NextConfig } from "next";

// Cache Components left off: every page here is per-user, per-org live data.
const nextConfig: NextConfig = {
  serverExternalPackages: ["bwip-js"],
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
