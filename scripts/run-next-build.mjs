import { spawn } from 'child_process';
import path from 'path';

function getNodeOptions() {
  const existing = process.env.NODE_OPTIONS?.trim();
  const requiredFlag = '--max_old_space_size=4096';

  if (!existing) {
    return requiredFlag;
  }

  if (existing.includes('--max_old_space_size')) {
    return existing;
  }

  return `${existing} ${requiredFlag}`.trim();
}

async function runNextBuild() {
  const cwd = path.resolve('apps/web');
  const env = {
    ...process.env,
    NODE_OPTIONS: getNodeOptions(),
  };

  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const description = signal
        ? `terminated by signal ${signal}`
        : `exited with code ${code}`;
      reject(new Error(`next build ${description}`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

runNextBuild().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
