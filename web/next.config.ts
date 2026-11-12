import type { NextConfig } from "next";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000");
const apiProxyTarget = new URL(
  process.env.API_PROXY_TARGET || process.env.API_URL || "https://api.turesma.com",
);

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${apiProxyTarget.origin}/:path*`,
      },
    ];
  },
  images: {
    qualities: [75, 100],
    remotePatterns: [
      {
        protocol: apiUrl.protocol.slice(0, -1) as "http" | "https",
        hostname: apiUrl.hostname,
        ...(apiUrl.port ? { port: apiUrl.port } : {}),
      },
      {
        protocol: apiProxyTarget.protocol.slice(0, -1) as "http" | "https",
        hostname: apiProxyTarget.hostname,
        ...(apiProxyTarget.port ? { port: apiProxyTarget.port } : {}),
      },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

export default nextConfig;
