/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.E2E_DIST_DIR ?? ".next",
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
