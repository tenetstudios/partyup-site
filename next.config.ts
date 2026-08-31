import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@partyup/balloon-core"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
