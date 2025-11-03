import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetBase = process.env.NEXT_ASSET_BASE_URL ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  assetPrefix: assetBase || undefined,
  env: {
    NEXT_PUBLIC_ASSET_BASE_URL: assetBase,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname);
    config.resolve.alias['@shared-config'] = path.resolve(
      __dirname,
      '../../shared/config/hosting.js',
    );
    return config;
  },
};

export default nextConfig;
