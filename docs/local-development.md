# Local Development Setup

To run workspace checks locally, install dependencies for each package workspace before invoking lint or build commands:

```bash
npm --prefix apps/web install
npm --prefix functions install
```

These installs provide the Next.js CLI for frontend linting and the Firebase Admin/Functions toolchain for building Cloud Functions. After installation, you can run the standard checks:

```bash
npm --prefix apps/web run lint
npm --prefix functions run build
```

If your environment does not persist `node_modules`, you may remove the installed folders after executing the commands to keep the repository clean.
