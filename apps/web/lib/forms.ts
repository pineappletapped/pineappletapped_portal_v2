export const generateFormId = (): string =>
  typeof globalThis !== "undefined" &&
  (globalThis.crypto?.randomUUID?.() as string | undefined)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
