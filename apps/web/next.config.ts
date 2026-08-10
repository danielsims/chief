import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@chief/channel-api", "@chief/ui"],
};

export default nextConfig;
