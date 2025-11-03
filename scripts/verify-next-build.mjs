import { access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

async function ensureExists(relativePath) {
  const absolutePath = path.resolve(relativePath);
  try {
    await access(absolutePath, constants.R_OK);
  } catch (error) {
    throw new Error(`Missing expected build artifact: ${relativePath}`);
  }
}

async function main() {
  const requiredArtifacts = [
    'apps/web/.next/BUILD_ID',
    'apps/web/.next/standalone/server.js',
    'apps/web/.next/standalone/_next/static',
  ];

  await Promise.all(requiredArtifacts.map((artifact) => ensureExists(artifact)));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
