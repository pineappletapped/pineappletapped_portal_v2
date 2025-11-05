import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawAssetBase = process.env.NEXT_ASSET_BASE_URL ?? '';
const normalizedAssetBase = rawAssetBase.trim().replace(/\/+$/, '');
const assetPrefix = normalizedAssetBase || undefined;
const publicAssetBase = normalizedAssetBase ? `${normalizedAssetBase}/` : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  assetPrefix,
  env: {
    NEXT_PUBLIC_ASSET_BASE_URL: publicAssetBase,
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
    config.resolve.alias['@backend'] = path.resolve(
      __dirname,
      '../../functions/src',
    );
    return config;
  },
};

export default nextConfig;
