import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["app/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}", "hooks/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": resolve(projectRoot),
    },
  },
});
