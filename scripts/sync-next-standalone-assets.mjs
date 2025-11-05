import { cp, mkdir, rm, stat } from 'fs/promises';
import path from 'path';

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function copyTree(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function main() {
  const buildRoot = path.resolve('apps/web/.next');
  const standaloneRoot = path.join(buildRoot, 'standalone');
  const staticSource = path.join(buildRoot, 'static');
  const staticDestination = path.join(standaloneRoot, '_next', 'static');
  const publicSource = path.resolve('apps/web/public');
  const publicDestination = path.join(standaloneRoot, 'public');

  if (!(await pathExists(standaloneRoot))) {
    throw new Error('Expected Next.js standalone output at apps/web/.next/standalone');
  }

  if (!(await pathExists(staticSource))) {
    throw new Error('Expected Next.js static assets at apps/web/.next/static');
  }

  await copyTree(staticSource, staticDestination);

  if (await pathExists(publicSource)) {
    await copyTree(publicSource, publicDestination);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
