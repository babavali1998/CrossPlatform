import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every dashboard page is per-user and request-time, so this app uses the
  // classic dynamic rendering model rather than Cache Components.
  cacheComponents: false,
  serverExternalPackages: ["sharp", "bullmq", "ioredis", "@prisma/client"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
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
