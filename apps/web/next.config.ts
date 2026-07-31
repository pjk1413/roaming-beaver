import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@mystery-trips/api",
    "@mystery-trips/db",
    "@mystery-trips/types",
  ],
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
